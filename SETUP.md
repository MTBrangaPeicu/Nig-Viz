# NIG Visualization Setup Guide

This guide explains how to get the NIG visualization app running with the full backend stack.

## Architecture Overview

The application consists of three components:
1. **Marcelle Backend** - MongoDB + SocketIO server (port 3030)
2. **Python ML Service** - Handles NIG computation and model inference
3. **SvelteKit Frontend** - User interface (port 5173)

## Prerequisites

- Node.js (v18+)
- Python 3.8+
- MongoDB (local instance or connection string)
- pnpm package manager

## Step 1: Install Dependencies

### Frontend Dependencies
```bash
cd /Users/hcisorbonne/Documents/Project_Code/my-app
pnpm install
```

### Python Dependencies
```bash
cd /Users/hcisorbonne/Documents/Project_Code/my-app/Model
pip install -r requirements.txt
```

## Step 2: Configure MongoDB

Edit `backend/config/default.json` and ensure MongoDB connection is correct:

```json
{
  "mongodb": "mongodb://localhost:27017/my_app"
}
```

Make sure MongoDB is running:
```bash
# Check if MongoDB is running
mongosh --eval "db.version()"
```

## Step 3: Start the Services

You need **3 terminals** running simultaneously:

### Terminal 1: Marcelle Backend
```bash
cd /Users/hcisorbonne/Documents/Project_Code/my-app
pnpm backend
```

This starts the Marcelle backend on `http://localhost:3030`. You should see:
```
Server started on http://localhost:3030
```

### Terminal 2: Python ML Service
```bash
cd /Users/hcisorbonne/Documents/Project_Code/my-app/Model
python -m marcelle.data_store
```

This connects the Python service to the Marcelle backend via SocketIO. The Python service listens for:
- `predictions` service - Token IG calculations
- `nig-values` service - NIG value calculations  
- `msmarco-samples` service - Dataset queries

### Terminal 3: SvelteKit Frontend
```bash
cd /Users/hcisorbonne/Documents/Project_Code/my-app
pnpm dev
```

This starts the dev server on `http://localhost:5173` (or 5174 if 5173 is in use).

## Step 4: Verify Everything Works

1. Open `http://localhost:5173` in your browser
2. Navigate to the NIG Visualization page
3. Click "Open NIG Visualization"
4. You should see:
   - Architecture grid (empty until you submit queries)
   - NIG Table
   - Distribution histogram
   - Output console at bottom

## Data Flow

```
User Input (Query + Passage)
    ↓
Frontend (SvelteKit) sends request to services
    ↓
Marcelle Backend (SocketIO) relays to Python
    ↓
Python ML Service computes NIG values
    ↓
Results stored in MongoDB + sent back via SocketIO
    ↓
Frontend components update reactively
```

## Services Overview

### `msmarco-samples`
- Provides query/passage samples from MS MARCO dataset
- Supports subset filtering (Random, Rel=0, Rel=1, etc.)

### `predictions` 
- Computes Token Integrated Gradients
- Input: query, passage, num_reps
- Output: Token attributions

### `nig-values`
- Computes Neuron Integrated Gradients  
- Input: query, passage, num_reps
- Output: NIG values per layer/neuron

## Troubleshooting

### "Connection refused" errors
- Check MongoDB is running: `mongosh`
- Check Marcelle backend is running on port 3030
- Verify no firewall blocking localhost connections

### Python service not connecting
- Ensure `python-socketio[client]` is installed
- Check the backend URL in Python code matches `http://localhost:3030`
- Look for "Connected to backend" message in Python terminal

### Frontend shows no data
- Open browser DevTools → Network tab
- Check for WebSocket connection to `ws://localhost:3030`
- Verify store.ts points to `http://localhost:3030` (not localStorage)

### Port already in use
- Backend: Change port in `backend/config/default.json`
- Frontend: Vite will auto-select next available port (5174, 5175, etc.)

## Next Steps

Once everything is running:
1. Test the Input panel - submit a query/passage
2. Check Architecture panel settings (absolute values, node colors)
3. Try Pruning mode with the scissor icon
4. Experiment with Conditional NIG using magnifying glass icon
5. Monitor Output Console for Forward/Pruned pass results
