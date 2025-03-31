import numpy as np
from tqdm import tqdm

import torch.nn.functional as F

from utils import (
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
    _get_scaled_inputs,
    _calculate_integral,
    _get_ig_error,
    visualize_token_attrs,
)

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

import logging

logging.basicConfig(level=logging.INFO)


def integrated_gradients(
        model,
        input_embeddings,
        token_type_ids,
        attention_mask,
        baseline_embeddings,
        num_reps,
        batch_size,
        num_labels,
):
    """
    Compute the Integrated Gradients for a given input.

    :param _type_ input_embeddings: Embedding of the input.
    :param _type_ token_type_ids: Token type ids of the input.
    :param _type_ attention_mask: Attention mask for the input.
    :param _type_ baseline_embeddings: Embedding of the baseline for the input.
    :param _type_ num_reps: Number of forward pass.
    :param _type_ batch_size: Number of samples seen by the model in a forward pass (total nb of steps for IG is num_reps x batch_size).
    :param _type_ num_labels: Number of output labels for the model.
    """
    if num_labels == 1:
        pos_to_watch = 0
        activation_fct = lambda x, dim: x
    else: # Always watch for the positive class
        pos_to_watch = 1
        activation_fct = F.softmax

    list_scaled_embeddings = _get_scaled_inputs(
        input_embeddings[0].cpu().detach().numpy(),
        baseline_embeddings[0].cpu().detach().numpy(),
        batch_size=batch_size,
        num_reps=num_reps,
        device=model.device,
    )

    scores = list()  # Stores the scores for each input between the baseline and the original input
    path_gradients = list()  # Stores the gradient corresponding to each input wrt the output

    for i in tqdm(range(num_reps)):
        batch_inputs = torch.Tensor(list_scaled_embeddings[i]).to(torch.float)
        batch_inputs.requires_grad = True
        outputs = model(inputs_embeds=batch_inputs, token_type_ids=token_type_ids, attention_mask=attention_mask)
        outputs = activation_fct(outputs.logits, dim=-1)
        sum_outputs = torch.sum(outputs, dim=0)

        model.zero_grad()
        sum_outputs[pos_to_watch].backward()
        path_gradients.append(batch_inputs.grad.data)
        scores.append(outputs)

    baseline_prediction = scores[0][0]
    prediction = scores[-1][-1]

    #
    # Compute the integral and get the integrated gradients
    #
    ig = torch.cat(path_gradients, dim=0)
    integral = _calculate_integral(ig)
    integrated_gradients = (
        input_embeddings[0].cpu().detach().numpy() - 
        baseline_embeddings[0].cpu().detach().numpy()
    ) * integral.cpu().detach().numpy()
    integrated_gradients = np.sum(integrated_gradients, axis=-1)
    print(integrated_gradients)

    _get_ig_error(integrated_gradients, baseline_prediction[pos_to_watch], prediction[pos_to_watch], debug=True)
    return integrated_gradients


def predict(query, passage, num_reps, batch_size):
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

    embeddings = model.bert.get_input_embeddings()
    input_embeds = embeddings(inputs["input_ids"])

    # Baseline gradient
    logging.info("### Baseline ###")
    baseline_inputs = inputs.copy()
    baseline_embeds = generate_baseline_with_padded_query_and_passage_but_special_tokens(
        tokenizer,
        baseline_inputs["input_ids"],
        embeddings,
        device
    )

    ig = integrated_gradients(
        model=model,
        input_embeddings=input_embeds,
        token_type_ids=inputs["token_type_ids"],
        attention_mask=inputs["attention_mask"],
        baseline_embeddings=baseline_embeds,
        num_reps=num_reps,
        batch_size=batch_size,
        num_labels=num_labels,
    )

    tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
    return {"tokens": tokens, "attributions": ig}
