from marcelle import DataStore
import threading
import ir_datasets
import random
from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from utils import (
    generate_baseline_with_only_padded_tokens,
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
)

# Setup DataStore and services
store = DataStore("http://localhost:3030")
pred_service = store.service("predictions")
nig_service = store.service("nig-values")
dataset_service = store.service("msmarco-samples")

# Initialize the MS MARCO development dataset
print("Initializing MS MARCO development dataset...")
dataset = ir_datasets.load("msmarco-passage/dev")
print("Dataset initialized.")

# Threading lock to handle concurrent runs safely
lock = threading.Lock()

# Baseline selection map
BASELINE_MAP = {
    0: generate_baseline_with_only_padded_tokens,
    1: generate_baseline_with_padded_query_and_passage_but_special_tokens,
    2: generate_baseline_with_padded_query_but_special_tokens,
}

def get_random_samples(n=10):
    """Get n random samples from the dataset using the ir_datasets API."""
    samples = []
    queries = list(dataset.queries_iter())  # Fetch all queries
    random_queries = random.sample(queries, min(n, len(queries)))  # Randomly select n queries
    for query in random_queries:
        qid = query.query_id
        passages = list(filter(lambda x: x.query_id == qid, dataset.qrels_iter()))
        if passages:
            samples.append({
                'query_id': qid,
                'query': query.text,
                'passages': [{
                    'passage_id': p.doc_id,
                    'text': dataset.docs_store().get(p.doc_id).text if dataset.docs_store().get(p.doc_id) else None,
                    'relevance': p.relevance
                } for p in passages[:3] if dataset.docs_store().get(p.doc_id)]  # Limit to 3 passages per query
            })
    return samples

# --- Dataset sample handler ---
def handle_sample_request(doc):
    try:
        print(f"Received sample request: {doc}")
        n_samples = doc.get('n', 10)
        samples = get_random_samples(n_samples)
        if not samples:
            print("No samples generated.")
            dataset_service.patch(doc["_id"], {
                "status": "error",
                "error": "No samples could be generated."
            })
            return
        print(f"Generated samples: {samples}")
        # Ensure the samples field is included in the response
        dataset_service.patch(doc["_id"], {
            "status": "success",
            "samples": samples
        })
        print(f"Response sent to frontend: {samples}")
    except Exception as e:
        print(f"Error handling sample request: {e}")
        dataset_service.patch(doc["_id"], {
            "status": "error",
            "error": str(e)
        })

# --- IG prediction handler ---
def handle_prediction(doc):
    id = doc["_id"]

    if lock.locked():
        pred_service.patch(id, {"status": "pending"})
    lock.acquire()
    try:
        pred_service.patch(id, {"status": "processing", "progress": 0})
        query = doc.get("query")
        passage = doc.get("passage")
        batch_size = doc.get("batch_size", 10)
        num_reps = doc.get("num_reps", 20)
        baseline_type = doc.get("baseline_type", 1)
        baseline_func = BASELINE_MAP.get(baseline_type)

        def progress_callback(current, total):
            progress = current / total
            pred_service.patch(id, {"progress": progress})

        ig_result, error = predict(
            query, passage, num_reps, batch_size, baseline_func, progress_callback
        )

        result = {
            "tokens": ig_result["tokens"],
            "attributions": ig_result["attributions"].tolist(),
            "error": error,
        }

        pred_service.patch(id, {
            "status": "success",
            "progress": 1,
            "result": result
        })
    except Exception as e:
        pred_service.patch(id, {
            "status": "error",
            "data": str(e)
        })
    finally:
        lock.release()

# --- NIG prediction handler ---
def handle_nig_prediction(doc):
    id = doc["_id"]

    if lock.locked():
        nig_service.patch(id, {"status": "pending"})
    lock.acquire()
    try:
        nig_service.patch(id, {"status": "processing", "progress": 0})
        query = doc.get("query")
        passage = doc.get("passage")
        batch_size = doc.get("batch_size", 10)
        num_reps = doc.get("num_reps", 20)
        baseline_type = doc.get("baseline_type", 1)
        split_type = doc.get("split_type", False)
        baseline_func = BASELINE_MAP.get(baseline_type)

        nig_result, error = nig_predict(
            query, passage, num_reps, batch_size, baseline_func, split_type
        )

        formatted_result = {
            "nig": {k: v.tolist() for k, v in nig_result.items()},
            "error": error,
        }

        nig_service.patch(id, {
            "status": "success",
            "progress": 1,
            "result": formatted_result
        })
    except Exception as e:
        nig_service.patch(id, {
            "status": "error",
            "data": str(e)
        })
    finally:
        lock.release()

# Bind handlers to services
pred_service.on("created", handle_prediction)
nig_service.on("created", handle_nig_prediction)
dataset_service.on("created", handle_sample_request)

# Connect and wait indefinitely
store.connect()
store.wait()