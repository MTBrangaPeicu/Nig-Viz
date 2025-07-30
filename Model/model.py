import numpy as np
from marcelle import DataStore
import threading
from datasets import load_dataset
import random
from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from aggregation import aggregate_nig  # Import aggregation logic
from utils import (
    generate_baseline_with_only_padded_tokens,
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
)
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

# Setup DataStore and Services
store = DataStore("http://localhost:3030")
ig_service = store.service("predictions")
nig_service = store.service("nig-values")
dataset_service = store.service("msmarco-samples")
forward_service = store.service("forward-pass")

# Initialize the MS MARCO development dataset
print("Initializing MS MARCO development dataset from Hugging Face...")
dataset = load_dataset("ms_marco", "v2.1", split="validation")  
print("Dataset initialized.")

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
model = AutoModelForSequenceClassification.from_pretrained("cross-encoder/ms-marco-MiniLM-L12-v2").to(device)
model.eval()
tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

def get_random_samples(n=10):
    """Get n random samples from the Hugging Face MS MARCO dataset."""
    dataset_list = list(dataset)  # Convert the dataset to a list
    random_samples = random.sample(dataset_list, n)  # Select n random samples directly
    samples = [
        {
            "query": sample["query"],
            "passages": [
                {"text": text} for text in sample["passages"]["passage_text"] if text  # Extract valid passage texts from the passage_text field
            ],
        }
        for sample in random_samples
    ]
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
        print(f"samples Generated")
        # Ensure the samples field is included in the response
        dataset_service.patch(doc["_id"], {
            "status": "success",
            "samples": samples
        })
        #print(f"Response sent to frontend: {samples}")
    except Exception as e:
        print(f"Error handling sample request: {e}")
        dataset_service.patch(doc["_id"], {
            "status": "error",
            "error": str(e)
        })

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

        ig_service.patch(id, {
            "status": "success",
            "progress": 1,
            "result": result
        })
    except Exception as e:
        ig_service.patch(id, {
            "status": "error",
            "data": str(e)
        })
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

        nig, error, sep_position = nig_predict(
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
            # "error": error,  # Commented out - error rates too high, keeping as NA
        }

        #print("[DEBUG] Subset B keys (about to send):", list(subset_b.keys()))
        #print("[DEBUG] Patch payload:", formatted_result)

        nig_service.patch(id, {
            "status": "success",
            "progress": 1,
            "result": formatted_result
        })
    except Exception as e:
        print(f"Error in handle_nig_prediction: {e}")
        nig_service.patch(id, {
            "status": "error",
            "data": str(e)
        })
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
            padding=True,
            return_attention_mask=True,
            return_tensors="pt"
        ).to(device)

        outputs = model(**inputs)
        probabilities = torch.sigmoid(outputs.logits).tolist()
        label = 1 if probabilities[0][0] >= 0.5 else 0

        forward_service.patch(doc["_id"], {
            "status": "success",
            "result": {
                "logits": outputs.logits.tolist(),
                "probabilities": probabilities,
                "label": label
            }
        })
    except Exception as e:
        forward_service.patch(doc["_id"], {
            "status": "error",
            "error": str(e)
        })

# Bind handlers to services
ig_service.on("created", handle_ig_prediction)
nig_service.on("created", handle_nig_prediction)
dataset_service.on("created", handle_sample_request)
forward_service.on("created", handle_forward_pass_request)

# Connect and wait indefinitely
store.connect()
store.wait()