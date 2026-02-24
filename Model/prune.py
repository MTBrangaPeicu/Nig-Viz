import torch
from neuron_integrated_gradients import nig_predict

def get_masks(nig_model, pruning_percentage_attention: float, pruning_percentage_ffn: float, 
              pruning_rules=None, pruning_targets=None, pruning_edges=None, sep_position=None):
    """
    Get pruning masks from your original NIG data structure.
    nig_model contains raw tensors for each layer.
    
    Args:
        nig_model: Raw NIG tensors per layer
        pruning_percentage_attention: Percentage of attention heads to prune based on thresholds
        pruning_percentage_ffn: Percentage of FFN neurons to prune based on thresholds  
        pruning_rules: List of rules like [{"layer": "L2_ATTN", "tokenType": "all"}]
        pruning_targets: List of specific targets like [{"layer": "L2_ATTN", "index": 5, "tokenType": "doc", "type": "ATTN"}]
        pruning_edges: List of edges like [{"layer": "L2_ATTN", "srcToken": "cls", "tgtToken": "doc"}]
        sep_position: Position of [SEP] token to map token types to indices
    """
    if pruning_rules is None:
        pruning_rules = []
    if pruning_targets is None:
        pruning_targets = []
    if pruning_edges is None:
        pruning_edges = []
        
    # Token type mapping (same as frontend)
    token_types = ['cls', 'qry', 'sep1', 'doc', 'sep2']
    
    # Handle your original NIG data structure - raw tensors per layer
    attention_values = []
    ffn_values = []
    
    # Process all layers and collect values for threshold calculation
    for key, tensor in nig_model.items():
        if not isinstance(tensor, torch.Tensor):
            tensor = torch.tensor(tensor)
            
        if "attention_probs" in key:
            # For attention layers, flatten the tensor and collect all values
            attention_values.append(tensor.flatten())
        else:
            # For FFN layers, flatten the tensor and collect all values  
            ffn_values.append(tensor.flatten())
    
    # Calculate thresholds - we want to PRUNE the TOP neurons (most relevant)
    if attention_values:
        attention_all_values = torch.cat(attention_values, dim=0)
        attention_sorted = torch.sort(attention_all_values, descending=True).values  # Sort descending for top values
        if pruning_percentage_attention > 0:
            attention_threshold_idx = int(pruning_percentage_attention * len(attention_sorted))
            attention_threshold_value = attention_sorted[attention_threshold_idx] if attention_threshold_idx < len(attention_sorted) else attention_sorted[-1]
        else:
            attention_threshold_value = attention_sorted[0] + 1  # Keep all if no pruning
    else:
        attention_threshold_value = float('inf')
        
    if ffn_values:
        ffn_all_values = torch.cat(ffn_values, dim=0) 
        ffn_sorted = torch.sort(ffn_all_values, descending=True).values  # Sort descending for top values
        if pruning_percentage_ffn > 0:
            ffn_threshold_idx = int(pruning_percentage_ffn * len(ffn_sorted))
            ffn_threshold_value = ffn_sorted[ffn_threshold_idx] if ffn_threshold_idx < len(ffn_sorted) else ffn_sorted[-1]
        else:
            ffn_threshold_value = ffn_sorted[0] + 1  # Keep all if no pruning
    else:
        ffn_threshold_value = float('inf')

    # Create the expected structure for pruned_forward.py  
    top_neurons_per_layer_model = {}
    
    for key, tensor in nig_model.items():
        if not isinstance(tensor, torch.Tensor):
            tensor = torch.tensor(tensor)
            
        # Extract layer information from key (e.g., "bert.encoder.layer.2.attention.self.attention_probs")
        layer_match = None
        layer_num = None
        is_attention = False
        
        if "encoder.layer." in key:
            parts = key.split(".")
            for i, part in enumerate(parts):
                if part == "layer" and i + 1 < len(parts):
                    layer_num = int(parts[i + 1])
                    break
            is_attention = "attention_probs" in key
        
        if layer_num is None:
            continue
            
        layer_key = f"L{layer_num}_{'ATTN' if is_attention else 'FFN'}"
        top_neurons_per_layer_model[key] = {}
        
        if is_attention:
            # For attention: create binary mask where 0 means PRUNE (top values) 
            # The pruned_forward.py multiplies with this mask, so 0 = prune, 1 = keep
            # Use strict > to prune exactly the top X% of values
            prune_mask = (tensor > attention_threshold_value).int()
            keep_mask = 1 - prune_mask  # Invert: 0 to prune top neurons, 1 to keep others
            
            # Apply pruning rules, targets, and edges for attention
            keep_mask = apply_pruning_rules_attention(
                keep_mask, tensor, layer_key, pruning_rules, pruning_targets, pruning_edges, sep_position
            )
            
            top_neurons_per_layer_model[key]["all"] = keep_mask
        else:
            # For FFN: get indices of neurons to prune (top values)
            # Use strict > to prune exactly the top X% of values
            prune_positions = (tensor > ffn_threshold_value).nonzero().squeeze()
            if len(prune_positions.shape) == 0:
                prune_positions = prune_positions.unsqueeze(0)
            elif len(prune_positions.shape) > 1:
                # Handle case where nonzero returns 2D tensor - flatten to 1D
                prune_positions = prune_positions.flatten()
                
            # Apply pruning rules and targets for FFN
            additional_prune_positions = apply_pruning_rules_ffn(
                tensor, layer_key, pruning_rules, pruning_targets, sep_position
            )
            
            # Combine threshold-based and rule-based pruning
            if len(additional_prune_positions) > 0:
                # Ensure both tensors are 1D before concatenation
                if len(prune_positions.shape) == 0:
                    prune_positions = prune_positions.unsqueeze(0)
                if len(additional_prune_positions.shape) == 0:
                    additional_prune_positions = additional_prune_positions.unsqueeze(0)
                    
                all_prune_positions = torch.cat([prune_positions, additional_prune_positions])
                prune_positions = torch.unique(all_prune_positions)
            
            top_neurons_per_layer_model[key]["all"] = prune_positions

    return top_neurons_per_layer_model


def get_masks_from_aggregated(subset_b, seq_len, sep_position, 
                               pruning_percentage_attention=0.0, pruning_percentage_ffn=0.0,
                               pruning_rules=None, pruning_targets=None, pruning_edges=None):
    """
    Get pruning masks from aggregated NIG data (subset_b) retrieved from MongoDB.
    
    Args:
        subset_b: Dict of aggregated NIG values per layer
                  - Attention: [num_heads, 5, 5] where 5 = [cls, qry, sep1, doc, sep2]
                  - FFN: [5, hidden_size]
        seq_len: Actual sequence length from tokenizer
        sep_position: Position of first [SEP] token
        pruning_percentage_attention: Percentage of top attention values to prune
        pruning_percentage_ffn: Percentage of top FFN neurons to prune
        pruning_rules: List of rules like [{"layer": "L2_ATTN", "tokenType": "all"}]
        pruning_targets: List of specific targets
        pruning_edges: List of edges
    """
    if pruning_rules is None:
        pruning_rules = []
    if pruning_targets is None:
        pruning_targets = []
    if pruning_edges is None:
        pruning_edges = []
    
    # Token type indices: 0=cls, 1=qry, 2=sep1, 3=doc, 4=sep2
    TOKEN_TYPE_MAP = {'cls': 0, 'qry': 1, 'sep1': 2, 'doc': 3, 'sep2': 4}
    
    # Collect all values for threshold calculation
    attention_values = []
    ffn_values = []
    
    for key, agg_tensor in subset_b.items():
        if not isinstance(agg_tensor, torch.Tensor):
            agg_tensor = torch.tensor(agg_tensor)
        if "attention_probs" in key:
            attention_values.append(agg_tensor.flatten())
        else:
            ffn_values.append(agg_tensor.flatten())
    
    # Calculate thresholds
    if attention_values and pruning_percentage_attention > 0:
        attention_all = torch.cat(attention_values)
        attention_sorted = torch.sort(attention_all, descending=True).values
        threshold_idx = int(pruning_percentage_attention * len(attention_sorted))
        attention_threshold = attention_sorted[min(threshold_idx, len(attention_sorted)-1)]
    else:
        attention_threshold = float('inf')
    
    if ffn_values and pruning_percentage_ffn > 0:
        ffn_all = torch.cat(ffn_values)
        ffn_sorted = torch.sort(ffn_all, descending=True).values
        threshold_idx = int(pruning_percentage_ffn * len(ffn_sorted))
        ffn_threshold = ffn_sorted[min(threshold_idx, len(ffn_sorted)-1)]
    else:
        ffn_threshold = float('inf')
    
    # Build masks
    top_neurons_per_layer = {}
    
    for key, agg_tensor in subset_b.items():
        if not isinstance(agg_tensor, torch.Tensor):
            agg_tensor = torch.tensor(agg_tensor)
        
        # Extract layer number
        layer_num = None
        if "encoder.layer." in key:
            parts = key.split(".")
            for i, part in enumerate(parts):
                if part == "layer" and i + 1 < len(parts):
                    layer_num = int(parts[i + 1])
                    break
        
        if layer_num is None:
            continue
        
        is_attention = "attention_probs" in key
        layer_key = f"L{layer_num}_{'ATTN' if is_attention else 'FFN'}"
        top_neurons_per_layer[key] = {}
        
        if is_attention:
            # agg_tensor: [num_heads, 5, 5]
            num_heads = agg_tensor.shape[0]
            
            # Create full mask [num_heads, seq_len, seq_len], default to KEEP (1)
            full_mask = torch.ones(num_heads, seq_len, seq_len, dtype=torch.int)
            
            # Build token index ranges for each type
            token_ranges = _get_token_ranges(sep_position, seq_len)
            
            # Apply threshold-based pruning: prune cells where aggregated value > threshold
            # Use strict > to prune exactly the top X% of values
            for src_type_idx, src_range in enumerate(token_ranges):
                for tgt_type_idx, tgt_range in enumerate(token_ranges):
                    agg_value = agg_tensor[:, src_type_idx, tgt_type_idx]  # [num_heads]
                    # For each head, if aggregated value > threshold, prune all tokens in that src->tgt block
                    for h in range(num_heads):
                        if agg_value[h] > attention_threshold:
                            for src_idx in src_range:
                                for tgt_idx in tgt_range:
                                    full_mask[h, src_idx, tgt_idx] = 0
            
            # Apply pruning rules
            full_mask = _apply_rules_to_expanded_mask(
                full_mask, layer_key, pruning_rules, pruning_targets, pruning_edges, 
                sep_position, seq_len, num_heads
            )
            
            top_neurons_per_layer[key]["all"] = full_mask
        
        else:
            # FFN: agg_tensor is [5, hidden_size]
            # Sum across token types to get per-neuron importance
            neuron_importance = torch.sum(agg_tensor, dim=0)  # [hidden_size]
            
            # Get neurons to prune (above threshold)
            # Use strict > to prune exactly the top X% of values
            prune_positions = (neuron_importance > ffn_threshold).nonzero().flatten()
            
            # Apply FFN rules/targets
            additional = _apply_ffn_rules(
                layer_key, pruning_rules, pruning_targets, agg_tensor.shape[1]
            )
            
            if len(additional) > 0:
                all_prune = torch.cat([prune_positions, additional])
                prune_positions = torch.unique(all_prune)
            
            top_neurons_per_layer[key]["all"] = prune_positions
    
    return top_neurons_per_layer


def _get_token_ranges(sep_position, seq_len):
    """Return list of index ranges for [cls, qry, sep1, doc, sep2]."""
    return [
        range(0, 1),                                    # cls
        range(1, sep_position),                         # qry
        range(sep_position, sep_position + 1),          # sep1
        range(sep_position + 1, seq_len - 1),           # doc
        range(seq_len - 1, seq_len),                    # sep2
    ]


def _apply_rules_to_expanded_mask(mask, layer_key, rules, targets, edges, sep_position, seq_len, num_heads):
    """Apply pruning rules/targets/edges to expanded attention mask."""
    token_ranges = _get_token_ranges(sep_position, seq_len)
    type_names = ['cls', 'qry', 'sep1', 'doc', 'sep2']
    
    # Apply rules (prune whole token type)
    for rule in rules:
        if rule.get("layer") == layer_key:
            token_type = rule.get("tokenType")
            if token_type == "all":
                mask[:, :, :] = 0
            elif token_type in type_names:
                type_idx = type_names.index(token_type)
                for src_idx in token_ranges[type_idx]:
                    mask[:, src_idx, :] = 0
    
    # Apply targets (prune specific head + token type)
    for target in targets:
        if target.get("layer") == layer_key and target.get("type") == "ATTN":
            head_idx = int(target.get("index", 0))
            token_type = target.get("tokenType")
            if head_idx < num_heads and token_type in type_names:
                type_idx = type_names.index(token_type)
                for src_idx in token_ranges[type_idx]:
                    mask[head_idx, src_idx, :] = 0
    
    # Apply edges (prune src->tgt connections)
    for edge in edges:
        if edge.get("layer") == layer_key:
            src_type = edge.get("srcToken")
            tgt_type = edge.get("tgtToken")
            if src_type in type_names and tgt_type in type_names:
                src_idx = type_names.index(src_type)
                tgt_idx = type_names.index(tgt_type)
                for s in token_ranges[src_idx]:
                    for t in token_ranges[tgt_idx]:
                        mask[:, s, t] = 0
    
    return mask


def _apply_ffn_rules(layer_key, rules, targets, hidden_size):
    """Apply FFN rules/targets, return additional neuron indices to prune."""
    positions = []
    
    for rule in rules:
        if rule.get("layer") == layer_key:
            if rule.get("tokenType") == "all":
                positions.append(torch.arange(hidden_size))
    
    for target in targets:
        if target.get("layer") == layer_key and target.get("type") == "FFN":
            neuron_idx = int(target.get("index", 0))
            if neuron_idx < hidden_size:
                positions.append(torch.tensor([neuron_idx]))
    
    if positions:
        return torch.cat(positions)
    return torch.tensor([], dtype=torch.long)


def apply_pruning_rules_attention(keep_mask, tensor, layer_key, pruning_rules, pruning_targets, pruning_edges, sep_position):
    """Apply pruning rules, targets, and edges to attention masks."""
    # tensor shape: [num_heads, seq_len, seq_len] for attention
    num_heads, seq_len, _ = tensor.shape
    
    # Apply pruning rules (layer-level or token-level)
    for rule in pruning_rules:
        if rule["layer"] == layer_key:
            if rule["tokenType"] == "all":
                # Prune all heads for all token types in this layer
                keep_mask[:, :, :] = 0
            else:
                # Prune all heads for specific token type(s)
                token_indices = get_token_indices(rule["tokenType"], sep_position, seq_len)
                for token_idx in token_indices:
                    if token_idx < seq_len:
                        keep_mask[:, token_idx, :] = 0  # Prune connections FROM this token only
    
    # Apply pruning targets (specific head-token combinations)
    for target in pruning_targets:
        if target["layer"] == layer_key:
            head_idx = int(target["index"])
            token_indices = get_token_indices(target["tokenType"], sep_position, seq_len)
            
            if head_idx < num_heads:
                for token_idx in token_indices:
                    if token_idx < seq_len:
                        # Prune specific head for specific token type(s)
                        keep_mask[head_idx, token_idx, :] = 0  # Prune connections FROM this token only
    
    # Apply pruning edges (specific directional connections: srcToken -> tgtToken)
    for edge in pruning_edges:
        if edge["layer"] == layer_key:
            src_token_type = edge.get("srcToken")
            tgt_token_type = edge.get("tgtToken")
            
            if src_token_type and tgt_token_type:
                src_indices = get_token_indices(src_token_type, sep_position, seq_len)
                tgt_indices = get_token_indices(tgt_token_type, sep_position, seq_len)
                
                # Prune connections FROM src tokens TO tgt tokens (across all heads)
                for src_idx in src_indices:
                    for tgt_idx in tgt_indices:
                        if src_idx < seq_len and tgt_idx < seq_len:
                            # Attention mask shape: [num_heads, from_token, to_token]
                            # We prune the attention from src_idx to tgt_idx
                            keep_mask[:, src_idx, tgt_idx] = 0
    
    return keep_mask


def apply_pruning_rules_ffn(tensor, layer_key, pruning_rules, pruning_targets, sep_position):
    """Apply pruning rules and targets to FFN, return additional neurons to prune."""
    # tensor shape: [seq_len, hidden_size] for FFN
    seq_len, hidden_size = tensor.shape
    additional_prune_positions = []
    
    # Apply pruning rules (layer-level or token-level)
    for rule in pruning_rules:
        if rule["layer"] == layer_key:
            if rule["tokenType"] == "all":
                # Prune all neurons for all token types - return all neuron indices
                all_neurons = torch.arange(hidden_size)
                additional_prune_positions.append(all_neurons)
            else:
                # Prune neurons for specific token type(s)
                token_indices = get_token_indices(rule["tokenType"], sep_position, seq_len)
                if token_indices:
                    # For token-specific pruning, we could be more selective
                    # For now, prune all neurons when any token of this type is targeted
                    all_neurons = torch.arange(hidden_size)
                    additional_prune_positions.append(all_neurons)
    
    # Apply pruning targets (specific neuron-token combinations)
    for target in pruning_targets:
        if target["layer"] == layer_key:
            neuron_idx = int(target["index"])
            if neuron_idx < hidden_size:
                additional_prune_positions.append(torch.tensor([neuron_idx]))
    
    if additional_prune_positions:
        # Flatten all tensors to ensure they're 1D before concatenation
        flattened_positions = []
        for pos in additional_prune_positions:
            if len(pos.shape) == 0:
                flattened_positions.append(pos.unsqueeze(0))
            else:
                flattened_positions.append(pos.flatten())
        return torch.cat(flattened_positions)
    else:
        return torch.tensor([], dtype=torch.long)


def get_token_indices(token_type, sep_position, seq_len):
    """Map token type to sequence indices (ranges for qry/doc, single indices for others)."""
    if sep_position is None:
        return []
        
    # Token mapping: ['cls', 'qry', 'sep1', 'doc', 'sep2']
    # cls=0, qry=1 to sep_position-1, sep1=sep_position, doc=sep_position+1 to seq_len-2, sep2=seq_len-1
    
    if token_type == 'all':
        # Return all token indices for the whole sequence
        return list(range(seq_len))
    elif token_type == 'cls':
        return [0]
    elif token_type == 'qry':
        # Query tokens: from position 1 to sep_position-1
        return list(range(1, min(sep_position, seq_len)))
    elif token_type == 'sep1':
        return [sep_position] if sep_position < seq_len else []
    elif token_type == 'doc':
        # Document tokens: from sep_position+1 to seq_len-2 (excluding final SEP)
        start_idx = min(sep_position + 1, seq_len)
        end_idx = seq_len - 1  # Exclude final SEP token
        return list(range(start_idx, max(start_idx, end_idx)))
    elif token_type == 'sep2':
        return [seq_len - 1] if seq_len > 0 else []
    else:
        return []


def get_token_index(token_type, sep_position):
    """Map token type to sequence index based on sep_position (for backward compatibility)."""
    if sep_position is None:
        return None
        
    # Token mapping: ['cls', 'qry', 'sep1', 'doc', 'sep2']
    # Return the first index of each token type for backward compatibility
    token_type_map = {
        'cls': 0,
        'qry': 1,  # First query token
        'sep1': sep_position,
        'doc': sep_position + 1,  # First document token
        'sep2': -1  # Last position
    }
    
    return token_type_map.get(token_type)

    

if __name__ == '__main__':
    query = "what was the immediate impact of the success of the manhattan project?"
    passage = "The Manhattan Project and its atomic bomb helped bring an end to World War II. Its legacy of peaceful uses of atomic energy continues to have an impact on history and science."

    from utils import generate_baseline_with_padded_query_and_passage_but_special_tokens
    
    print("=== RUNNING PRUNING TESTS ===")
    print(f"Query: {query}")
    print(f"Passage: {passage}")
    print()
    
    # Get NIG data
    print("1. Getting NIG data...")
    nig, error, sep_position = nig_predict(query, passage, 20, 10, generate_baseline_with_padded_query_and_passage_but_special_tokens)
    print(f"   NIG keys: {list(nig.keys())}")
    print(f"   SEP position: {sep_position}")
    print()
    
    # Test 1: Basic threshold-only pruning (original functionality)
    print("2. Test 1: Threshold-only pruning")
    top_neurons_basic = get_masks(nig, pruning_percentage_attention=0.01, pruning_percentage_ffn=0.01)
    print(f"   Generated masks for {len(top_neurons_basic)} layers")
    
    # Check a sample layer
    sample_key = list(top_neurons_basic.keys())[0]
    sample_mask = top_neurons_basic[sample_key]["all"]
    print(f"   Sample layer '{sample_key}': mask shape = {sample_mask.shape}")
    print(f"   Mask type: {type(sample_mask)}")
    print()
    
    # Test 2: Pruning rules - prune all in a specific layer
    print("3. Test 2: Pruning rules - prune all ATTN in L2")
    pruning_rules = [{"layer": "L2_ATTN", "tokenType": "all"}]
    top_neurons_rules = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_rules=pruning_rules,
        sep_position=sep_position
    )
    
    # Find L2 attention layer
    l2_attn_key = None
    for key in top_neurons_rules.keys():
        if "layer.2" in key and "attention_probs" in key:
            l2_attn_key = key
            break
    
    if l2_attn_key:
        l2_mask = top_neurons_rules[l2_attn_key]["all"]
        print(f"   L2 ATTN layer '{l2_attn_key}': mask shape = {l2_mask.shape}")
        print(f"   All zeros (fully pruned): {torch.all(l2_mask == 0).item()}")
    print()
    
    # Test 3: Pruning rules - prune specific token type
    print("4. Test 3: Pruning rules - prune 'qry' tokens in L1_ATTN")
    pruning_rules = [{"layer": "L1_ATTN", "tokenType": "qry"}]
    top_neurons_token = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_rules=pruning_rules,
        sep_position=sep_position
    )
    
    # Find L1 attention layer
    l1_attn_key = None
    for key in top_neurons_token.keys():
        if "layer.1" in key and "attention_probs" in key:
            l1_attn_key = key
            break
    
    if l1_attn_key:
        l1_mask = top_neurons_token[l1_attn_key]["all"]
        print(f"   L1 ATTN layer '{l1_attn_key}': mask shape = {l1_mask.shape}")
        
        # Check query token positions
        query_indices = get_token_indices("qry", sep_position, l1_mask.shape[1])
        print(f"   Query token indices: {query_indices}")
        
        # Check if query positions are pruned (should be all zeros in those positions)
        if query_indices:
            query_pruned = True
            for qry_idx in query_indices:
                if qry_idx < l1_mask.shape[1]:
                    # Check if this query position is pruned (all zeros in that row)
                    if not torch.all(l1_mask[:, qry_idx, :] == 0):
                        query_pruned = False
                        break
            print(f"   Query tokens properly pruned: {query_pruned}")
    print()
    
    # Test 4: Pruning targets - prune specific head for specific token
    print("5. Test 4: Pruning targets - prune head 5 for 'doc' tokens in L3_ATTN")
    pruning_targets = [{"layer": "L3_ATTN", "index": 5, "tokenType": "doc", "type": "ATTN"}]
    top_neurons_target = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_targets=pruning_targets,
        sep_position=sep_position
    )
    
    # Find L3 attention layer
    l3_attn_key = None
    for key in top_neurons_target.keys():
        if "layer.3" in key and "attention_probs" in key:
            l3_attn_key = key
            break
    
    if l3_attn_key:
        l3_mask = top_neurons_target[l3_attn_key]["all"]
        print(f"   L3 ATTN layer '{l3_attn_key}': mask shape = {l3_mask.shape}")
        
        # Check document token positions
        doc_indices = get_token_indices("doc", sep_position, l3_mask.shape[1])
        print(f"   Document token indices: {doc_indices}")
        
        # Check if head 5 + doc positions are pruned
        if doc_indices and l3_mask.shape[0] > 5:
            head5_doc_pruned = True
            for doc_idx in doc_indices:
                if doc_idx < l3_mask.shape[1]:
                    # Check if head 5 -> doc tokens are pruned
                    if not torch.all(l3_mask[5, doc_idx, :] == 0):
                        head5_doc_pruned = False
                        break
            print(f"   Head 5 -> doc tokens properly pruned: {head5_doc_pruned}")
    print()
    
    # Test 4b: Pruning targets - prune head 2 for 'cls' tokens in L0_ATTN
    print("5b. Test 4b: Pruning targets - prune head 2 for 'cls' tokens in L0_ATTN")
    pruning_targets_str = [{"layer": "L0_ATTN", "index": 2, "tokenType": "cls", "type": "ATTN"}]
    top_neurons_target_str = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_targets=pruning_targets_str,
        sep_position=sep_position
    )
    
    # Find L0 attention layer
    l0_attn_key = None
    for key in top_neurons_target_str.keys():
        if "layer.0" in key and "attention_probs" in key:
            l0_attn_key = key
            break
    
    if l0_attn_key:
        l0_mask = top_neurons_target_str[l0_attn_key]["all"]
        print(f"   L0 ATTN layer '{l0_attn_key}': mask shape = {l0_mask.shape}")
        
        # Check if head 2 -> CLS token is pruned (CLS is always at position 0)
        if l0_mask.shape[0] > 2:
            head2_cls_pruned = torch.all(l0_mask[2, 0, :] == 0).item()
            print(f"   Head 2 -> CLS token properly pruned: {head2_cls_pruned}")
    print()
    
    # Test 5: Token index mapping
    print("6. Test 5: Token index mapping")
    if sep_position:
        for token_type in ['cls', 'qry', 'sep1', 'doc', 'sep2']:
            indices = get_token_indices(token_type, sep_position, 50)  # Assume max seq len 50
            print(f"   {token_type}: {indices}")
    print()
    
    # Test 6: Pruning edges - directional connections
    print("7. Test 6: Pruning edges - prune cls -> doc connections in L4_ATTN")
    pruning_edges = [{"layer": "L4_ATTN", "srcToken": "cls", "tgtToken": "doc"}]
    top_neurons_edges = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_edges=pruning_edges,
        sep_position=sep_position
    )
    
    # Find L4 attention layer
    l4_attn_key = None
    for key in top_neurons_edges.keys():
        if "layer.4" in key and "attention_probs" in key:
            l4_attn_key = key
            break
    
    if l4_attn_key:
        l4_mask = top_neurons_edges[l4_attn_key]["all"]
        print(f"   L4 ATTN layer '{l4_attn_key}': mask shape = {l4_mask.shape}")
        
        # Check if cls -> doc connections are pruned
        cls_indices = get_token_indices("cls", sep_position, l4_mask.shape[1])
        doc_indices = get_token_indices("doc", sep_position, l4_mask.shape[1])
        print(f"   CLS indices: {cls_indices}")
        print(f"   DOC indices: {doc_indices}")
        
        if cls_indices and doc_indices:
            edge_pruned = True
            for cls_idx in cls_indices:
                for doc_idx in doc_indices:
                    if cls_idx < l4_mask.shape[1] and doc_idx < l4_mask.shape[2]:
                        # Check if cls -> doc is pruned (all heads)
                        if not torch.all(l4_mask[:, cls_idx, doc_idx] == 0):
                            edge_pruned = False
                            break
                if not edge_pruned:
                    break
            print(f"   CLS -> DOC edges properly pruned: {edge_pruned}")
    print()
    
    # Test 7: Pruning edges - reverse direction
    print("8. Test 7: Pruning edges - prune doc -> cls connections in L5_ATTN (reverse)")
    pruning_edges_reverse = [{"layer": "L5_ATTN", "srcToken": "doc", "tgtToken": "cls"}]
    top_neurons_edges_rev = get_masks(
        nig, 
        pruning_percentage_attention=0.01, 
        pruning_percentage_ffn=0.01,
        pruning_edges=pruning_edges_reverse,
        sep_position=sep_position
    )
    
    # Find L5 attention layer
    l5_attn_key = None
    for key in top_neurons_edges_rev.keys():
        if "layer.5" in key and "attention_probs" in key:
            l5_attn_key = key
            break
    
    if l5_attn_key:
        l5_mask = top_neurons_edges_rev[l5_attn_key]["all"]
        print(f"   L5 ATTN layer '{l5_attn_key}': mask shape = {l5_mask.shape}")
        
        # Check if doc -> cls connections are pruned
        doc_indices = get_token_indices("doc", sep_position, l5_mask.shape[1])
        cls_indices = get_token_indices("cls", sep_position, l5_mask.shape[1])
        print(f"   DOC indices: {doc_indices}")
        print(f"   CLS indices: {cls_indices}")
        
        if doc_indices and cls_indices:
            edge_pruned = True
            for doc_idx in doc_indices:
                for cls_idx in cls_indices:
                    if doc_idx < l5_mask.shape[1] and cls_idx < l5_mask.shape[2]:
                        # Check if doc -> cls is pruned (all heads)
                        if not torch.all(l5_mask[:, doc_idx, cls_idx] == 0):
                            edge_pruned = False
                            break
                if not edge_pruned:
                    break
            print(f"   DOC -> CLS edges properly pruned: {edge_pruned}")
    print()
    
    print("=== TESTS COMPLETED ===")
    print("Check the output above to verify:")
    print("- Basic threshold pruning works")
    print("- Rule-based pruning (all tokens in layer) works") 
    print("- Rule-based pruning (specific token type) works")
    print("- Target-based pruning (specific head+token) works")
    print("- Token index mapping is correct")
    print("- Edge-based pruning (directional connections) works")