# IR Lens

## An Interpretability Tool for Cross-Encoder Ranking Models

Transformer-based ranking models, such as MonoBERT, are central to Information Retrieval; yet their inner workings remain largely opaque. This hinders not only our understanding of the systems implementing them, but also our ability to improve them.

**IR Lens** is a new interpretability tool tailored to cross-encoders, based on two key components:

1. **Neuron Integrated Gradients** ([Vast et al., 2024](https://dl.acm.org/doi/abs/10.1145/3664190.3672528)) to expose the contributions of model parts at multiple levels
2. **Targeted ablations** to support hypothesis tracking

With its interactive graphical interface, IR Lens enables IR practitioners to explore, analyze, and manipulate neuron-level mechanisms in cross-encoders, facilitating a deeper understanding of neural ranking models. By extending the reach of existing interpretability methods, we believe IR Lens has the potential to support the improvement of cross-encoders.

## Architecture

IR Lens is implemented as a web-based system combining a reactive frontend with a backend for attribution computation and model inference.

1. **Frontend**: Built using [Marcelle](https://marcelle.dev) ([Françoise et al., 2021](https://dl.acm.org/doi/10.1145/3472749.3474734)), a toolkit for building interactive machine learning interfaces based on SvelteKit (Svelte 5), styled with TailwindCSS and DaisyUI. Custom interpretability visualizations are implemented with [D3.js](https://d3js.org/) ([Bostock et al., 2011](https://doi.org/10.1109/TVCG.2011.185)).

2. **Backend**: Built on the Marcelle server infrastructure, using FeathersJS over Socket.IO for real-time communication and MongoDB for persistence.

3. **Python Service**: A dedicated Python service, connected to the backend, performs model inference, attribution computation, and ablation-based forward passes. The service exposes endpoints returning structured outputs for IGs and NIGs computation, conditional NIGs, and forward passes with and without ablations.

4. **Real-time Updates**: Results are persisted in MongoDB and streamed back to the frontend, allowing visualizations to update in real time. Users can save snapshots of NIG values and prunes, enabling them to revisit previous analyses.

Separating computation from interaction ensures that computationally intensive operations do not compromise interface responsiveness while maintaining a tight integration between attribution results and user-driven exploration.

## Demonstration

The primary application code lives in [src/](src/) with backend configuration in [backend/](backend/). The easiest way to explore the UI is to run the development server and open the app in your browser.

## Installation

### Prerequisites

- **Node.js**: v18+ recommended
- **pnpm**: Package manager (`npm install -g pnpm`)
- **Python**: 3.9+ (for the model backend)
- **MongoDB**: 6.0+ (see [MongoDB Setup](#mongodb-setup))

### Setting up Marcelle (Development Branch)

This project uses the development branch of Marcelle. Full setup instructions can be found at https://next.marcelle.dev/guides/quickstart.html.

To build a local version of Marcelle libraries:

```bash
git clone git@github.com:marcellejs/marcelle.git
cd marcelle
git checkout develop
pnpm i
pnpm build
```

Ensure the `marcelle` folder is at the same level as this project, as dependencies are linked locally via `link:../marcelle/packages/*`.

### Install IR Lens dependencies

```bash
pnpm install
```

## MongoDB Setup

IR Lens uses MongoDB as the data store for persistence.

### Installing MongoDB Locally

1. **Download MongoDB Community Server** from https://www.mongodb.com/try/download/community

2. **Install** 
following the instructions for your operating system

3. **Start MongoDB**:
   specific to your OS
    

4. **Verify** MongoDB is running on the default port `27017`:
   ```bash
   mongosh
   ```

## Backend Setup

### Marcelle Backend

Start the backend server:

```bash
pnpm backend
```

The backend runs on port `3030` by default. Configuration files are in [backend/config/](backend/config/).

### Environment Variables

Environment variables should be placed in `.env` files in the appropriate directories:

- **Root `.env`**: For frontend and backend services
- **`Model/.env`**: For the Python service

#### Backend/Frontend Environment Variables (root `.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `HOSTNAME` | Backend host | `localhost` |
| `PORT` | Backend port | `3030` |
| `MONGODB_URL` | MongoDB connection string | `mongodb://localhost:27017/my_app` |
| `FEATHERS_SECRET` | JWT secret for authentication | (set in config) |
| `MARCELLE_LOGIN` | Admin user email for first user |  |
| `MARCELLE_PWD` | Admin user password |  |

#### Python Service Environment Variables (`Model/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `MARCELLE_BACKEND_SERVER` | Backend server address | `localhost` |
| `MARCELLE_BACKEND_PORT` | Backend port | `3030` |
| `MARCELLE_LOGIN` | User email for authentication |  |
| `MARCELLE_PWD` | User password for authentication |  |

Changing environment variables requires restarting the respective services.

### Admin/Superadmin Access for Python Code

The Python model code needs to access all saved data in MongoDB. To enable this:

1. The first user created in the database is typically assigned the `admin` or `superadmin` role
2. Set `MARCELLE_LOGIN` and `MARCELLE_PWD` environment variables to this user's credentials
3. The Python script authenticates using these credentials to gain full access to all services

Permissions are configured in [backend/config/default.json](backend/config/default.json). The `superadmin` and `admin` roles have `manage` access to all subjects.

## Python Model Backend

The model and interpretability code lives in [Model/](Model/).

### Requirements

Install Python dependencies:

```bash
cd Model
pip install -r requirements.txt
```

Key dependencies include:
- `torch==2.0.0`
- `transformers==4.24.0`
- `ir_datasets==0.5.5`
- `python-socketio[client]==5.9.0`

### Dataset

IR Lens provides direct access to TREC-DL 2019 queries and annotated passages, sorted by relevance levels. TREC-DL 2019 is based on the MS MARCO passage ranking dataset.

- **Source**: https://ir-datasets.com/msmarco-passage.html#msmarco-passage/trec-dl-2019/judged
- **Loaded via**: `ir_datasets.load("msmarco-passage/trec-dl-2019/judged")`

The dataset is automatically downloaded by `ir_datasets` on first run.

In addition to the provided dataset, users can experiment with their own custom query-passage pairs directly in the interface.

### Model

To keep inference time reasonable, we limit the choice of cross-encoder to one based on the MiniLM-v2 backbone:

- **Model**: [`cross-encoder/ms-marco-MiniLM-L12-v2`](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L12-v2)
- **Architecture**: 12-layer BERT-style encoder with 1536 FFN neurons per layer

```python
from transformers import AutoModelForSequenceClassification, AutoTokenizer

model = AutoModelForSequenceClassification.from_pretrained("cross-encoder/ms-marco-MiniLM-L12-v2")
tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
```

### Extensibility

The Python backend dynamically reads model architecture from `model.config` (number of layers, attention heads, intermediate size), making it adaptable to different BERT-like cross-encoders.

To use a different model or dataset, you would need to:
1. Update the model checkpoint in [Model/model.py](Model/model.py)
2. Update the dataset loading call in [Model/model.py](Model/model.py)
3. Adjust the frontend layer/neuron constants to match the new model architecture

### Running the Model Server

```bash
cd Model
python model.py
```

The script connects to the Marcelle backend and listens for requests from the frontend.

## Usage

### Development

```bash
pnpm dev
```

Open http://localhost:5173 to view the app. The page reloads on edits.

### Build

```bash
pnpm build
```

Builds a static copy of the site to `dist/`.

## Project Structure

- [src/](src/): Frontend SvelteKit application
- [backend/](backend/): Marcelle backend configuration
- [Model/](Model/): Python model and interpretability code
  - `model.py`: Main model server with dataset loading and inference
  - `integrated_gradients.py`: Integrated Gradients implementation
  - `neuron_integrated_gradients.py`: Neuron-level IG
  - `aggregation.py`: NIG aggregation logic
  - `prune.py`: Ablation/pruning utilities
  - `requirements.txt`: Python dependencies
- [docker/](docker/): Docker/container configuration files
- [static/](static/): Static assets

## Docker Deployment

For containerized deployment, compose files are provided for both the frontend/backend services and the Python model service.

### Infrastructure Overview

The backend, frontend, and MongoDB services can run in separate containers. In a production setup:


- The Mongo database is stored in a volume for persistence between container recreations

### Frontend/Backend Containers

A `compose.yml` file is provided in the project root.

All environment variables are set in the root `.env` file. Changing these variables requires recreating the containers.

### Python Model Container

The Python model service has its own `compose.yml` in the `Model/` directory.

The downloaded datasets are stored as a volume (e.g., `/data/nig-viz/datasets` on the host).

Environment variables are set in `Model/.env`. Changing these requires recreating the container.

### Resetting the Database

To reset the MongoDB database, delete the volume:

```bash
docker volume rm ir-lens_db
```

## Notes

- This app currently targets the Marcelle development branch
- Ensure MongoDB is running before starting the backend
- The Python model server requires GPU access for optimal performance (falls back to CPU)
- The frontend architecture visualization is currently tailored to 12-layer BERT-style models

## Citation

<!-- TODO: Add citation when available -->
```bibtex

```

## References

- Vast, E., et al. (2024). *Which Neurons Matter in IR? Applying Integrated Gradients-based Methods to Understand Cross-Encoders*. [ACM SIGIR](https://dl.acm.org/doi/abs/10.1145/3664190.3672528)
- Françoise, J., et al. (2021). *Marcelle: Composing Interactive Machine Learning Workflows and Interfaces*. [ACM UIST](https://dl.acm.org/doi/10.1145/3472749.3474734)
- Bostock, M., et al. (2011). *D3: Data-Driven Documents*. [IEEE TVCG](https://doi.org/10.1109/TVCG.2011.185)


## License

See [LICENSE](LICENSE).
