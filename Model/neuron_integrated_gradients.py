from typing import Dict
import numpy as np
import torch
import torch.nn.functional as F
from tqdm import tqdm
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import gc
from utils import (
    OutputsExtractor, 
    _get_ig_error, 
    _get_scaled_inputs, 
    get_interesting_modules
)


def neuron_integrated_gradients(
    model, 
    input_embeddings, 
    token_type_ids,
    attention_mask,
    baseline_embeddings,
    num_reps: int, 
    batch_size: int, 
    num_labels: int,
    compute_error: bool = False,
    progress_callback=None,
) -> Dict:
    """
    Compute the attribution (Neuron Integrated Gradients) of each unit for all the interesting modules in the model.

    :param torch.nn.Module model: Model for which to compute the conductance.
    :param torch.Tensor input_embeddings: Embeddings of the input.
    :param torch.Tensor token_type_ids: Token type ids of the input.
    :param torch.Tensor attention_mask: ATtention mask on the input.
    :param torch.Tensor baseline_embeddings: Embedding of the baseline for the given input.
    :param int num_label: Number of output labels for the model.
    :param int num_reps: Number of iteration to approximate the integrated gradients.
    :param int batch_size: Batch size used for each iteration (true number of steps is batch_size x num_reps).
    :param progress_callback: Optional callback function to report progress.
    :return Dict: Attribution for each activation unit for each layer in the model.
    """
    if num_labels == 1:
        pos_to_watch = 0
        activation_fct = lambda x, dim: x
    else: # Always watch for the positive class
        pos_to_watch = 1
        activation_fct = F.softmax

    layer_names, _ = get_interesting_modules(
        model=model,
    )

    #print(layer_names)
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
    path_gradients = dict() # Stores the gradient corresponding to each input wrt the output 

    for i in tqdm(range(len(list_scaled_embeddings))):
        batch_pos_inputs = torch.Tensor(list_scaled_embeddings[i]).to(torch.float)
        batch_pos_inputs.requires_grad = True
        current_outputs = extractor.forward(batch_pos_inputs, token_type_ids=token_type_ids, attention_mask=attention_mask)
       
        current_outputs = activation_fct(current_outputs.logits, dim=-1)
        all_outputs.append(current_outputs[:,pos_to_watch]) # Store all the outputs in case we need to compute the error
        sum_output = torch.sum(current_outputs, dim=0)
        extractor.model.zero_grad()
        sum_output[pos_to_watch].backward()

        for key, value in extractor.outputs_store.items():
            if i == 0:
                # We don't care about this step as the first one is the baseline
                pass
            else:
                # Then, we compute the integral, which means we need to access the previous step's outputs 
                # and the current ones, from the extractor
                diff = (value.detach().cpu() - extractor.previous_outputs_store[key]) # Diff between the current and previous outputs
                prod = diff * value.grad.data.detach().cpu() # Multiply this diff by the current gradient
                # Store the product and accumulate them along the path
                path_gradients[key] = prod if i == 1 else path_gradients[key] + prod 
        
        # Progress callback after each predict call
        if progress_callback is not None:
            progress_callback(i + 1, num_reps)

    extractor.clear_items()
    extractor.remove_hooks()

    if compute_error:
        errors = dict()
        for key in path_gradients.keys():
           errors[key] = _get_ig_error(path_gradients[key], all_outputs[0][0], all_outputs[-1][-1], debug=False)
            
    gc.collect()
    torch.cuda.empty_cache() 
    return path_gradients, errors if compute_error else None           

def aggregate_nig(nig, sep_position=None, use_norm=False):
    """ 
    Aggregate the neuron importance values into a single value per neuron for each token type.
    
    :param nig: Dictionary of neuron importance values.
    :param sep_position: Position of the first SEP token (int).
    :param use_norm: Whether to use L2 norm for aggregation.
    :return: Aggregated neuron importance values with shape (384, 5) if sep_position is provided, else (384,).
    """
    aggregated_nig = {}
    for key, nig_tensor in nig.items():
        nig_tensor = nig_tensor.clone().detach()
        
        if sep_position is not None:
            # Define masks based on token positions
            cls_mask = torch.zeros(nig_tensor.size(1), dtype=torch.bool)
            cls_mask[0] = True  # CLS token is always at position 0

            query_mask = torch.zeros(nig_tensor.size(1), dtype=torch.bool)
            query_mask[1:sep_position] = True  # Query tokens are between CLS and the first SEP

            sep1_mask = torch.zeros(nig_tensor.size(1), dtype=torch.bool)
            sep1_mask[sep_position] = True  # First SEP token

            passage_mask = torch.zeros(nig_tensor.size(1), dtype=torch.bool)
            passage_mask[sep_position + 1:-1] = True  # Passage tokens are between the first and second SEP

            sep2_mask = torch.zeros(nig_tensor.size(1), dtype=torch.bool)
            sep2_mask[-1] = True  # Second SEP token

            # Aggregate for each token type
            masks = [cls_mask, query_mask, sep1_mask, passage_mask, sep2_mask]
            token_type_values = []
            for mask in masks:
                masked_tensor = nig_tensor[:, mask]  # Apply mask to filter tokens
                if use_norm:
                    aggregated = torch.norm(masked_tensor, p=2, dim=1)  # L2 norm over tokens
                else:
                    aggregated = torch.sum(masked_tensor, dim=1)  # Sum over tokens
                token_type_values.append(torch.mean(aggregated, dim=0))  # Mean over batch

            # Stack values for all token types
            aggregated_nig[key] = torch.stack(token_type_values, dim=0).numpy()  # Shape: (384, 5)
        else:
            # Aggregate across all tokens if sep_position is not provided
            if use_norm:
                nig_aggregated = torch.norm(nig_tensor, p=2, dim=1)  # L2 norm over tokens
            else:
                nig_aggregated = torch.sum(nig_tensor, dim=1)  # Sum over tokens
            aggregated_nig[key] = torch.mean(nig_aggregated, dim=0).numpy()  # Shape: (384,)

    return aggregated_nig

def nig_predict(query, passage, num_reps, batch_size, baseline_function,split_by_type, progress_callback=None):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForSequenceClassification.from_pretrained("cross-encoder/ms-marco-MiniLM-L12-v2").to(device)
    model.eval()

    num_labels = model.config.num_labels

    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

    inputs = tokenizer(
        query,
        passage,
        max_length=512,
        truncation=True,
        padding=True,
        return_attention_mask=True,
        return_tensors="pt"
    ).to(model.device)

    print(inputs["input_ids"])  

    # Find the position of the first [SEP] token
    sep_token_id = tokenizer.sep_token_id
    sep_position = (inputs["input_ids"] == sep_token_id).nonzero(as_tuple=True)[1][0].item()
    print(f"Position of the first [SEP] token: {sep_position}")

    embeddings = model.bert.get_input_embeddings()
    input_embeds = embeddings(inputs["input_ids"])

    print(input_embeds.shape)  

    # Baseline gradient
    baseline_inputs = inputs.copy()
    baseline_embeds = baseline_function(
        tokenizer,
        baseline_inputs["input_ids"],
        embeddings,
        device

    )

    nig, error = neuron_integrated_gradients(
        model=model,
        input_embeddings=input_embeds,
        token_type_ids=inputs["token_type_ids"],
        attention_mask=inputs["attention_mask"],
        baseline_embeddings=baseline_embeds,
        num_reps=num_reps,
        batch_size=batch_size,
        num_labels=num_labels,
        progress_callback=progress_callback,
    )

    print(nig.keys())
    print(nig["bert.encoder.layer.0.attention.self.attention_probs"].shape)
    print(nig["bert.encoder.layer.0.intermediate.dense"].shape)
    if split_by_type:
         final_nig = aggregate_nig(nig, sep_position)      
    else:
        final_nig = aggregate_nig(nig)

    return final_nig, error
