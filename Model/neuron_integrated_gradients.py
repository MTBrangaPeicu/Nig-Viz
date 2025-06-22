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
    progress_callback= None,
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
        list_regex=None # at this point we don't want to filter the modules for now
    )


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

        # Now do a backward pass per input in the batch
        for j in range(batch_pos_inputs.shape[0]):
            extractor.model.zero_grad()

            # Backward from scalar prediction
            current_outputs[j].backward(retain_graph=True)

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

def nig_predict(query, passage, num_reps, batch_size, baseline_function, progress_callback=None):
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

    embeddings = model.bert.get_input_embeddings()
    input_embeds = embeddings(inputs["input_ids"])

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

    return nig, error, sep_position
