import torch
import numpy as np
from transformers import AutoTokenizer
from typing import Callable, Iterable, Dict, List, Optional, Tuple
import gc
import json

import logging

logging.basicConfig(level=logging.INFO)

INPUT_PART_TO_POSITION = {"cls": 0, "query": 1, "sep_1": 2, "document": 3, "sep_2": 4}

def filter_module(module: str, keywords: List[str]):
    return any(word in module for word in keywords)

def get_interesting_modules(model, list_regex: Optional[List[str]] = None) -> Dict:
    """
    Returns a dictionnary containing the name of the interesting modules in the model.

    :return Dict: Dictionnary where the key is the module's name and the value is the number of out features.
    """
    interesting_layers = ["self.dropout", "intermediate.dense"]
    neurons_per_layers = dict() 
    total_nb_of_neurons = 0
    for name, module in model.named_modules():
        if any(word in name for word in interesting_layers):
            if list_regex is not None:
                if filter_module(name, list_regex):
                    if hasattr(module, 'out_features'):
                        neurons_per_layers[name] = module.out_features
                        total_nb_of_neurons += module.out_features
                    else:
                        # This corresponds to the dropout which is in fact used to target the attention_probs of shape [batch_size, num_heads, seq_length, seq_length].
                        # So number of neurons here is: num_heads * seq_length.
                        neurons_per_layers[name] = model.config.num_attention_heads 
                        total_nb_of_neurons += model.config.num_attention_heads
            else:
                if hasattr(module, 'out_features'):
                    neurons_per_layers[name] = module.out_features
                    total_nb_of_neurons += module.out_features
                else:
                    neurons_per_layers[name] = model.config.num_attention_heads
                    total_nb_of_neurons += model.config.num_attention_heads

    return neurons_per_layers, total_nb_of_neurons

def get_token_types_spans(input, tokenizer) -> List[Tuple]:
    """Returns a list of spans corresponding to the positions in the input
    of respectively, the CLS token, the query's tokens, the document's tokens and the SEP tokens.

    """
    slices = [slice(0,1)] # Initiate the spans with the position of the CLS token
    input_splitted = split_list_by_values(np.array(input[0].cpu()), [tokenizer.sep_token_id])
    query_len = len(input_splitted[0]) - 2 # -1 to account for the CLS token and the first SEP token
    document_len = len(input_splitted[1]) - 1 # -1 to account for the second SEP token
    slices.append(slice(1, query_len + 1)) # The query's tokens
    slices.append(slice(query_len + 1, query_len + 2)) # The first SEP token
    slices.append(slice(query_len + 2, query_len + 2 + document_len)) # The document's tokens
    slices.append(slice(query_len + 2 + document_len, query_len + 2 + document_len + 1)) # The second SEP token
    return slices

def parse_layer_head(name):
    parts = name.split('.')
    layer_num = int(parts[3])  # 'layer.0' → index 3
    head_num = int(parts[-1])  # 'attention_probs.0' → last index
    return layer_num, head_num

class NumpyArrayEncoder(json.JSONEncoder):
    # Special class used to encode numpy array into json files
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return super(NumpyArrayEncoder, self).default(obj)


def untuple(x):
    return x[0] if isinstance(x, tuple) else x


class OutputsExtractor(torch.nn.Module):
    # Hook to extract the outputs of some modules
    def __init__(self, model: torch.nn.Module, layer_names: Iterable[str]):
        super().__init__()
        self.model = model
        self.outputs_store = dict()
        self.hooks_handles = list()

        for layer_name in layer_names:
            layer = dict([*self.model.named_modules()])[layer_name]
            if "dropout" in layer_name:
                self.hooks_handles.append(layer.register_forward_hook(self.get_attention_probs(layer_name)))
            else:
                self.hooks_handles.append(layer.register_forward_hook(self.save_outputs_hooks(layer_name)))

    def save_outputs_hooks(self, name) -> Callable:
        def hook(_, __, output):
            if not name in self.outputs_store.keys():
                # If self.pos_outputs is empty, it means we are at the first forward pass
                self.outputs_store[name] = untuple(output) # Store it and prepares it for backprop
                self.outputs_store[name].retain_grad()
            else:
                # Else, we store the previous output and the current one
                self.outputs_store[name] = untuple(output) # Store it and prepares it for backprop
                self.outputs_store[name].retain_grad()

        return hook
    
    def get_attention_probs(self, name) -> Callable:
        # This hook is used to get to the `attention_probs`` (see SelfAttention module in modeling_bert.py in
        # the transformers library). As this is the input of the self.dropout, we can access it through the hook.
        def hook(_, input, __):
            nonlocal name
            new_name = name.replace("dropout", "attention_probs")
            if not new_name in self.outputs_store.keys():
                # If self.pos_outputs is empty, it means we are at the first forward pass
                self.outputs_store[new_name] = untuple(input) # Store it and prepares it for backprop
                self.outputs_store[new_name].retain_grad()
            else:
                # Else, we store the previous output and the current one
                self.outputs_store[new_name] = untuple(input) # Store it and prepares it for backprop
                self.outputs_store[new_name].retain_grad()
            
        return hook

    def remove_hooks(self):
        for handle in self.hooks_handles:
            handle.remove()

    def clear_items(self):
        del self.outputs_store
        gc.collect()
        torch.cuda.empty_cache()
        self.outputs_store = dict()

    def forward(self, inputs_embeddings, token_type_ids, attention_mask):
        model_outputs = self.model(
            inputs_embeds=inputs_embeddings, 
            token_type_ids=token_type_ids,
            attention_mask=attention_mask
        )
        return model_outputs


def split_list_by_values(lst: List, values: List) -> List:
    """
    Split a list of integers based on specified values.

    :param List lst: List of integers to be split.
    :param List values: List of values to use as split points.
    :return List: A list of lists where the original list is split at each specified value.
    """
    result = []
    current_chunk = []

    for item in lst:
        current_chunk.append(item)
        if item in values:
            if current_chunk:
                result.append(current_chunk)
                current_chunk = []

    if current_chunk:
        result.append(current_chunk)

    return result

def generate_baseline_with_only_padded_tokens(tokenizer: AutoTokenizer, input, model_embedding, device: torch.DeviceObjType):
    baseline = list()
    for token in input[0]:
        baseline.append(tokenizer.pad_token_id)
    return model_embedding(torch.Tensor([baseline]).to(torch.int).to(device))

def generate_baseline_with_padded_query_and_passage_but_special_tokens(tokenizer: AutoTokenizer, input, model_embedding, device: torch.DeviceObjType):
    baseline = list()
    input_splitted = split_list_by_values(np.array(input[0].cpu()), [tokenizer.sep_token_id])
    for token in input_splitted[0]:
        if token == tokenizer.cls_token_id:
            baseline.append(token)
        elif token == tokenizer.sep_token_id:
            baseline.append(token)
        else:
            baseline.append(tokenizer.pad_token_id)
    for token in input_splitted[1]:
        if token == tokenizer.cls_token_id:
            baseline.append(token)
        elif token == tokenizer.sep_token_id:
            baseline.append(token)
        else:
            baseline.append(tokenizer.pad_token_id)
    return model_embedding(torch.Tensor([baseline]).to(torch.int).to(device))


def generate_baseline_with_padded_query_but_special_tokens(tokenizer: AutoTokenizer, input, model_embedding, device: torch.DeviceObjType):
    baseline = list()
    input_splitted = split_list_by_values(np.array(input[0].cpu()), [tokenizer.sep_token_id])
    for token in input_splitted[0]:
        if token == tokenizer.cls_token_id:
            baseline.append(token)
        elif token == tokenizer.sep_token_id:
            baseline.append(token)
        else:
            baseline.append(tokenizer.pad_token_id)
    if len(input_splitted) == 3:
        baseline.extend(input_splitted[1]+input_splitted[2])
    else:
        baseline.extend(input_splitted[1])
    return model_embedding(torch.Tensor([baseline]).to(torch.int).to(device))


def _get_scaled_inputs(input_tensor, baseline_tensor, batch_size, num_reps, device):
    """
    Create `num_reps` groups of `batch_size` vectors of embeddings spanning between the 
    baseline and the input to analyze. If needed (variable `translate`), one can decide 
    to shift every embedding produced by this method by substracting the embeddings of
    the baseline to ensure we are close to 0 for the prediction associated with it.

    This function comes from the repository Integrated-Gradients:
    https://github.com/ankurtaly/Integrated-Gradients/blob/master/BertModel/bert_model_utils.py#L275
    """
    list_scaled_embeddings = []

    scaled_embeddings = \
        [baseline_tensor + (float(i) / (num_reps * batch_size - 1)) *
        (input_tensor - baseline_tensor) for i in range(0, num_reps * batch_size)]

    for i in range(num_reps):
        list_scaled_embeddings.append(
            torch.Tensor(np.array((scaled_embeddings[i * batch_size:i * batch_size +
                                                      batch_size]))).to(torch.float).to(device)
        )

    return list_scaled_embeddings



def _calculate_integral(ig):
    """
    This function comes from the repository Integrated-Gradients:
    https://github.com/ankurtaly/Integrated-Gradients/blob/master/BertModel/bert_model_utils.py#L295
    """
    # We use np.average here since the width of each
    # step rectangle is 1/number of steps and the height is the gradient,
    # so summing the areas is equivalent to averaging the gradient values.

    ig = (ig[:-1] + ig[1:]) / 2.0  # trapezoidal rule

    integral = torch.mean(ig, dim=0)

    return integral


def _get_ig_error(integrated_gradients, baseline_prediction, prediction,
                  debug=False):
    """
    This function comes from the repository Integrated-Gradients:
    https://github.com/ankurtaly/Integrated-Gradients/blob/master/BertModel/bert_model_utils.py#L256
    """
    sum_attributions = np.sum(integrated_gradients)

    delta_prediction = prediction - baseline_prediction

    error_percentage = \
        100 * (delta_prediction - sum_attributions) / delta_prediction
    if debug:
        logging.info(f'prediction is {prediction}')
        logging.info(f'baseline_prediction is {baseline_prediction}')
        logging.info(f'delta_prediction is {delta_prediction}')
        logging.info(f'sum_attributions are {sum_attributions}')
        logging.info(f'Error percentage is {error_percentage}')

    return error_percentage


def visualize_token_attrs(tokens, attrs, html_file=None):
    """
      Visualize attributions for given set of tokens.
      Args:
      - tokens: An array of tokens
      - attrs: An array of attributions, of same size as 'tokens',
        with attrs[i] being the attribution to tokens[i]

      Saves the HTML text into `html_file`.
    """

    def get_color(attr):
        if attr > 0:
            g = int(128 * attr) + 127
            b = 128 - int(64 * attr)
            r = 128 - int(64 * attr)
        else:
            g = 128 + int(64 * attr)
            b = 128 + int(64 * attr)
            r = int(-128 * attr) + 127
        return r, g, b

    # normalize attributions for visualization.
    bound = max(abs(attrs.max()), abs(attrs.min()))
    attrs = attrs / bound
    html_text = ""
    for i, tok in enumerate(tokens):
        r, g, b = get_color(attrs[i])
        html_text += " <span style='color:rgb(%d,%d,%d)'>%s</span>" % \
                     (r, g, b, tok)
    if html_file is None:
        return html_text
    else:
        html_file = open(html_file, "w")
        html_file.write(html_text)
        html_file.close()