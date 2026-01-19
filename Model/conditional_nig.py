"""
Conditional Neuron Integrated Gradients (NIG)

Computes NIG with respect to a specific target neuron (attention head or FFN neuron)
instead of the final model output. This allows understanding what input features 
contribute to a specific neuron's activation.
"""

import gc
from enum import Enum
from typing import Optional, Dict
import torch
import torch.nn.functional as F
from transformers import AutoModelForSequenceClassification, AutoTokenizer 
from tqdm import tqdm      

from utils import (
    InputPart, 
    INPUT_PART_TO_POSITION,
    OutputsExtractor, 
    _get_scaled_inputs, 
    generate_baseline_with_padded_query_but_special_tokens, 
    get_interesting_modules, 
    get_token_types_spans
)
from aggregation import aggregate_nig


class NeuronType(Enum):
    ATTENTION = "attention"
    FFN = "ffn"

    def check_idx(self, model, idx: int) -> bool:
        nb_attention_heads = model.config.num_attention_heads
        ffn_dim = model.config.intermediate_size

        if self == NeuronType.ATTENTION:
            return nb_attention_heads > idx >= 0
        else:
            return ffn_dim > idx >= 0
    
    def get_module_name(self, layer_idx: int) -> str:
        if self == NeuronType.ATTENTION:
            return f"bert.encoder.layer.{layer_idx}.attention.self.dropout"
        else:
            return f"bert.encoder.layer.{layer_idx}.intermediate.dense"


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
    target_input_part: Optional[InputPart] = None,
    spans: Optional[torch.Tensor] = None,
    compute_error: bool = False,
    progress_callback=None,
) -> Dict:
    """
    Compute the attribution (Neuron Integrated Gradients) of each unit for all the 
    interesting modules up to and including the target neuron.

    :param model: Model for which to compute the conductance.
    :param input_embeddings: Embeddings of the input.
    :param token_type_ids: Token type ids of the input.
    :param attention_mask: Attention mask on the input.
    :param baseline_embeddings: Embedding of the baseline for the given input.
    :param num_reps: Number of iterations to approximate the integrated gradients.
    :param batch_size: Batch size used for each iteration.
    :param layer_idx: The layer index of the target neuron.
    :param neuron_idx: The index of the target neuron within the layer.
    :param neuron_type: The type of the target neuron (ATTENTION or FFN).
    :param target_input_part: If provided, condition on a specific input part.
    :param spans: Token spans for each input part.
    :param compute_error: Whether to compute the IG approximation error.
    :param progress_callback: Optional callback for progress updates.
    :return: Attribution for each activation unit for each layer in the model.
    """
    if spans is None and target_input_part is not None:
        raise ValueError("If target_input_part is specified, spans must also be provided.")
    if spans is not None and target_input_part is None:
        raise ValueError("If spans are provided, target_input_part must also be specified.")

    layer_names_dict, _ = get_interesting_modules(model=model, list_regex=None)
    layer_names = list(layer_names_dict.keys())  # Convert dict keys to list

    # Access the activation of the target neuron
    target_layer_name = neuron_type.get_module_name(layer_idx)
    if target_layer_name not in layer_names:
        raise ValueError(f"Target layer {target_layer_name} not found among interesting modules.")
    
    # Keep only modules up to, and including, the target layer
    idx = layer_names.index(target_layer_name)
    layer_names = layer_names[: idx + 1]

    if "attention" in target_layer_name:
        target_layer_name = target_layer_name.replace("dropout", "attention_probs")

    extractor = OutputsExtractor(model=model, layer_names=layer_names)

    list_scaled_embeddings = _get_scaled_inputs(
        input_embeddings[0].detach().cpu().numpy(), 
        baseline_embeddings[0].detach().cpu().numpy(), 
        batch_size=batch_size, 
        num_reps=num_reps, 
        device=model.device
    ) 
    
    all_outputs = []
    path_gradients = {}
    previous_activations = {}
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
            target_neuron_activation = target_activation[:, neuron_idx, :, :]
            if not target_input_part:
                # Aggregate over all attention positions
                target_neuron_activation = target_neuron_activation.sum(dim=(1, 2))
            else:        
                part_idx = INPUT_PART_TO_POSITION[str(target_input_part)]
                target_neuron_activation = torch.sum(
                    target_neuron_activation[:, spans[part_idx], spans[part_idx]], 
                    axis=(1, 2), 
                    keepdim=True
                )                
        else:
            # For FFN, we have a 3D tensor: (batch_size, seq_len, hidden_size)
            target_neuron_activation = target_activation[:, :, neuron_idx] 
            if not target_input_part:
                target_neuron_activation = target_neuron_activation.sum(dim=1)
            else:
                part_idx = INPUT_PART_TO_POSITION[str(target_input_part)]
                target_neuron_activation = torch.sum(
                    target_neuron_activation[:, spans[part_idx]], 
                    axis=1, 
                    keepdim=True
                ) 

        # Backward pass per input in the batch
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
        errors = {}
        for key in path_gradients.keys():
            from utils import _get_ig_error
            errors[key] = _get_ig_error(path_gradients[key], all_outputs[0][0], all_outputs[-1][-1], debug=False)
            
    gc.collect()
    torch.cuda.empty_cache() 
    return path_gradients, errors


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
    :param target_input_part: If provided, condition on a specific input part.
    :param max_input_length: Maximum input length for the model.
    :param progress_callback: Optional callback for progress updates.
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
        target_input_part=target_input_part,
        spans=spans if target_input_part is not None else None,
        progress_callback=progress_callback,
    )

    # Calculate sep_position for aggregation (position of first SEP token)
    sep_position = spans[2].start  # sep_1 span starts at the SEP position

    # Aggregate NIG using the aggregation function that takes sep_position
    aggregated_nig = aggregate_nig(nig, sep_position)

    return aggregated_nig, error, sep_position
