"""
Conditional Neuron Integrated Gradients (NIG)

Computes NIG with respect to a specific target neuron (attention head or FFN neuron)
instead of the final model output. This allows understanding what input features 
contribute to a specific neuron's activation.

Updated from IntegratedGradients repository with source_input_part support for
asymmetric attention conditioning (e.g., "query attending to document" vs "document attending to query").
"""

import gc
from enum import Enum
from typing import Optional, Dict
import torch
import numpy as np
import torch.nn.functional as F
from transformers import AutoModelForSequenceClassification, AutoTokenizer 
from tqdm import tqdm      

from utils import (
    InputPart, 
    INPUT_PART_TO_POSITION,
    OutputsExtractor, 
    _get_scaled_inputs, 
    _get_ig_error,
    generate_baseline_with_padded_query_but_special_tokens, 
    get_interesting_modules, 
    get_token_types_spans
)


class NeuronType(Enum):
    ATTENTION = "attention"
    FFN = "ffn"

    def check_idx(self, model, idx: int) -> bool:
        nb_attention_heads = model.config.num_attention_heads
        ffn_dim = model.config.intermediate_size

        if self == NeuronType.ATTENTION:
            return nb_attention_heads > idx >= 0  # Attention heads can be indexed from 0 to num_heads - 1
        else:
            return ffn_dim > idx >= 0  # FFN neurons can be indexed from 0 to ffn_dim - 1
    
    def get_module_name(self, layer_idx: int) -> str:
        if self == NeuronType.ATTENTION:
            return f"bert.encoder.layer.{layer_idx}.attention.self.dropout"
        else:
            return f"bert.encoder.layer.{layer_idx}.intermediate.dense"


def get_layer_idx_from_module_name(module_name: str) -> int:
    """
    Extract the layer index from a module name string.
    Assumes the module name follows the format 'bert.encoder.layer.{layer_idx}...'.
    """
    parts = module_name.split('.')
    try:
        layer_idx_position = parts.index('layer') + 1
        layer_idx = int(parts[layer_idx_position])
        return layer_idx
    except (ValueError, IndexError):
        raise ValueError(f"Invalid module name format: {module_name}")


def conditional_nig(
    model, 
    input_embeddings, 
    token_type_ids,
    attention_mask,
    baseline_embeddings,
    num_reps: int, 
    batch_size: int, 
    layer_idx: int, 
    neuron_idx: int, 
    neuron_type: NeuronType, 
    source_input_part: Optional[InputPart] = None,
    target_input_part: Optional[InputPart] = None,
    spans: Optional[torch.Tensor] = None,
    compute_error: bool = False,
    progress_callback=None,
) -> Dict:
    """
    Compute the attribution (Neuron Integrated Gradients) of each unit for all the interesting modules in the model.

    :param torch.nn.Module model: Model for which to compute the conductance.
    :param torch.Tensor input_embeddings: Embeddings of the input.
    :param torch.Tensor token_type_ids: Token type ids of the input.
    :param torch.Tensor attention_mask: Attention mask on the input.
    :param torch.Tensor baseline_embeddings: Embedding of the baseline for the given input.
    :param int num_reps: Number of iteration to approximate the integrated gradients.
    :param int batch_size: Batch size used for each iteration (true number of steps is batch_size x num_reps).
    :param int layer_idx: The layer index of the target neuron.
    :param int neuron_idx: The index of the target neuron within the layer (between 0 and num_heads-1 for attention / between 0 and ffn_dim-1 for FFN). 
    :param NeuronType neuron_type: The nature of the target neuron (attention or feedforward).
    :param InputPart source_input_part: If provided, condition the attention source to a specific input part.
    :param InputPart target_input_part: If provided, condition the value of the neuron we are interested in to a specific input part.
    :param Tensor spans: If provided, delimitate the spans corresponding to the different input parts.
    :param bool compute_error: Whether to compute the IG approximation error or not.
    :param progress_callback: Optional callback for progress updates (current_step, total_steps).
    :return Dict: Attribution for each activation unit for each layer in the model.
    """

    layer_names, _ = get_interesting_modules(
        model=model,
        list_regex=None  # at this point we don't want to filter the modules for now
    )

    # Access the activation of the target_neuron
    target_layer_name = neuron_type.get_module_name(layer_idx)
    if target_layer_name not in layer_names:
        raise ValueError(f"Target layer {target_layer_name} not found among interesting modules ({layer_names}).")
    
    # Keep only modules up to, and including, the target layer
    idx = layer_names.index(target_layer_name)
    layer_names = layer_names[: idx + 1]

    if "attention" in target_layer_name:
        target_layer_name = target_layer_name.replace("dropout", "attention_probs")

    extractor = OutputsExtractor(
        model=model,
        layer_names=layer_names,
    )

    list_scaled_embeddings = _get_scaled_inputs(
        input_embeddings[0].detach().cpu().numpy(), 
        baseline_embeddings[0].detach().cpu().numpy(), 
        batch_size=batch_size, 
        num_reps=num_reps, 
        device=model.device
    ) 
    all_outputs = list()
    path_gradients = dict()  # Stores the gradient corresponding to each input wrt the output 
    total_steps = len(list_scaled_embeddings)

    for i in tqdm(range(total_steps), desc="Conditional NIG"):
        if progress_callback:
            progress_callback(i, total_steps)
            
        batch_pos_inputs = torch.Tensor(list_scaled_embeddings[i]).to(torch.float)
        batch_pos_inputs.requires_grad = True
        _ = extractor.forward(batch_pos_inputs, token_type_ids=token_type_ids, attention_mask=attention_mask)
    
        target_activation = extractor.outputs_store[target_layer_name]  
        if neuron_type == NeuronType.ATTENTION:
            # For attention, we have a 4D tensor: (batch_size, num_heads, seq_len, seq_len)
            target_neuron_activation = target_activation[:, neuron_idx, :, :]  # Shape (batch_size, seq_len, seq_len)
            if not target_input_part and not source_input_part:
                # Aggregate over all attention positions
                target_spans = (slice(None), slice(None))
            elif not target_input_part:
                target_spans = (slice(None), spans[INPUT_PART_TO_POSITION[str(source_input_part)]])
            elif not source_input_part:
                target_spans = (spans[INPUT_PART_TO_POSITION[str(target_input_part)]], slice(None))
            else:
                target_spans = (spans[INPUT_PART_TO_POSITION[str(target_input_part)]], spans[INPUT_PART_TO_POSITION[str(source_input_part)]])

            target_neuron_activation = torch.sum(target_neuron_activation[:, target_spans[0], target_spans[1]], axis=(1, 2), keepdim=True)                
        else:
            # For FFN, we have a 3D tensor: (batch_size, seq_len, hidden_size)
            target_neuron_activation = target_activation[:, :, neuron_idx] 
            if not target_input_part:
                target_neuron_activation = target_neuron_activation.sum(dim=(1))
            else:
                target_neuron_activation = torch.sum(target_neuron_activation[:, spans[INPUT_PART_TO_POSITION[str(target_input_part)]]], axis=(1), keepdim=True) 

        # Now do a backward pass per input in the batch
        for j in range(batch_pos_inputs.shape[0]):
            extractor.model.zero_grad()

            # Backward from the target neuron activation
            target_neuron_activation[j].backward(retain_graph=True)

            for key, activation in extractor.outputs_store.items():
                grad = activation.grad.detach().cpu()
                value = activation.detach().cpu()

                if i == 0 and j == 0:
                    # Skip baseline point, or init accumulator
                    previous_activations = {}
                    for k in extractor.outputs_store.keys():
                        previous_activations[k] = extractor.outputs_store[k][0].detach().cpu()
                    continue

                # Compute contribution for this step
                diff = value[j] - previous_activations[key]  # shape: [num_neurons]
                prod = diff * grad[j]  # element-wise: shape [num_neurons]

                if key not in path_gradients:
                    path_gradients[key] = prod
                else:
                    path_gradients[key] += prod

            # Save current activations as previous for next step
            for key in previous_activations:
                previous_activations[key] = extractor.outputs_store[key][j].detach().cpu()

    extractor.clear_items()
    extractor.remove_hooks()

    errors = None
    if compute_error and all_outputs:
        errors = dict()
        for key in path_gradients.keys():
            errors[key] = _get_ig_error(path_gradients[key], all_outputs[0][0], all_outputs[-1][-1], debug=False)
            
    gc.collect()
    torch.cuda.empty_cache() 
    return path_gradients, errors


def aggregate_conditional_nig_for_viz(
    nig, 
    sep_position, 
    layer_idx: int,
    neuron_idx: int,
    neuron_type: NeuronType,
    source_input_part: Optional[InputPart] = None,
    target_input_part: Optional[InputPart] = None,
    use_norm=False
):
    """
    Aggregate conditional NIG results into the format expected by the Nig-Viz frontend.
    This mirrors the aggregate_nig function from aggregation.py but is specific to conditional NIG.
    
    Applies NaN masking to indicate which values are not part of the conditional computation:
    - For the target layer: Only the selected neuron_idx has values, others are NaN
    - For attention with source/target filtering: Only the selected input parts have values
    
    Returns numpy arrays in the format:
        - ATTN: [num_heads, 5, 5] (heads × source_parts × target_parts)
        - FFN: [5, ffn_dim] (parts × neurons)
    
    :param nig: Raw NIG gradients dictionary from conditional_nig
    :param sep_position: Position of the first SEP token (used to build masks)
    :param layer_idx: Target layer index for conditional NIG
    :param neuron_idx: Target neuron index within the layer
    :param neuron_type: Type of target neuron (ATTENTION or FFN)
    :param source_input_part: If specified, only this source part has values (attention only)
    :param target_input_part: If specified, only this target part has values
    :param use_norm: Whether to use L2 norm (True) or sum (False) for aggregation
    :return: Dictionary with aggregated numpy arrays (with NaN for masked values)
    """
    detailed_agg = {}
    
    # Map input part names to indices
    input_part_names = ['cls', 'query', 'sep_1', 'document', 'sep_2']

    for key, nig_tensor in nig.items():
        nig_tensor = torch.tensor(nig_tensor) if not isinstance(nig_tensor, torch.Tensor) else nig_tensor
        L = nig_tensor.size(-1) if len(nig_tensor.shape) == 3 else nig_tensor.size(0)
        
        # Get layer index from key
        key_layer_idx = get_layer_idx_from_module_name(key)

        # Token masks (same as aggregate_nig in aggregation.py)
        cls_mask = torch.zeros(L, dtype=torch.bool)
        cls_mask[0] = True
        query_mask = torch.zeros(L, dtype=torch.bool)
        query_mask[1:sep_position] = True
        sep1_mask = torch.zeros(L, dtype=torch.bool)
        sep1_mask[sep_position] = True
        passage_mask = torch.zeros(L, dtype=torch.bool)
        passage_mask[sep_position + 1:-1] = True
        sep2_mask = torch.zeros(L, dtype=torch.bool)
        sep2_mask[-1] = True
        masks = [cls_mask, query_mask, sep1_mask, passage_mask, sep2_mask]

        if len(nig_tensor.shape) == 3:  # ATTN: [num_heads, T, T]
            full = []  # for Subset B: [num_heads, 5, 5]
            for i, src_mask in enumerate(masks):
                row = []
                for j, tgt_mask in enumerate(masks):
                    sub = nig_tensor[:, src_mask, :][:, :, tgt_mask]  # [num_heads, s, t]
                    if sub.numel() == 0:
                        agg = torch.zeros(nig_tensor.size(0))  # [num_heads]
                    else:
                        agg = torch.norm(sub, p=2, dim=(1, 2)) if use_norm else torch.sum(sub, dim=(1, 2))
                    row.append(agg)  # List of [num_heads]
                        
                full.append(torch.stack(row, dim=1))  # [num_heads, 5]
            full_tensor = torch.stack(full, dim=1)  # [num_heads, 5, 5]
            
            # Apply NaN masking for target attention layer
            if key_layer_idx == layer_idx and neuron_type == NeuronType.ATTENTION:
                # Mask all heads except neuron_idx
                nan_mask = torch.ones_like(full_tensor, dtype=torch.bool)
                nan_mask[neuron_idx, :, :] = False
                full_tensor = full_tensor.masked_fill(nan_mask, float('nan'))
                
                # Also mask input parts if specified
                if source_input_part is not None or target_input_part is not None:
                    part_mask = torch.ones_like(full_tensor, dtype=torch.bool)
                    
                    if source_input_part is not None and target_input_part is not None:
                        # Only one cell is valid
                        src_idx = INPUT_PART_TO_POSITION[str(source_input_part)]
                        tgt_idx = INPUT_PART_TO_POSITION[str(target_input_part)]
                        part_mask[neuron_idx, src_idx, tgt_idx] = False
                    elif source_input_part is not None:
                        # Entire source row is valid
                        src_idx = INPUT_PART_TO_POSITION[str(source_input_part)]
                        part_mask[neuron_idx, src_idx, :] = False
                    elif target_input_part is not None:
                        # Entire target column is valid
                        tgt_idx = INPUT_PART_TO_POSITION[str(target_input_part)]
                        part_mask[neuron_idx, :, tgt_idx] = False
                    
                    full_tensor = full_tensor.masked_fill(part_mask, float('nan'))
            
            detailed_agg[key] = full_tensor.numpy()

        elif len(nig_tensor.shape) == 2:  # FFN: [T, ffn_dim]
            rows = []
            for mask in masks:
                masked = nig_tensor[mask, :]
                if masked.numel() == 0:
                    agg = torch.zeros(nig_tensor.size(1))
                else:
                    agg = torch.norm(masked, p=2, dim=0) if use_norm else torch.sum(masked, dim=0)
                rows.append(agg)  # [ffn_dim]
                    
            ffn_tensor = torch.stack(rows, dim=0)  # [5, ffn_dim]
            
            # Apply NaN masking for target FFN layer
            if key_layer_idx == layer_idx and neuron_type == NeuronType.FFN:
                # Mask all neurons except neuron_idx
                nan_mask = torch.ones_like(ffn_tensor, dtype=torch.bool)
                nan_mask[:, neuron_idx] = False
                ffn_tensor = ffn_tensor.masked_fill(nan_mask, float('nan'))
                
                # Also mask input parts if target_input_part is specified
                if target_input_part is not None:
                    part_mask = torch.ones_like(ffn_tensor, dtype=torch.bool)
                    tgt_idx = INPUT_PART_TO_POSITION[str(target_input_part)]
                    part_mask[tgt_idx, neuron_idx] = False
                    ffn_tensor = ffn_tensor.masked_fill(part_mask, float('nan'))
            
            detailed_agg[key] = ffn_tensor.numpy()

    return detailed_agg


def compute_conditional_nig(
    model,
    tokenizer,
    query: str, 
    passage: str, 
    num_reps: int, 
    batch_size: int, 
    layer_idx: int, 
    neuron_idx: int, 
    neuron_type: NeuronType, 
    source_input_part: Optional[InputPart] = None,
    target_input_part: Optional[InputPart] = None,
    max_input_length: int = 128,
    progress_callback=None,
):
    """
    Compute the NIG with respect to a specific hidden state instead of the final output.

    :param model: Pre-loaded model instance.
    :param tokenizer: Pre-loaded tokenizer instance.
    :param query: Query text.
    :param passage: Passage text.
    :param num_reps: Number of iterations to approximate the integrated gradients.
    :param batch_size: Batch size used for each iteration.
    :param layer_idx: Layer index of the target neuron.
    :param neuron_idx: Neuron index within the target layer.
    :param neuron_type: Type of the neuron (ATTENTION or FFN).
    :param source_input_part: If provided, condition attention source to a specific input part.
    :param target_input_part: If provided, condition on a specific input part.
    :param max_input_length: Maximum input length for the model.
    :param progress_callback: Optional callback for progress updates.
    :return: (aggregated_nig, error, sep_position)
    """
    # Validate the target neuron index
    if not neuron_type.check_idx(model, neuron_idx):
        raise ValueError(f"Invalid target neuron index {neuron_idx} for neuron type {neuron_type}.")
    
    if layer_idx >= model.config.num_hidden_layers:
        raise ValueError(f"Invalid target layer index {layer_idx}. Model has {model.config.num_hidden_layers} layers.")

    inputs = tokenizer(
        query,
        passage,
        max_length=max_input_length,
        truncation=True,
        padding="max_length",
        return_attention_mask=True,
        return_tensors="pt"
    ).to(model.device)

    spans = get_token_types_spans(inputs["input_ids"], tokenizer)

    embeddings = model.bert.get_input_embeddings()
    input_embeds = embeddings(inputs["input_ids"])

    # Baseline gradient
    baseline_inputs = inputs.copy()
    baseline_embeds = generate_baseline_with_padded_query_but_special_tokens(
        tokenizer,
        baseline_inputs["input_ids"],
        embeddings,
        model.device
    )

    # Compute conditional NIG
    nig, error = conditional_nig(
        model=model,
        input_embeddings=input_embeds,
        token_type_ids=inputs["token_type_ids"],
        attention_mask=inputs["attention_mask"],
        baseline_embeddings=baseline_embeds,
        num_reps=num_reps,
        batch_size=batch_size,
        layer_idx=layer_idx,
        neuron_idx=neuron_idx,
        neuron_type=neuron_type,
        source_input_part=source_input_part,
        target_input_part=target_input_part,
        spans=spans,
        progress_callback=progress_callback,
    )

    # Calculate sep_position for aggregation (position of first SEP token)
    sep_position = spans[2].start  # sep_1 span starts at the SEP position

    # Aggregate NIG using the viz-specific aggregation function with NaN masking
    aggregated_nig = aggregate_conditional_nig_for_viz(
        nig, 
        sep_position,
        layer_idx=layer_idx,
        neuron_idx=neuron_idx,
        neuron_type=neuron_type,
        source_input_part=source_input_part,
        target_input_part=target_input_part
    )

    return aggregated_nig, error, sep_position


if __name__ == "__main__":
    query = "what was the immediate impact of the success of the manhattan project?"
    passage = "The Manhattan Project and its atomic bomb helped bring an end to World War II. Its legacy of peaceful uses of atomic energy continues to have an impact on history and science."
    max_input_length = 128
    
    # Load the tokenizer
    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
    # Load the model
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained("cross-encoder/ms-marco-MiniLM-L12-v2").to(device)
    model.eval()

    print("Running original forward pass...")
    inputs = tokenizer(
        query,
        passage,
        max_length=max_input_length,
        truncation=True,
        padding="max_length",
        return_attention_mask=True,
        return_tensors="pt"
    ).to(model.device)
    outputs = model(**inputs)
    
    print(f"** Default model output: {outputs} **")
    if model.config.num_labels == 1:
        pos_to_watch = 0
        activation_fct = F.sigmoid
    else:  # Always watch for the positive class
        pos_to_watch = 1
        activation_fct = F.softmax
    score = activation_fct(outputs.logits)[0][pos_to_watch]
    print(f"** From logits to proba: {score} **")
    print(f"** From proba to label: {1 if score >= 0.5 else 0} **")

    print("Running conditional neuron integrated gradients...")
    nig, error, sep_pos = compute_conditional_nig(
        model=model,
        tokenizer=tokenizer,
        query=query, 
        passage=passage, 
        num_reps=10, 
        batch_size=10, 
        max_input_length=max_input_length, 
        layer_idx=2, 
        neuron_idx=5, 
        neuron_type=NeuronType.FFN,
        source_input_part=None,
        target_input_part=InputPart.QUERY
    )
    
    print(f"Conditional NIG computed. Sep position: {sep_pos}")
    print(f"Keys in result: {list(nig.keys())}")
    for key, val in nig.items():
        print(f"  {key}: shape {val.shape}")
