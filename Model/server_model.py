from integrated_gradients import predict
from neuron_integrated_gradients import nig_predict
from ray import serve
from fastapi import FastAPI, Request
from markupsafe import Markup
from fastapi.middleware.cors import CORSMiddleware

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
    @app.get("/")
    async def home(self):
        return {"message": "Welcome to the model prediction API"}

    @app.post("/predict")
    async def get_prediction(self, request: Request):
        data = await request.json()
        query = data.get('query')
        passage = data.get('passage')
        batch_size = data.get('batch_size', 10)  # Default to 10 if not provided
        num_reps = data.get('num_reps', 20)  # Default to 20 if not provided

        if not query or not passage:
            return {"error": "Please provide both query and passage."}

        result = predict(
            query,
            passage,
            num_reps,
            batch_size
        )

        # Ensure the response is JSON-serializable
        response = {
            "tokens": result["tokens"],
            "attributions": result["attributions"].tolist()  # Convert NumPy array to list
        }
        return response
    
    @app.post("/nig_predict")
    async def get_prediction(self, request: Request):
        data = await request.json()
        query = data.get('query')
        passage = data.get('passage')
        batch_size = data.get('batch_size', 10)  # Default to 10 if not provided
        num_reps = data.get('num_reps', 20)  # Default to 20 if not provided

        if not query or not passage:
            return {"error": "Please provide both query and passage."}

        nig, error = nig_predict(
            query,
            passage,
            num_reps,
            batch_size
        )

        # Ensure the response is JSON-serializable
        response = {
            "nig": {key: value.tolist() for key, value in nig.items()},
            "error": error
        }
        return response

bertie = ModelDeployment.bind()
