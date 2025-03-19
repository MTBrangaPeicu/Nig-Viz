from integrated_gradients import predict
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

        if not query or not passage:
            return {"error": "Please provide both query and passage."}

        result = predict(
            query,
            passage,
            20,
            10
        )
        return result

bertie = ModelDeployment.bind()
