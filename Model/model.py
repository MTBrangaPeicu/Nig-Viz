import numpy as np
import os
from dotenv import load_dotenv
import transformers
from marcelle import DataStore
import threading
import random
from collections import defaultdict, deque
import ir_datasets
import gc
import time

# Load environment variables (for account login & pwd)
load_dotenv()
from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from aggregation import aggregate_nig  # Import aggregation logic
from prune import get_masks, get_masks_from_aggregated
from pruned_forward import pruned_forward
from conditional_nig import compute_conditional_nig, NeuronType
from utils import (
    generate_baseline_with_only_padded_tokens,
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
    InputPart,
)
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

# Setup DataStore and Services
store = DataStore("http://" + os.getenv("MARCELLE_BACKEND_SERVER", "localhost") + ":" + os.getenv("MARCELLE_BACKEND_PORT", "3030"))
#store = DataStore("http://localhost:3030")
#store = DataStore("https://marcelle.lisn.upsaclay.fr/nig-viz/api")

print(transformers.__version__)

ig_service = store.service("predictions")
nig_service = store.service("nig-values")
nig_snapshot_service = store.service("nig-snapshots")  # For saved snapshots
dataset_service = store.service("msmarco-samples")
forward_service = store.service("forward-pass")
pruned_forward_service = store.service("pruned-forward-pass")
conditional_nig_service = store.service("conditional-nig")

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
#  - qrels_doc_relevance: (query_id, doc_id) -> relevance level (for reverse lookup)
qrels_by_q = defaultdict(list)
qrels_by_q_level = defaultdict(lambda: defaultdict(list))
qrels_doc_relevance = {}  # Maps (query_id, doc_id) -> relevance level
for qr in ir_ds.qrels_iter():
    try:
        rel = int(getattr(qr, "relevance", 0))
    except Exception:
        rel = 0
    qid = qr.query_id
    did = qr.doc_id
    qrels_by_q[qid].append(did)
    qrels_by_q_level[qid][rel].append(did)
    qrels_doc_relevance[(qid, did)] = rel

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
gpu_lock = threading.Lock()

# Request queue for visibility - stores (request_id, service_type) tuples
# service_type: 'ig', 'nig', 'fwd', 'pruned_fwd', 'conditional_nig'
request_queue = deque()
queue_lock = threading.Lock()

# Map service types to their Marcelle services
SERVICE_MAP = {}

def init_service_map():
    """Initialize service map after services are created."""
    global SERVICE_MAP
    SERVICE_MAP = {
        'ig': ig_service,
        'nig': nig_service,
        'fwd': forward_service,
        'pruned_fwd': pruned_forward_service,
        'conditional_nig': conditional_nig_service,
    }

def clear_gpu_memory():
    """Clear GPU memory after each operation to prevent OOM with multiple users."""
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    gc.collect()

def log_lock(request_id, action):
    """Log GPU lock acquisition/release for debugging."""
    import datetime
    timestamp = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] [{request_id[:8]}] GPU Lock: {action}")

def get_queue_position(request_id):
    """Get position of a request in the queue (0-indexed)."""
    with queue_lock:
        for i, (rid, _) in enumerate(request_queue):
            if rid == request_id:
                return i
        return -1

def broadcast_queue_positions():
    """Update queue positions for all waiting requests."""
    with queue_lock:
        queue_list = list(request_queue)
    
    for i, (rid, service_type) in enumerate(queue_list):
        service = SERVICE_MAP.get(service_type)
        if service:
            position = i + 1  # 1-indexed for user display
            message = f"Waiting in queue (position {position})"
            try:
                service.patch(rid, {"status": "pending", "queue_position": position, "message": message})
            except Exception as e:
                print(f"Failed to update queue position for {rid}: {e}")

def add_to_queue(request_id, service_type):
    """Add request to queue and broadcast updated positions."""
    with queue_lock:
        request_queue.append((request_id, service_type))
    broadcast_queue_positions()

def remove_from_queue(request_id):
    """Remove request from queue and broadcast updated positions."""
    with queue_lock:
        for item in list(request_queue):
            if item[0] == request_id:
                request_queue.remove(item)
                break
    broadcast_queue_positions()


# --- Cleanup mechanism for ephemeral services ---
# Cleanup runs periodically to remove old documents from temporary services
# Age threshold must be longer than the longest possible computation time
CLEANUP_INTERVAL = 3600 * 4  # Run cleanup every 4 hours
CLEANUP_AGE_THRESHOLD = 3600 * 4  # Delete documents older than 4 hours

def cleanup_old_documents():
    """
    Periodically clean up old documents from ephemeral services.
    Only deletes documents older than CLEANUP_AGE_THRESHOLD to avoid
    interfering with active streams.
    """
    import datetime
    
    services_to_clean = [
        ('predictions', ig_service),
        ('nig-values', nig_service),
        ('msmarco-samples', dataset_service),
        ('forward-pass', forward_service),
        ('pruned-forward-pass', pruned_forward_service),
        ('conditional-nig', conditional_nig_service),
    ]
    
    cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=CLEANUP_AGE_THRESHOLD)
    cutoff_iso = cutoff_time.isoformat()
    
    for name, service in services_to_clean:
        try:
            # Find documents older than the cutoff time
            result = service.find({
                'query': {
                    'createdAt': {'$lt': cutoff_iso},
                    '$limit': 100  # Batch size
                }
            })
            
            if result and 'data' in result:
                deleted = 0
                for doc in result['data']:
                    try:
                        service.remove(doc['_id'])
                        deleted += 1
                    except Exception:
                        pass
                if deleted > 0:
                    print(f"[CLEANUP] Removed {deleted} old documents from {name}")
        except Exception as e:
            print(f"[CLEANUP] Error cleaning {name}: {e}")

def start_cleanup_scheduler():
    """Start the periodic cleanup scheduler."""
    def run_cleanup():
        while True:
            time.sleep(CLEANUP_INTERVAL)
            print("[CLEANUP] Running periodic cleanup...")
            cleanup_old_documents()
    
    cleanup_thread = threading.Thread(target=run_cleanup, daemon=True)
    cleanup_thread.start()
    print(f"[CLEANUP] Scheduler started (interval: {CLEANUP_INTERVAL}s, age threshold: {CLEANUP_AGE_THRESHOLD}s)")


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
    Return a list of samples where each sample is { query_id, query, passages: [{text, label},...] }.
    subset can be 'Random', 'Rel=0', 'Rel=1', etc.
    label contains the relevance level for judged docs, or 'N/A' for random.
    """
    samples = []

    # Randomly select queries (not just first N)
    chosen_queries = random.sample(queries_list, min(max_queries, len(queries_list)))

    for q in chosen_queries:
        query_id = q.query_id
        query_text = q.text

        # choose doc ids per subset - track relevance level
        relevance_level = None  # None means random/unjudged
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
            try:
                if subset.startswith("Rel="):
                    relevance_level = int(subset.split("=", 1)[1])
            except Exception:
                relevance_level = None
            if relevance_level is None:
                doc_ids = qrels_by_q.get(query_id, [])
            else:
                doc_ids = qrels_by_q_level.get(query_id, {}).get(relevance_level, [])

        if not doc_ids:
            continue

        chosen = doc_ids[:max_passages_per_query]

        # fetch texts for chosen doc_ids (preserve order for relevance lookup)
        passages = []
        if docs_store is not None:
            for did in chosen:
                d = docs_store.get(did)
                if d is not None:
                    txt = getattr(d, "text", "") or ""
                    if txt:
                        # Look up relevance level from qrels_doc_relevance
                        rel = qrels_doc_relevance.get((query_id, did), None)
                        label = str(rel) if rel is not None else "N/A"
                        passages.append({"text": txt, "label": label})
        else:
            # docs_store unavailable, iterate all docs
            needed = set(chosen)
            doc_id_order = {did: i for i, did in enumerate(chosen)}
            passage_map = {}
            for d in ir_ds.docs_iter():
                if d.doc_id in needed:
                    txt = getattr(d, "text", "") or ""
                    if txt:
                        rel = qrels_doc_relevance.get((query_id, d.doc_id), None)
                        label = str(rel) if rel is not None else "N/A"
                        passage_map[d.doc_id] = {"text": txt, "label": label}
                if len(passage_map) == len(chosen):
                    break
            # Maintain order
            passages = [passage_map[did] for did in chosen if did in passage_map]

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
    subset: 'Random' or 'Rel=0', 'Rel=1', etc.
    Returns { query_id, query, passages: [{text}, ...] }
    """
    if not query_id:
        return {"query_id": query_id, "query": "", "passages": []}

    doc_ids = []
    if subset == "Random":
        judged_docs = set(qrels_by_q.get(query_id, []))
        count = 0
        for d in ir_ds.docs_iter():
            if d.doc_id not in judged_docs:
                doc_ids.append(d.doc_id)
                count += 1
            if count >= max_passages_per_query:
                break
    elif subset.startswith("Rel="):
        try:
            level = int(subset.split("=", 1)[1])
            doc_ids = qrels_by_q_level.get(query_id, {}).get(level, [])[:max_passages_per_query]
        except Exception:
            pass

    if not doc_ids:
        return {"query_id": query_id, "query": queries_by_id.get(query_id, ""), "passages": []}

    passages = []
    if docs_store is not None:
        for did in doc_ids:
            d = docs_store.get(did)
            if d is not None:
                txt = getattr(d, "text", "") or ""
                if txt:
                    passages.append({"text": txt})
    else:
        needed = set(doc_ids)
        for d in ir_ds.docs_iter():
            if d.doc_id in needed:
                txt = getattr(d, "text", "") or ""
                if txt:
                    passages.append({"text": txt})
                if len(passages) == len(needed):
                    break

    return {"query_id": query_id, "query": queries_by_id.get(query_id, ""), "passages": passages}


# --- Dataset sample handler ---
def handle_sample_request(doc):
    id = doc["_id"]
    try:
        print(f"Received sample request: {doc}")
        subset = doc.get("subset", "Random")
        # If a specific query is requested, only return its passages
        query_id = doc.get("query_id") or doc.get("qid") or None
        if query_id is not None:
            result = get_passages_for_query(query_id, subset=subset)
            dataset_service.patch(
                id,
                {"status": "success", "subset": subset, "passages": result.get("passages", []), "query_id": query_id},
            )
            return

        # Else return a random set of queries with passages
        n_samples = doc.get("n", 10)
        samples = get_random_samples(n_samples, subset=subset)
        if not samples:
            print("No samples generated.")
            dataset_service.patch(
                id,
                {"status": "error", "error": "No samples could be generated."},
            )
            return
        print(f"samples Generated (subset={subset})")
        # Ensure the samples field is included in the response
        dataset_service.patch(
            id,
            {"status": "success", "samples": samples, "subset": subset, "levels": AVAILABLE_LEVELS},
        )
        # print(f"Response sent to frontend: {samples}")
    except Exception as e:
        print(f"Error handling sample request: {e}")
        dataset_service.patch(id, {"status": "error", "error": str(e)})


# --- IG prediction handler ---
def handle_ig_prediction(doc):
    id = doc["_id"]
    
    # Add to queue (broadcasts position to all waiting requests)
    add_to_queue(id, 'ig')
    
    # Acquire GPU lock (blocks until available)
    log_lock(id, "WAITING (IG)")
    with gpu_lock:
        log_lock(id, "ACQUIRED (IG)")
        try:
            remove_from_queue(id)
            ig_service.patch(id, {"status": "processing", "progress": 0, "queue_position": 0, "message": ""})
            query = doc.get("query")
            passage = doc.get("passage")
            num_reps = doc.get("num_reps", 20)
            baseline_type = doc.get("baseline_type", 1)
            baseline_func = BASELINE_MAP.get(baseline_type)

            def progress_callback(current, total):
                progress = current / total
                ig_service.patch(id, {"progress": progress})

            ig_result, error = predict(
                query, passage, num_reps, BATCH_SIZE, baseline_func, progress_callback,
                model=model, tokenizer=tokenizer
            )

            result = {
                "tokens": ig_result["tokens"],
                "attributions": ig_result["attributions"].tolist(),
                "error": error,
            }

            ig_service.patch(id, {"status": "success", "progress": 1, "result": result})
        except torch.cuda.OutOfMemoryError:
            error_msg = "GPU is currently occupied by another process. Please wait and try again in a few moments."
            ig_service.patch(id, {"status": "error", "message": error_msg, "data": "GPU Out of Memory"})
            print(f"[{id[:8]}] GPU OOM Error")
        except Exception as e:
            ig_service.patch(id, {"status": "error", "data": str(e)})
        finally:
            clear_gpu_memory()
            log_lock(id, "RELEASED (IG)")


# --- NIG prediction handler ---


def handle_nig_prediction(doc):
    id = doc["_id"]
    
    # Add to queue (broadcasts position to all waiting requests)
    add_to_queue(id, 'nig')
    
    # Acquire GPU lock (blocks until available)
    log_lock(id, "WAITING (NIG)")
    with gpu_lock:
        log_lock(id, "ACQUIRED (NIG)")
        try:
            remove_from_queue(id)
            nig_service.patch(id, {"status": "processing", "progress": 0, "queue_position": 0, "message": ""})
            query = doc.get("query")
            passage = doc.get("passage")
            num_reps = doc.get("num_reps", 20)
            baseline_type = doc.get("baseline_type", 1)
            baseline_func = BASELINE_MAP.get(baseline_type)

            def progress_callback(current, total):
                progress = current / total
                nig_service.patch(id, {"progress": progress})

            nig, error, sep_position, activations = nig_predict(
                query, passage, num_reps, BATCH_SIZE, baseline_func, progress_callback,
                model=model, tokenizer=tokenizer
            )

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
                "sep_position": sep_position,  # Store for pruned forward to use
                # "error": error,  # Commented out - error rates too high, keeping as NA
            }

            # print("[DEBUG] Subset B keys (about to send):", list(subset_b.keys()))
            # print("[DEBUG] Patch payload:", formatted_result)

            nig_service.patch(
                id, {"status": "success", "progress": 1, "result": formatted_result}
            )
        except torch.cuda.OutOfMemoryError:
            error_msg = "GPU is currently occupied by another process. Please wait and try again in a few moments."
            nig_service.patch(id, {"status": "error", "message": error_msg, "data": "GPU Out of Memory"})
            print(f"[{id[:8]}] GPU OOM Error")
        except Exception as e:
            print(f"Error in handle_nig_prediction: {e}")
            nig_service.patch(id, {"status": "error", "data": str(e)})
        finally:
            clear_gpu_memory()
            log_lock(id, "RELEASED (NIG)")


# --- Forward pass handler ---
def handle_forward_pass_request(doc):
    id = doc["_id"]
    
    # Add to queue (broadcasts position to all waiting requests)
    add_to_queue(id, 'fwd')
    
    # Acquire GPU lock (blocks until available)
    log_lock(id, "WAITING (FWD)")
    with gpu_lock:
        log_lock(id, "ACQUIRED (FWD)")
        try:
            remove_from_queue(id)
            forward_service.patch(id, {"status": "processing", "queue_position": 0, "message": ""})
            
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
                id,
                {
                    "status": "success",
                    "result": {
                        "logits": outputs.logits.tolist(),
                        "probabilities": probabilities,
                        "label": label,
                    },
                },
            )
        except torch.cuda.OutOfMemoryError:
            error_msg = "GPU is currently occupied by another process. Please wait and try again in a few moments."
            forward_service.patch(id, {"status": "error", "message": error_msg, "error": "GPU Out of Memory"})
            print(f"[{id[:8]}] GPU OOM Error")
        except Exception as e:
            forward_service.patch(id, {"status": "error", "error": str(e)})
        finally:
            clear_gpu_memory()
            log_lock(id, "RELEASED (FWD)")


def handle_pruned_forward_pass_request(doc):
    id = doc["_id"]
    
    # Add to queue (broadcasts position to all waiting requests)
    add_to_queue(id, 'pruned_fwd')
    
    # Acquire GPU lock (blocks until available)
    log_lock(id, "WAITING (PRUNE)")
    with gpu_lock:
        log_lock(id, "ACQUIRED (PRUNE)")
        try:
            remove_from_queue(id)
            pruned_forward_service.patch(id, {"status": "processing", "queue_position": 0, "message": ""})
            
            print(f"Received pruned forward pass request: {doc}")

            query = doc.get("query")
            passage = doc.get("passage")
            pruning_percentage_attention = doc.get("pruning_percentage_attention", 0.01)
            pruning_percentage_ffn = doc.get("pruning_percentage_ffn", 0.01)

            # Get pruning rules, targets, and edges from the frontend
            pruning_rules = doc.get("pruning_rules", [])
            pruning_targets = doc.get("pruning_targets", [])
            pruning_edges = doc.get("pruning_edges", [])
            pruning_enabled = doc.get("pruning_enabled", False)

            print(f"Query: {query}")
            print(f"Passage: {passage}")
            print(f"Pruning enabled: {pruning_enabled}")

            if not query or not passage:
                raise ValueError("Missing query or passage")

            # Get NIG data from MongoDB
            nig_id = doc.get("nig_id")
            subset_b = None
            sep_position = None
            
            # Try to fetch from MongoDB
            if nig_id:
                # Check if this is a snapshot ID (format: "snapshot-{real_id}")
                if nig_id.startswith("snapshot-"):
                    # Extract real snapshot ID and look in nig-snapshots collection
                    real_snapshot_id = nig_id[9:]  # Remove "snapshot-" prefix
                    print(f"Looking for snapshot in nig-snapshots collection with ID: {real_snapshot_id}")
                    try:
                        snapshot_doc = nig_snapshot_service.get(real_snapshot_id)
                        if snapshot_doc:
                            # Snapshots store NIG data in 'data' field, not 'result.subset_b'
                            subset_b = snapshot_doc.get("data")
                            # sep_position might be in the snapshot or we need to calculate it
                            sep_position = snapshot_doc.get("sep_position")
                            if subset_b:
                                print(f"Retrieved NIG data from snapshot (ID: {real_snapshot_id})")
                            else:
                                print(f"Snapshot found but 'data' field is missing")
                    except Exception as e:
                        print(f"Could not fetch snapshot from nig-snapshots (ID: {real_snapshot_id}): {e}")
                else:
                    # Regular NIG ID - look in nig-values collection
                    print(f"Looking for NIG in nig-values collection with ID: {nig_id}")
                    try:
                        nig_doc = nig_service.get(nig_id)
                        if nig_doc and nig_doc.get("result"):
                            nig_result = nig_doc["result"]
                            subset_b = nig_result.get("subset_b")
                            sep_position = nig_result.get("sep_position")
                            print(f"Retrieved NIG data from nig-values for ID: {nig_id}")
                    except Exception as e:
                        print(f"Could not fetch NIG from nig-values (ID: {nig_id}): {e}")
            
            if not subset_b:
                raise ValueError(f"NIG result not found for ID: {nig_id}. Check if the snapshot or NIG computation exists in the database.")
            
            # Prepare inputs for the model first to get sequence length
            inputs = tokenizer(
                query,
                passage,
                max_length=512,
                truncation=True,
                padding=True,
                return_attention_mask=True,
                return_tensors="pt",
            ).to(device)
            
            seq_len = inputs["attention_mask"].sum().item()
            print(f"Sequence length: {seq_len}")
            
            # Calculate sep_position if not available (e.g., from snapshots)
            # sep_position is the index of the first [SEP] token (after query)
            if sep_position is None:
                input_ids = inputs["input_ids"][0].tolist()
                sep_token_id = tokenizer.sep_token_id
                # Find first [SEP] token position
                try:
                    sep_position = input_ids.index(sep_token_id)
                    print(f"Calculated sep_position from tokenization: {sep_position}")
                except ValueError:
                    raise ValueError("Could not find [SEP] token in input sequence")
            
            print(f"Using NIG data with sep_position: {sep_position}")

            print("Generating pruning masks from aggregated data...")
            # Generate pruning masks using aggregated NIG data from MongoDB
            top_neurons = get_masks_from_aggregated(
                subset_b,
                seq_len,
                sep_position,
                pruning_percentage_attention=pruning_percentage_attention,
                pruning_percentage_ffn=pruning_percentage_ffn,
                pruning_rules=pruning_rules if pruning_enabled else [],
                pruning_targets=pruning_targets if pruning_enabled else [],
                pruning_edges=pruning_edges if pruning_enabled else [],
            )
            print(f"Generated masks for {len(top_neurons)} layers")

            # Run pruned forward pass
            print("Running pruned forward pass...")
            pruned_score = pruned_forward(
                model=model,
                tokenizer=tokenizer,
                inputs=inputs,
                neurons_to_prune=top_neurons,
                input_length=seq_len,
            )
            print(f"Pruned forward pass completed, score: {pruned_score}")

            # Convert score to logit-like format and create response
            import math

            if pruned_score >= 1.0:
                pruned_score = 0.9999  # Avoid log(0)
            elif pruned_score <= 0.0:
                pruned_score = 0.0001  # Avoid log(0)

            logit_value = math.log(pruned_score / (1 - pruned_score))
            label = 1 if pruned_score >= 0.5 else 0

            pruned_forward_service.patch(
                id,
                {
                    "status": "success",
                    "result": {
                        "logits": [[logit_value]],
                        "probabilities": [[pruned_score]],
                        "label": label,
                    },
                },
            )
        except torch.cuda.OutOfMemoryError:
            error_msg = "GPU is currently occupied by another process. Please wait and try again in a few moments."
            pruned_forward_service.patch(id, {"status": "error", "message": error_msg, "error": "GPU Out of Memory"})
            print(f"[{id[:8]}] GPU OOM Error")
        except Exception as e:
            print(f"Error in pruned forward pass: {e}")
            pruned_forward_service.patch(id, {"status": "error", "error": str(e)})
        finally:
            clear_gpu_memory()
            log_lock(id, "RELEASED (PRUNE)")


# --- Conditional NIG handler ---
def handle_conditional_nig_request(doc):
    """
    Handle a conditional NIG computation request.
    Computes NIG with respect to a specific target neuron instead of the final output.
    """
    id = doc["_id"]
    
    # Add to queue (broadcasts position to all waiting requests)
    add_to_queue(id, 'conditional_nig')
    
    # Acquire GPU lock (blocks until available)
    log_lock(id, "WAITING (COND_NIG)")
    with gpu_lock:
        log_lock(id, "ACQUIRED (COND_NIG)")
        try:
            remove_from_queue(id)
            conditional_nig_service.patch(id, {"status": "processing", "progress": 0, "queue_position": 0, "message": ""})
        
            query = doc.get("query")
            passage = doc.get("passage")
            num_reps = doc.get("num_reps", 20)
            layer_idx = doc.get("layer_idx", 0)
            neuron_idx = doc.get("neuron_idx", 0)
            neuron_type_str = doc.get("neuron_type", "attention")  # "attention" or "ffn"
            source_input_part_str = doc.get("source_input_part", None)  # For attention: which tokens are attending
            target_input_part_str = doc.get("target_input_part", None)  # For attention: which tokens are being attended to
            
            # Convert string to NeuronType enum
            neuron_type = NeuronType.ATTENTION if neuron_type_str == "attention" else NeuronType.FFN
            
            # Convert strings to InputPart enum if provided
            source_input_part = None
            target_input_part = None
            
            if source_input_part_str:
                try:
                    source_input_part = InputPart(source_input_part_str)
                except ValueError:
                    print(f"Invalid source_input_part: {source_input_part_str}")
            
            if target_input_part_str:
                try:
                    target_input_part = InputPart(target_input_part_str)
                except ValueError:
                    print(f"Invalid target_input_part: {target_input_part_str}")
            
            print(f"Conditional NIG request: layer={layer_idx}, neuron={neuron_idx}, type={neuron_type}, source={source_input_part}, target={target_input_part}")

            def progress_callback(current, total):
                progress = current / total
                conditional_nig_service.patch(id, {"progress": progress})

            # Compute conditional NIG
            subset_b, error, sep_position = compute_conditional_nig(
                model=model,
                tokenizer=tokenizer,
                query=query,
                passage=passage,
                num_reps=num_reps,
                batch_size=BATCH_SIZE,
                layer_idx=layer_idx,
                neuron_idx=neuron_idx,
                neuron_type=neuron_type,
                source_input_part=source_input_part,
                target_input_part=target_input_part,
                progress_callback=progress_callback,
            )

            print("Conditional NIG computed successfully")
            print(f"Subset B Keys: {subset_b.keys()}")

            # Format result for frontend
            formatted_result = {
                "subset_b": subset_b,
                "target": {
                    "layer_idx": layer_idx,
                    "neuron_idx": neuron_idx,
                    "neuron_type": neuron_type_str,
                    "source_input_part": source_input_part_str,
                    "target_input_part": target_input_part_str,
                }
            }

            conditional_nig_service.patch(
                id, {"status": "success", "progress": 1, "result": formatted_result}
            )
        except torch.cuda.OutOfMemoryError:
            error_msg = "GPU is currently occupied by another process. Please wait and try again in a few moments."
            conditional_nig_service.patch(id, {"status": "error", "message": error_msg, "data": "GPU Out of Memory"})
            print(f"[{id[:8]}] GPU OOM Error")
        except Exception as e:
            print(f"Error in handle_conditional_nig_request: {e}")
            import traceback
            traceback.print_exc()
            conditional_nig_service.patch(id, {"status": "error", "data": str(e)})
        finally:
            clear_gpu_memory()
            log_lock(id, "RELEASED (COND_NIG)")


# Bind handlers to services
ig_service.on("created", handle_ig_prediction)
nig_service.on("created", handle_nig_prediction)
dataset_service.on("created", handle_sample_request)
forward_service.on("created", handle_forward_pass_request)
pruned_forward_service.on("created", handle_pruned_forward_pass_request)
conditional_nig_service.on("created", handle_conditional_nig_request)

# Initialize service map for queue position broadcasting
init_service_map()

# Start periodic cleanup of old documents
start_cleanup_scheduler()

# Connect with authentication and wait indefinitely
store.connect(os.getenv("MARCELLE_LOGIN"), os.getenv("MARCELLE_PWD"))
store.wait()
