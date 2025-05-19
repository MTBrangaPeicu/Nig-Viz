from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from ray import serve
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import uvicorn
import threading

from utils import (
    generate_baseline_with_padded_query_and_passage_but_special_tokens,
    generate_baseline_with_padded_query_but_special_tokens,
    generate_baseline_with_only_padded_tokens,
)

# Main app for Ray Serve
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

serve.start()

@serve.deployment
@serve.ingress(app)
class ModelDeployment:
    def __init__(self):
        self.progress_websockets = set()
        self.progress_lock = threading.Lock()

    @app.get("/")
    async def home(self):
        return {"message": "Welcome to the model prediction API"}

    def select_baseline_function(self, baseline_type):
        """
        Select the baseline function based on the baseline_type.
        """
        baseline_choices = {
            0: generate_baseline_with_only_padded_tokens,
            1: generate_baseline_with_padded_query_and_passage_but_special_tokens,
            2: generate_baseline_with_padded_query_but_special_tokens,
        }
        baseline_function = baseline_choices.get(baseline_type)
        if not baseline_function:
            raise ValueError(f"Invalid baseline_type: {baseline_type}")
        return baseline_function

    @app.post("/predict")
    async def get_prediction(self, request: Request):
        data = await request.json()
        query = data.get('query')
        passage = data.get('passage')
        batch_size = data.get('batch_size', 10)  # Default to 10
        num_reps = data.get('num_reps', 20)  # Default to 20
        baseline_type = data.get('baseline_type', 1)  

        if not query or not passage:
            return {"error": "Please provide both query and passage."}

        baseline_function = self.select_baseline_function(baseline_type)

        # --- Reset progress to 0 at the start ---
        with self.progress_lock:
            websockets = list(self.progress_websockets)
        for ws in websockets:
            try:
                await ws.send_json({"progress": 0})
            except Exception:
                with self.progress_lock:
                    self.progress_websockets.discard(ws)

        progress_updates = {}

        def progress_callback(current, total):
            percent = int((current / total) * 100)
            with self.progress_lock:
                for ws in list(self.progress_websockets):
                    progress_updates[ws] = percent

        ig, error = predict(
            query,
            passage,
            num_reps,
            batch_size,
            baseline_function,
            progress_callback=progress_callback,
        )

        # Send the latest progress to all websockets (awaited, not scheduled)
        for ws, percent in progress_updates.items():
            try:
                await ws.send_json({"progress": percent})
            except Exception:
                with self.progress_lock:
                    self.progress_websockets.discard(ws)

        # --- Ensure progress is 100% at the end ---
        with self.progress_lock:
            websockets = list(self.progress_websockets)
        for ws in websockets:
            try:
                await ws.send_json({"progress": 100})
            except Exception:
                with self.progress_lock:
                    self.progress_websockets.discard(ws)

        response = {
            "tokens": ig["tokens"],
            "attributions": ig["attributions"].tolist(),
            "error": error
        }
        return response

    @app.post("/nig_predict")
    async def get_nig_prediction(self, request: Request):
        data = await request.json()
        query = data.get('query')
        passage = data.get('passage')
        batch_size = data.get('batch_size', 10)  # Default to 10
        num_reps = data.get('num_reps', 20)  # Default to 20
        baseline_type = data.get('baseline_type', 1) 
        split_type = data.get('split_type', False) 

        if not query or not passage:
            return {"error": "Please provide both query and passage."}

        # Select baseline function
        baseline_function = self.select_baseline_function(baseline_type)

        # Call nig_predict function
        nig, error = nig_predict(
            query,
            passage,
            num_reps,
            batch_size,
            baseline_function,
            split_type,
        )

        # Ensure the response is JSON-serializable
        if split_type:
            response = {
                "nig": {key: value.tolist() for key, value in nig.items()},  # Split by token types
            }
        else:
            response = {
                "nig": {key: value.tolist() for key, value in nig.items()},  # Single aggregated value
            }

        return response

    @app.websocket("/progress")
    async def progress_endpoint(self, websocket: WebSocket):
        await websocket.accept()
        with self.progress_lock:
            self.progress_websockets.add(websocket)
        try:
            await websocket.send_json({"progress": 0})
            while True:
                await asyncio.sleep(1)  # Keep connection open for updates
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            with self.progress_lock:
                self.progress_websockets.discard(websocket)
            await websocket.close()

bertie = ModelDeployment.bind()

