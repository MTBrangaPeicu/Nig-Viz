# Frontend Logic Migration Guide

## Overview

The `index.js` from Nig-Viz contains all the UI orchestration logic that needs to be integrated into your SvelteKit `+page.svelte` file. Here's what needs to be done:

## What index.js Does

The `index.js` file in Nig-Viz handles:

1. **Service Connections**
   - Creates `store` connection to backend
   - Sets up model instances (`igModelInstance`, `nigModelInstance`)
   - Connects to dataset service (`msmarco-samples`)

2. **UI Component Creation & Wiring**
   - Creates input widgets (query, passage, baseline selector)
   - Creates visualization components (architecture, table, histogram)
   - Wires up buttons (Submit IG, Calculate NIGs)
   - Manages progress bars

3. **Data Flow Management**
   - Subscribes to model results
   - Updates visualizations when data arrives
   - Handles selection changes
   - Manages NIG snapshots (save/load)

4. **State Management**
   - Tracks current NIG ID for threshold updates
   - Maintains global extent values for consistent scaling
   - Caches dataset samples
   - Stores NIG snapshots in localStorage

## Migration Strategy

### Option 1: Adapt Existing Panels (Recommended)

Since you've already created custom SvelteKit panels, you need to:

1. **Add service subscriptions** to `+page.svelte`:
```typescript
import { store } from '$lib/marcelle/store';
import { nigModel } from '$lib/marcelle/components';

// Create model instances
const igModelInstance = nigModel(store, 'predictions');
const nigModelInstance = nigModel(store, 'nig-values');
const datasetService = store.service('msmarco-samples');
```

2. **Wire up Input Panel** to submit predictions:
```typescript
// In InputPanel.svelte
function handleSubmitNIG() {
  nigModelInstance.predict({
    query: queryValue,
    passage: passageValue,
    num_reps: numReps,
    baseline_type: getBaselineType(selectedBaseline),
    type: 'nig'
  });
}
```

3. **Subscribe to results** and update components:
```typescript
nigModelInstance.$data.subscribe(doc => {
  if (!doc?.result?.subset_b) return;
  
  // Update stores
  nigData.set(doc.result.subset_b);
  
  // Update components
  tableComponent.$options.next({ 
    values: doc.result.subset_b,
    type: 'FFN' 
  });
  
  architectureComponent.$options.next({
    values: doc.result.subset_b
  });
});
```

4. **Handle dataset service** for query/passage samples:
```typescript
datasetService.on('patched', (doc) => {
  if (doc.status === 'success' && doc.samples) {
    // Update query dropdown options
    const queries = doc.samples.map(s => s.query);
    // Update passage options when query selected
  }
});

// Initial request
datasetService.create({ n: 10, subset: 'Random' });
```

### Option 2: Create a Composable Service Layer

Create a file `src/lib/services/nig-service.ts`:

```typescript
import { store } from '$lib/marcelle/store';
import { nigModel } from '$lib/marcelle/components';
import { writable, derived } from 'svelte/store';

class NIGService {
  igModel = nigModel(store, 'predictions');
  nigModel = nigModel(store, 'nig-values');
  datasetService = store.service('msmarco-samples');
  
  // Reactive stores
  queryOptions = writable<string[]>([]);
  passageOptions = writable<string[]>([]);
  currentNIGData = writable(null);
  
  constructor() {
    this.setupSubscriptions();
  }
  
  setupSubscriptions() {
    // Dataset service
    this.datasetService.on('patched', (doc) => {
      if (doc.status === 'success' && doc.samples) {
        this.queryOptions.set(doc.samples.map(s => s.query));
      }
    });
    
    // NIG results
    this.nigModel.$data.subscribe(doc => {
      if (doc?.result?.subset_b) {
        this.currentNIGData.set(doc.result.subset_b);
      }
    });
  }
  
  requestSamples(subset = 'Random', n = 10) {
    this.datasetService.create({ n, subset });
  }
  
  calculateNIG(query: string, passage: string, numReps = 20) {
    this.nigModel.predict({
      query,
      passage,
      num_reps: numReps,
      baseline_type: 1,
      type: 'nig'
    });
  }
}

export const nigService = new NIGService();
```

Then use in your components:
```svelte
<script lang="ts">
  import { nigService } from '$lib/services/nig-service';
  
  let { queryOptions } = $derived(nigService);
  
  function handleSubmit() {
    nigService.calculateNIG(query, passage, numReps);
  }
</script>
```

## Key Functions to Port

### 1. Calculate NIGs (Submit Button)
```typescript
submitNIG.$click.subscribe(() => {
  // Reset selection
  archComponent.$selection.next({ source: null, target: null });
  
  // Capture inputs for snapshot
  lastNIGRequestInputs = {
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
    baselineLabel: baselineDropdown.$value.getValue(),
    numReps: numRepsInput.$value.getValue(),
  };

  // Submit prediction
  nigModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    type: 'nig'
  });
});
```

### 2. Handle NIG Results
```typescript
nigModelInstance.$data.subscribe(doc => {
  if (!doc?.result?.subset_b) return;
  
  const nigData = doc.result.subset_b;
  
  // Create snapshot
  if (!doc.__fromSnapshot) {
    const snapshot = {
      id: Date.now(),
      timestamp: new Date().toISOString().slice(0,19).replace('T',' '),
      data: nigData,
      query: lastNIGRequestInputs.query,
      passage: lastNIGRequestInputs.passage,
      // ... other metadata
    };
    nigSnapshots.push(snapshot);
    persistSnapshots();
  }
  
  // Update components
  updateAllVisualizations(nigData, doc.result.attn_activations, doc.result.ffn_activations);
});
```

### 3. Architecture Selection
```typescript
// Subscribe to table selection requests
tableComponent.selectionRequest$.subscribe((selection) => {
  if (selection && archComponent.$selection) {
    archComponent.$selection.next(selection);
  }
});

// Subscribe to architecture selection for updating other views
archComponent.$selection.subscribe((selection) => {
  if (!selection || !selection.layer) return;
  
  // Update table to show selected layer
  // Update histogram to show selected neuron distribution
});
```

### 4. Dataset Service
```typescript
// Handle query selection
queryInput.$value.subscribe((selectedQuery) => {
  const sample = samples.find(s => s.query === selectedQuery);
  if (sample) {
    selectedQueryId = sample.query_id;
    const passages = sample.passages.map(p => p.text);
    passageInput.updateOptions(passages);
  }
});

// Handle subset button clicks
subsetButtons.$value.subscribe((subset) => {
  if (selectedQueryId) {
    datasetService.create({ subset, query_id: selectedQueryId });
  } else {
    datasetService.create({ n: 10, subset });
  }
});
```

## Component Mapping

| Nig-Viz (index.js) | Your App (SvelteKit) |
|-------------------|---------------------|
| `queryInput = betterText()` | `InputPanel.svelte` - query textarea |
| `passageInput = betterText()` | `InputPanel.svelte` - passage textarea |
| `submitNIG = button()` | `InputPanel.svelte` - Calculate NIGs button |
| `baselineDropdown = select()` | `InputPanel.svelte` - baseline dropdown |
| `numRepsInput = betterNumber()` | `InputPanel.svelte` - num reps input |
| `subsetButtons` | `InputPanel.svelte` - subset buttons |
| `tableNIGS = nigtable()` | Already created: `tableComponent` |
| `architectureComponent = architecture()` | Already created: `archComponent` |
| `nigHistogram` | Already created: `histogramComponent` |
| `thresholdSlider` | Already created: `thresholdSliderComponent` |
| Dashboard layout | Your IconBar + Splitpanes layout |

## Next Steps

1. **Update InputPanel.svelte** to include:
   - Service instance references (pass as props)
   - Submit handlers that call `nigModel.predict()`
   - Query/passage selection from dataset service

2. **Update +page.svelte** to:
   - Create model instances on mount
   - Subscribe to `$data` streams
   - Pass service instances to panels as props
   - Handle result updates

3. **Create NigsPanel logic** for:
   - Displaying saved snapshots
   - Load/save functionality
   - Snapshot metadata

4. **Wire up ArchitecturePanel** to:
   - Toggle absolute values → `archComponent.absoluteValues$`
   - Toggle node colors → `archComponent.colorNodesEnabled$`

5. **Implement cursor modes** in:
   - PruningPanel → emit pruning selection events
   - ConditionalNigPanel → emit conditional NIG requests

## Testing Checklist

- [ ] Backend running on port 3030
- [ ] Python model.py running and connected
- [ ] Frontend connects to backend (check store.ts)
- [ ] Query samples load from dataset service
- [ ] Calculate NIGs button sends request
- [ ] NIG results update all three views (arch, table, histogram)
- [ ] Selection in table updates architecture view
- [ ] Threshold slider updates visualizations
- [ ] Snapshots save/load correctly

## Common Issues

1. **Components not updating**: Ensure you're subscribing to `$data` stream, not just `$status`
2. **No query options**: Check dataset service is patching successfully
3. **Python not receiving requests**: Verify SocketIO connection in Python logs
4. **Visualizations empty**: Check that result structure matches expected format (subset_b)
