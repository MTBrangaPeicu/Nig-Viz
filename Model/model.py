import numpy as np
from marcelle import DataStore
import threading
import random
from collections import defaultdict
import ir_datasets
from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from aggregation import aggregate_nig  # Import aggregation logic
from prune import get_masks
from pruned_forward import pruned_forward
from utils import (
    generate_baseline_with_only_padded_tokens,
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
)
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

# Setup DataStore and Services
store = DataStore("http://localhost:3030")
#store = DataStore("https://marcelle.lisn.upsaclay.fr/nig-viz/api")

ig_service = store.service("predictions")
nig_service = store.service("nig-values")
dataset_service = store.service("msmarco-samples")
forward_service = store.service("forward-pass")
pruned_forward_service = store.service("pruned-forward-pass")

# Initialize MS MARCO from ir_datasets
print("Initializing ir_datasets: msmarco-passage/trec-dl-2019/judged ...")
ir_ds = ir_datasets.load("msmarco-passage/trec-dl-2019/judged")

# Cache queries (small set for TREC DL 2019 judged)
queries_list = list(ir_ds.queries_iter())
print(f"Loaded {len(queries_list)} queries")
# Build lookup map query_id -> query text
queries_by_id = {}
try:
    for q in queries_list:
        queries_by_id[q.query_id] = q.text
except Exception:
    pass

# Build qrels maps:
#  - qrels_by_q: query_id -> list of judged doc_ids (any level)
#  - qrels_by_q_level: query_id -> { level(int) -> list of doc_ids }
qrels_by_q = defaultdict(list)
qrels_by_q_level = defaultdict(lambda: defaultdict(list))
for qr in ir_ds.qrels_iter():
    try:
        rel = int(getattr(qr, "relevance", 0))
    except Exception:
        rel = 0
    qid = qr.query_id
    did = qr.doc_id
    qrels_by_q[qid].append(did)
    qrels_by_q_level[qid][rel].append(did)

for qid, lst in qrels_by_q.items():
    random.shuffle(lst)
for qid, levels in qrels_by_q_level.items():
    for rel, lst in levels.items():
        random.shuffle(lst)

# Compute available relevance levels across the dataset
AVAILABLE_LEVELS = sorted({rel for _qid, lv in qrels_by_q_level.items() for rel in lv.keys()}, reverse=True)

# Try to get a docs store for random access by doc_id (preferred)
docs_store = None
try:
    if hasattr(ir_ds, "docs_store"):
        docs_store = ir_ds.docs_store()
except Exception:
    docs_store = None

# Threading lock to handle concurrent runs safely
lock = threading.Lock()

# Baseline selection map
BASELINE_MAP = {
    0: generate_baseline_with_only_padded_tokens,
    1: generate_baseline_with_padded_query_and_passage_but_special_tokens,
    2: generate_baseline_with_padded_query_but_special_tokens,
}

BATCH_SIZE = 10

device = "cuda" if torch.cuda.is_available() else "cpu"
model = AutoModelForSequenceClassification.from_pretrained(
    "cross-encoder/ms-marco-MiniLM-L12-v2"
).to(device)
model.eval()
tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")


def get_random_samples(max_queries=10, subset="Random", max_passages_per_query=10):
    """
    Return a list of samples where each sample is { query_id, query, passages: [{text},...] }.
    subset can be 'Random', 'Rel=0', 'Rel=1', etc.
    """
    samples = []

    # filter by subset choice
    chosen_queries = queries_list[:max_queries]

    for q in chosen_queries:
        query_id = q.query_id
        query_text = q.text

        # choose doc ids per subset
        if subset == "Random":
            # Get random documents from entire dataset, excluding judged docs for this query
            judged_docs = set(qrels_by_q.get(query_id, []))
            
            # Collect random doc_ids from the entire dataset
            all_docs_sample = []
            for d in ir_ds.docs_iter():
                if d.doc_id not in judged_docs:
                    all_docs_sample.append(d.doc_id)
                # Sample enough to get good randomness
                if len(all_docs_sample) >= 1000:
                    break
            # Shuffle and take max_passages_per_query
            random.shuffle(all_docs_sample)
            doc_ids = all_docs_sample[:max_passages_per_query]
        else:
            # For relevance levels, use judged docs for this specific query
            level = None
            try:
                if subset.startswith("Rel="):
                    level = int(subset.split("=", 1)[1])
            except Exception:
                level = None
            if level is None:
                doc_ids = qrels_by_q.get(query_id, [])
            else:
                doc_ids = qrels_by_q_level.get(query_id, {}).get(level, [])

        if not doc_ids:
            continue

        chosen = doc_ids[:max_passages_per_query]

        # fetch texts for chosen doc_ids
        passages = []
        if docs_store is not None:
            for did in chosen:
                d = docs_store.get(did)
                if d is not None:
                    txt = getattr(d, "text", "") or ""
                    if txt:
                        passages.append({"text": txt})
        else:
            # docs_store unavailable, iterate all docs
            needed = set(chosen)
            for d in ir_ds.docs_iter():
                if d.doc_id in needed:
                    txt = getattr(d, "text", "") or ""
                    if txt:
                        passages.append({"text": txt})
                if len(passages) == len(chosen):
                    break

        if passages:
            samples.append({
                "query_id": query_id,
                "query": query_text,
                "passages": passages
            })

    return samples


def get_passages_for_query(query_id, subset="Random", max_passages_per_query=10):
    """
    Fetch passages for a single query.
    subset: 'Random', 'Rel=0', 'Rel=1', ...
    Returns { query_id, query, passages: [{text}, ...] }
    """
    if not query_id:
        return {"query_id": query_id, "query": "", "passages": []}

    # choose doc ids per subset
    if subset == "Random":
        # Get random documents from entire dataset, excluding judged docs for this query
        judged_docs = set(qrels_by_q.get(query_id, []))
        
        # Collect random doc_ids from the entire dataset
        all_docs_sample = []
        for d in ir_ds.docs_iter():
            if d.doc_id not in judged_docs:
                all_docs_sample.append(d.doc_id)
            # Sample enough to get good randomness
            if len(all_docs_sample) >= 1000:
                break
        # Shuffle and take max_passages_per_query
        random.shuffle(all_docs_sample)
        doc_ids = all_docs_sample[:max_passages_per_query]
    else:
        # For relevance levels, use judged docs for this specific query
        level = None
        try:
            if subset.startswith("Rel="):
                level = int(subset.split("=", 1)[1])
        except Exception:
            level = None
        if level is None:
            doc_ids = qrels_by_q.get(query_id, [])
        else:
            doc_ids = qrels_by_q_level.get(query_id, {}).get(level, [])

    if not doc_ids:
        return {"query_id": query_id, "query": queries_by_id.get(query_id, ""), "passages": []}

    chosen = doc_ids[:max_passages_per_query]

    # fetch texts
    passages = []
    if docs_store is not None:
        for did in chosen:
            d = docs_store.get(did)
            if d is not None:
                txt = getattr(d, "text", "") or ""
                if txt:
                    passages.append({"text": txt})
    else:
        needed = set(chosen)
        for d in ir_ds.docs_iter():
            if d.doc_id in needed:
                txt = getattr(d, "text", "") or ""
                if txt:
                    passages.append({"text": txt})
                if len(passages) == len(chosen):
                    break

    return {"query_id": query_id, "query": queries_by_id.get(query_id, ""), "passages": passages}


# --- Dataset sample handler ---
def handle_sample_request(doc):
    try:
        print(f"Received sample request: {doc}")
        subset = doc.get("subset", "Random")
        # If a specific query is requested, only return its passages
        query_id = doc.get("query_id") or doc.get("qid") or None
        if query_id is not None:
            result = get_passages_for_query(query_id, subset=subset)
            dataset_service.patch(
                doc["_id"],
                {"status": "success", "subset": subset, "passages": result.get("passages", []), "query_id": query_id},
            )
            return

        # Else return a random set of queries with passages
        n_samples = doc.get("n", 10)
        samples = get_random_samples(n_samples, subset=subset)
        if not samples:
            print("No samples generated.")
            dataset_service.patch(
                doc["_id"],
                {"status": "error", "error": "No samples could be generated."},
            )
            return
        print(f"samples Generated (subset={subset})")
        # Ensure the samples field is included in the response
        dataset_service.patch(
            doc["_id"],
            {"status": "success", "samples": samples, "subset": subset, "levels": AVAILABLE_LEVELS},
        )
        # print(f"Response sent to frontend: {samples}")
    except Exception as e:
        print(f"Error handling sample request: {e}")
        dataset_service.patch(doc["_id"], {"status": "error", "error": str(e)})


# --- IG prediction handler ---
def handle_ig_prediction(doc):
    id = doc["_id"]

    if lock.locked():
        ig_service.patch(id, {"status": "pending"})
    lock.acquire()
    try:
        ig_service.patch(id, {"status": "processing", "progress": 0})
        query = doc.get("query")
        passage = doc.get("passage")
        num_reps = doc.get("num_reps", 20)
        baseline_type = doc.get("baseline_type", 1)
        baseline_func = BASELINE_MAP.get(baseline_type)

        def progress_callback(current, total):
            progress = current / total
            ig_service.patch(id, {"progress": progress})

        ig_result, error = predict(
            query, passage, num_reps, BATCH_SIZE, baseline_func, progress_callback
        )

        result = {
            "tokens": ig_result["tokens"],
            "attributions": ig_result["attributions"].tolist(),
            "error": error,
        }

        ig_service.patch(id, {"status": "success", "progress": 1, "result": result})
    except Exception as e:
        ig_service.patch(id, {"status": "error", "data": str(e)})
    finally:
        lock.release()


# --- NIG prediction handler ---
# Global variable to store full NIGs in memory
full_nigs_memory = {}


def handle_nig_prediction(doc):
    id = doc["_id"]

    if lock.locked():
        nig_service.patch(id, {"status": "pending"})
    lock.acquire()
    try:
        nig_service.patch(id, {"status": "processing", "progress": 0})
        query = doc.get("query")
        passage = doc.get("passage")
        num_reps = doc.get("num_reps", 20)
        baseline_type = doc.get("baseline_type", 1)
        baseline_func = BASELINE_MAP.get(baseline_type)

        def progress_callback(current, total):
            progress = current / total
            nig_service.patch(id, {"progress": progress})

        nig, error, sep_position, activations = nig_predict(
            query, passage, num_reps, BATCH_SIZE, baseline_func, progress_callback
        )

        # Store full NIGs in memory
        full_nigs_memory[id] = {
            "nig": nig,
            # "error": error,  # Commented out - error rates too high
            "sep_position": sep_position,
        }

        print("Full NIGs memory stored for ID:", id)

        # Compute detailed aggregation (subset B only)
        subset_b = aggregate_nig(nig, sep_position)

        # Also aggregate activations into subset_b-like structures for frontend
        attn_activations = {}
        ffn_activations = {}
        try:
            if activations and isinstance(activations, dict):
                # Build subset-B manually for activations (avoid aggregate_nig masking mismatch)
                for k, a in activations.items():
                    t = torch.as_tensor(a)
                    L = t.size(1) if t.dim() == 3 else t.size(0)
                    cls = torch.zeros(L, dtype=torch.bool); cls[0] = True
                    qry = torch.zeros(L, dtype=torch.bool); qry[1:sep_position] = True
                    sep1 = torch.zeros(L, dtype=torch.bool); sep1[sep_position] = True
                    doc = torch.zeros(L, dtype=torch.bool); doc[sep_position+1:-1] = True
                    sep2 = torch.zeros(L, dtype=torch.bool); sep2[-1] = True
                    if t.dim() == 3:  # ATTN: [H, T, T]
                        rows = []
                        for src_m in [cls, qry, sep1, doc, sep2]:
                            cols = []
                            for tgt_m in [cls, qry, sep1, doc, sep2]:
                                sub = t[:, src_m, :][:, :, tgt_m]
                                if sub.numel() == 0:
                                    agg = torch.zeros(t.size(0))
                                else:
                                    agg = torch.sum(sub, dim=(1,2))
                                cols.append(agg)
                            rows.append(torch.stack(cols, dim=1))  # [H,5]
                        out = torch.stack(rows, dim=1)  # [H,5,5]
                        attn_activations[k] = out.numpy().tolist()
                    elif t.dim() == 2:  # FFN: [T, N]
                        rows = []
                        for m in [cls, qry, sep1, doc, sep2]:
                            sub = t[m, :]
                            if sub.numel() == 0:
                                agg = torch.zeros(t.size(1))
                            else:
                                agg = torch.sum(sub, dim=0)
                            rows.append(agg)
                        out = torch.stack(rows, dim=0)  # [5,N]
                        ffn_activations[k] = out.numpy().tolist()
                print("[ACT] attn layers:", len(attn_activations), "ffn layers:", len(ffn_activations))
        except Exception as e:
            print(f"Activation aggregation failed: {e}")

        # Debugging: Print the shape of subset_b
        print("Subset B Keys:", subset_b.keys())
        for key, value in subset_b.items():
            if isinstance(value, np.ndarray):
                print(f"Layer: {key}, Shape: {value.shape}")
            else:
                print(f"Layer: {key}, Value Type: {type(value)}")

        # Ensure proper formatting for frontend
        formatted_result = {
            "subset_b": subset_b,  # for detailed data and frontend counting
            "attn_activations": attn_activations,
            "ffn_activations": ffn_activations,
            # "error": error,  # Commented out - error rates too high, keeping as NA
        }

        # print("[DEBUG] Subset B keys (about to send):", list(subset_b.keys()))
        # print("[DEBUG] Patch payload:", formatted_result)

        nig_service.patch(
            id, {"status": "success", "progress": 1, "result": formatted_result}
        )
    except Exception as e:
        print(f"Error in handle_nig_prediction: {e}")
        nig_service.patch(id, {"status": "error", "data": str(e)})
    finally:
        lock.release()


# --- Forward pass handler ---
def handle_forward_pass_request(doc):
    try:
        query = doc.get("query")
        passage = doc.get("passage")
        if not query or not passage:
            raise ValueError("Both query and passage must be provided.")

        inputs = tokenizer(
            query,
            passage,
            max_length=512,
            truncation=True,
            padding=True,  # Use dynamic padding for consistency
            return_attention_mask=True,
            return_tensors="pt",
        ).to(device)

        outputs = model(**inputs)
        probabilities = torch.sigmoid(outputs.logits).tolist()
        label = 1 if probabilities[0][0] >= 0.5 else 0

        forward_service.patch(
            doc["_id"],
            {
                "status": "success",
                "result": {
                    "logits": outputs.logits.tolist(),
                    "probabilities": probabilities,
                    "label": label,
                },
            },
        )
    except Exception as e:
        forward_service.patch(doc["_id"], {"status": "error", "error": str(e)})


def handle_pruned_forward_pass_request(doc):
    try:
        print(f"Received pruned forward pass request: {doc}")

        query = doc.get("query")
        passage = doc.get("passage")
        pruning_percentage_attention = doc.get("pruning_percentage_attention", 0.01)
        pruning_percentage_ffn = doc.get("pruning_percentage_ffn", 0.01)

        # NEW: Get pruning rules and targets from the frontend
        pruning_rules = doc.get("pruning_rules", [])
        pruning_targets = doc.get("pruning_targets", [])
        pruning_enabled = doc.get("pruning_enabled", False)

        print(f"Query: {query}")
        print(f"Passage: {passage}")
        print(f"Pruning enabled: {pruning_enabled}")
        print(f"Pruning rules: {pruning_rules}")
        print(f"Pruning targets: {pruning_targets}")

        if not query or not passage:
            pruned_forward_service.patch(
                doc["_id"], {"status": "error", "error": "Missing query or passage"}
            )
            return

        # Get the most recent NIG data from memory
        if not full_nigs_memory:
            pruned_forward_service.patch(
                doc["_id"],
                {
                    "status": "error",
                    "error": "No NIG data available. Please run NIG values calculation first.",
                },
            )
            return

        # Get the most recent NIG data (for now, use the last entry)
        # In production, might want to match by query/passage or use a better strategy
        latest_nig_id = max(full_nigs_memory.keys())
        nig_memory_data = full_nigs_memory[latest_nig_id]
        raw_nig_data = nig_memory_data["nig"]
        sep_position = nig_memory_data["sep_position"]

        print("Generating pruning masks...")
        # Generate pruning masks using original NIG data PLUS rules and targets
        top_neurons = get_masks(
            raw_nig_data,
            pruning_percentage_attention,
            pruning_percentage_ffn,
            pruning_rules=pruning_rules if pruning_enabled else [],
            pruning_targets=pruning_targets if pruning_enabled else [],
            sep_position=sep_position,
        )
        print(f"Generated masks for {len(top_neurons)} layers")

        # Prepare inputs for the model - use same padding as NIG calculation
        inputs = tokenizer(
            query,
            passage,
            max_length=512,
            truncation=True,
            padding=True,  # Use dynamic padding to match NIG calculation
            return_attention_mask=True,
            return_tensors="pt",
        ).to(device)

        # Get the actual sequence length (excluding padding)
        actual_length = inputs["attention_mask"].sum().item()
        print(f"Actual sequence length: {actual_length}")

        # Run pruned forward pass
        print("Running pruned forward pass...")
        try:
            pruned_score = pruned_forward(
                model=model,
                tokenizer=tokenizer,
                inputs=inputs,
                neurons_to_prune=top_neurons,
                input_length=actual_length,  # Use actual sequence length
            )
            print(f"Pruned forward pass completed, score: {pruned_score}")
        except Exception as e:
            print(f"Error in pruned forward pass: {e}")
            raise e

        # Convert to same format as regular forward pass
        print(f"Pruned score type: {type(pruned_score)}, value: {pruned_score}")

        # Convert score to logit-like format and create response
        # Since pruned_forward returns a probability, convert back to logit format
        import math

        if pruned_score >= 1.0:
            pruned_score = 0.9999  # Avoid log(0)
        elif pruned_score <= 0.0:
            pruned_score = 0.0001  # Avoid log(0)

        logit_value = math.log(pruned_score / (1 - pruned_score))
        label = 1 if pruned_score >= 0.5 else 0

        pruned_forward_service.patch(
            doc["_id"],
            {
                "status": "success",
                "result": {
                    "logits": [[logit_value]],  # Format to match regular forward pass
                    "probabilities": [
                        [pruned_score]
                    ],  # Format to match regular forward pass
                    "label": label,
                },
            },
        )
    except Exception as e:
        print(f"Error in pruned forward pass: {e}")
        pruned_forward_service.patch(doc["_id"], {"status": "error", "error": str(e)})


# Bind handlers to services
ig_service.on("created", handle_ig_prediction)
nig_service.on("created", handle_nig_prediction)
dataset_service.on("created", handle_sample_request)
forward_service.on("created", handle_forward_pass_request)
pruned_forward_service.on("created", handle_pruned_forward_pass_request)

# Connect and wait indefinitely
store.connect()
store.wait()
