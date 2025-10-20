import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable, nigModel, architecture, betterNumber, betterText, pruner, violinplot} from './components';
import { map } from 'rxjs';

const store = core.dataStore('https://marcelle.lisn.upsaclay.fr/nig-viz/api/');

// Create separate models for IG and NIG connecting to Python service
const igModelInstance = nigModel(store, 'predictions');
const nigModelInstance = nigModel(store, 'nig-values'); 

// Inputs and widgets
//const queryInput = widgets.textArea('Enter your query here');
//queryInput.title = 'Query';
//const passageInput = widgets.textArea('Enter your passage here');
//passageInput.title = 'Passage';

const queryInput = betterText('', []);
queryInput.title = 'Query';
queryInput.samples = []; // Initialize samples as an empty array

const passageInput = betterText('', []);
passageInput.title = 'Passage';

// Fetch query samples from the backend
const datasetService = store.service('msmarco-samples');
datasetService.on('patched', (doc) => {
  if (doc.status === 'success' && doc.samples) {
    const queries = doc.samples.map((sample) => sample.query); // Extract 'query' field from samples
    queryInput.updateOptions(queries); // Use updateOptions to populate dropdown options
    queryInput.samples = doc.samples; // Attach samples to queryInput for later use
    console.log('Query options updated:', queries); // Debug log to verify options
  }
});

// Request query samples
datasetService.create({ n: 10 });

let selectedQueryId = null; // Store the selected query ID
let currentNigId = null; // Store the current NIG result ID for threshold updates
let lastNIGRequestInputs = null; // Capture inputs at submit time for snapshot metadata

// Handle query selection
queryInput.$value.subscribe((selectedQuery) => {
  if (!queryInput.samples || queryInput.samples.length === 0) {
    console.error('Query samples are not available.');
    return;
  }

  const selectedSample = queryInput.samples.find((sample) => sample.query === selectedQuery);
  if (selectedSample) {
    selectedQueryId = selectedSample.query_id; // Store the selected query ID
    const passages = selectedSample.passages.map((passage) => passage.text); // Extract passage texts
    passageInput.updateOptions(passages); // Update passageInput options with relevant passages
    console.log('Passage options updated:', passages); // Debug log to verify passages
  } else {
    console.error('Selected query not found in samples.');
    passageInput.updateOptions([]); // Clear passage options if no matching query is found
  }
});

const submitQuery = widgets.button('Submit');
submitQuery.title = 'Token IG';
const submitNIG = widgets.button('Calculate');
submitNIG.title = 'NIG values';
const outputText = widgets.text('Submit a query and passage to see the output');
outputText.title = 'Output';
const outputError = widgets.text('Error');
outputError.title = 'Error';

/* const toggleSplit = widgets.toggle(false);
toggleSplit.title = 'Split into token types';
toggleSplit.$checked.subscribe((x) => {
  toggleSplit.$text.next(x ? 'True' : 'False');
}); */

//const batchSizeInput = widgets.number(10);
//batchSizeInput.title = 'Batch Size';

const numRepsInput = betterNumber(20,10);
numRepsInput.title = 'Number of Repetitions';

const tableNIGS = nigtable();
tableNIGS.title = 'NIG values';

const violinPlotComponent = violinplot();
violinPlotComponent.title = 'NIG Distribution (Violin Plot)';

const architectureComponent = architecture();
architectureComponent.title = 'Architecture Grid';

// ---------------- NIG SNAPSHOT CACHE (Local) ----------------
// Each snapshot stores: id, timestamp, query, passage, data (subset_b)
let nigSnapshots = [];
const NIG_SNAPSHOT_KEY = 'nigSnapshotsV1';

function loadPersistedSnapshots() {
  try {
    const raw = localStorage.getItem(NIG_SNAPSHOT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) nigSnapshots = arr;
    }
  } catch (e) {
    console.warn('[NIG SNAPSHOTS] Failed to load persisted snapshots:', e);
  }
}

function persistSnapshots() {
  try {
    // Keep last 12 snapshots persisted
    localStorage.setItem(NIG_SNAPSHOT_KEY, JSON.stringify(nigSnapshots.slice(-12)));
  } catch (e) {
    console.warn('[NIG SNAPSHOTS] Persist failed:', e);
  }
}

function formatSnapshotLabel(s) {
  const q = (s.query || '').slice(0, 25).replace(/\s+/g,' ');
  const p = (s.passage || '').slice(0, 25).replace(/\s+/g,' ');
  const bl = s.baselineLabel ? s.baselineLabel.split(' ')[0] : 'BL?';
  return `${s.timestamp} | ${bl} | r=${s.numReps} | Q:${q}${q.length===25?'…':''} | P:${p}${p.length===25?'…':''}`;
}

loadPersistedSnapshots();

const nigSnapshotSelect = widgets.select(
  nigSnapshots.length ? nigSnapshots.map(formatSnapshotLabel) : ['No snapshots']
);
nigSnapshotSelect.title = 'Saved NIG Runs';

const loadNigSnapshotBtn = widgets.button('Load Previous');
loadNigSnapshotBtn.title = 'Reload Cached NIG';
const clearNigSnapshotsBtn = widgets.button('Clear');
clearNigSnapshotsBtn.title = 'Clear Snapshots';

function loadNIGSnapshotData(snapshot) {
  if (!snapshot || !snapshot.data) return;
  const nigData = snapshot.data;
  console.log('[SNAPSHOT LOAD] Begin load id=', snapshot.id, 'layers=', Object.keys(nigData).length);

  // Restore query input (ensure option list contains it)
  if (snapshot.query) {
    // If query not present, append to options
    const currentQueries = queryInput.options || []; // betterText custom prop? fallback
    if (!currentQueries || !currentQueries.includes(snapshot.query)) {
      const newList = [...(currentQueries || []), snapshot.query];
      if (queryInput.updateOptions) queryInput.updateOptions(newList);
    }
    if (queryInput.$value) queryInput.$value.next(snapshot.query);
  }

  // Restore passage (passage options are usually set after selecting a query)
  if (snapshot.passage) {
    const currentPassages = passageInput.options || [];
    if (!currentPassages || !currentPassages.includes(snapshot.passage)) {
      const newPassages = [...(currentPassages || []), snapshot.passage];
      if (passageInput.updateOptions) passageInput.updateOptions(newPassages);
    }
    if (passageInput.$value) passageInput.$value.next(snapshot.passage);
  }

  // Restore baseline selection
  if (snapshot.baselineLabel) {
    baselineDropdown.$value.next(snapshot.baselineLabel);
  }

  // Restore repetitions
  if (typeof snapshot.numReps === 'number' && snapshot.numReps > 0) {
    if (numRepsInput.$value) numRepsInput.$value.next(snapshot.numReps);
  }

  // Inject snapshot into model stream (single authoritative source). Mark so we don't re-snapshot it.
  try {
    if (nigModelInstance?.$data?.next) {
      console.log('[SNAPSHOT LOAD] Injecting into model stream');
      nigModelInstance.$data.next({ _id: `snapshot-${snapshot.id}`, __fromSnapshot: true, result: { subset_b: nigData } });
    }
  } catch (e) {
    console.warn('[NIG SNAPSHOTS] Failed to inject snapshot into model instance:', e);
  }

  // If snapshot contains previous selection metadata, re-emit it to trigger normal reactive recomputation
  const sel = snapshot.selection || snapshot.lastSelection; // backward compatibility
  if (sel && sel.layer !== null && sel.type && sel.tokenType) {
    try {
    console.log('[SNAPSHOT LOAD] Re-emitting saved selection', sel);
    architectureComponent.$selection.next(sel);
    } catch (e) {
      console.warn('[NIG SNAPSHOTS] Failed to re-emit selection:', e);
    }
  }
  console.log('[SNAPSHOT LOAD] Completed load of', snapshot.id);
}

loadNigSnapshotBtn.$click.subscribe(() => {
  const label = nigSnapshotSelect.$value.getValue();
  const snap = nigSnapshots.find(s => formatSnapshotLabel(s) === label);
  if (!snap) return;
  console.log('[NIG SNAPSHOTS] Loading snapshot', snap.id);
  loadNIGSnapshotData(snap);
});

clearNigSnapshotsBtn.$click.subscribe(() => {
  nigSnapshots = [];
  persistSnapshots();
  nigSnapshotSelect.$options.next(['No snapshots']);
  nigSnapshotSelect.$value.next('No snapshots');
  console.log('[NIG SNAPSHOTS] Cleared all snapshots');
});

// Auto-apply latest snapshot on load (after widgets exist)
if (nigSnapshots.length) {
  const last = nigSnapshots[nigSnapshots.length - 1];
  const lbl = formatSnapshotLabel(last);
  nigSnapshotSelect.$value.next(lbl);
  // Attempt immediate load
  try {
    loadNIGSnapshotData(last);
    console.log('[NIG SNAPSHOTS] Auto-applied last snapshot', last.id);
  } catch (e) {
    console.warn('[NIG SNAPSHOTS] Auto-apply failed:', e);
  }
}

// Use relevant models for progress bars
const progIG = widgets.progressBar(igModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));
const progNIG = widgets.progressBar(nigModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));
progNIG.title = '';
progIG.title = '';

const layerDropdown = widgets.select(['Loading...']);
layerDropdown.title = 'Select Layer';

const baselineDropdown = widgets.select([
  'Only Padded Tokens',
  'Padded Query and Passage (Special Tokens Preserved)',
  'Padded Query (Special Tokens Preserved)',
]);
baselineDropdown.title = 'Select Baseline';

function getColor(attr) {
  let r, g, b;
  if (attr > 0) {
    g = Math.min(255, 128 + Math.floor(127 * attr));
    b = Math.min(255, 128 - Math.floor(64 * attr));
    r = Math.min(255, 128 - Math.floor(64 * attr));
  } else {
    g = Math.min(255, 128 + Math.floor(64 * attr));
    b = Math.min(255, 128 + Math.floor(64 * attr));
    r = Math.min(255, 127 - Math.floor(128 * attr));
  }
  return `rgb(${r},${g},${b})`;
}

function getBaselineType(selectedBaseline) {
  return selectedBaseline === 'Only Padded Tokens' ? 0
    : selectedBaseline === 'Padded Query and Passage (Special Tokens Preserved)' ? 1
    : selectedBaseline === 'Padded Query (Special Tokens Preserved)' ? 2
    : null;
}

// IG Prediction submit
submitQuery.$click.subscribe(() => {
  igModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
    //batch_size: batchSizeInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    type: 'ig'
  });
});

// NIG Prediction submit
submitNIG.$click.subscribe(() => {
  // Capture inputs at click time to ensure snapshot metadata matches the request
  lastNIGRequestInputs = {
    query: queryInput.$value.getValue() || '',
    passage: passageInput.$value.getValue() || '',
    baselineLabel: baselineDropdown.$value.getValue(),
    numReps: numRepsInput.$value.getValue(),
  };

  nigModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
   //batch_size: batchSizeInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    //split_type: toggleSplit.$checked.getValue(),
    type: 'nig'
  });
});

// Handle IG results
igModelInstance.$data.subscribe(doc => {
  if (!doc || !doc.result) return;
  
  if (doc.result.tokens && doc.result.attributions) {
    const { tokens, attributions, error } = doc.result;
    const html = tokens.map((token, i) => {
      const color = getColor(attributions[i]);
      return `<span style="color:${color}" title="${attributions[i].toFixed(4)}">${token}</span>`;
    }).join(" ");
    outputText.$value.next(`${html}<br><br>Baseline Error: ${error?.toFixed(4) ?? 'N/A'}`);
  }
});

// Handle NIG results
function createSnapshotFromDoc(doc) {
  if (!doc || !doc.result || !doc.result.subset_b) return null;
  const nig = doc.result.subset_b;
  // Prefer captured inputs from submit time to avoid drift
  const meta = lastNIGRequestInputs || {
    query: queryInput.$value.getValue() || '',
    passage: passageInput.$value.getValue() || '',
    baselineLabel: baselineDropdown.$value.getValue(),
    numReps: numRepsInput.$value.getValue(),
  };
  return {
    version: 2,
    id: doc._id,
    timestamp: new Date().toLocaleTimeString(),
    query: meta.query,
    passage: meta.passage,
    baselineLabel: meta.baselineLabel,
    numReps: meta.numReps,
    data: nig,
  };
}

// Single subscription: handles both live computations and injected snapshots
nigModelInstance.$data.subscribe(doc => {
  if (!doc || !doc.result) {
    return;
  }
  if (doc.__fromSnapshot) {
    console.log('[MODEL STREAM] Received injected snapshot doc id=', doc._id);
  } else {
    console.log('[MODEL STREAM] Received fresh computation doc id=', doc._id);
  }

  // Store the current NIG result ID for threshold updates
  currentNigId = doc._id;

  if (!doc.result.subset_b) return;
  const nig = doc.result.subset_b;
  console.log('[MODEL STREAM] subset_b size (layers)=', Object.keys(nig).length);

  // Snapshot only if this is a fresh computation (not an injected snapshot)
  if (!doc.__fromSnapshot) {
    try {
      const snapshot = createSnapshotFromDoc(doc);
      if (snapshot) {
        nigSnapshots.push(snapshot);
        if (nigSnapshots.length > 20) nigSnapshots = nigSnapshots.slice(-20); // Keep memory list manageable (last 20)
        persistSnapshots();
        nigSnapshotSelect.$options.next(nigSnapshots.map(formatSnapshotLabel)); // Refresh select options
        nigSnapshotSelect.$value.next(formatSnapshotLabel(snapshot));
        console.log('[NIG SNAPSHOTS] Saved snapshot; total:', nigSnapshots.length);
      }
    } catch (e) {
      console.warn('[NIG SNAPSHOTS] Failed to save snapshot:', e);
    }
  }

  const layers = Object.keys(nig);
  layerDropdown.$options.next(layers.length ? layers : ['No layers available']); // Update dropdown options and value
  layerDropdown.$value.next(layers.length ? layers[0] : 'No layers available');

  if (layers.length) {
    // Update table for first layer - but don't show data initially, just indicate that NIG data exists
    tableNIGS.$options.next({ hasNigData: true, layer: null, values: null });
  }

  // Feed subset_b into the architecture component for counting/visualization
  architectureComponent.updateEdges(nig); // Removed error parameter
  console.log('[MODEL STREAM] Edges recomputed for doc id=', doc._id);
}); 

//Subscribe to layerDropdown.$value
layerDropdown.$value.subscribe(layer => {
  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.subset_b;
  if (nig && nig[layer]) {
    tableNIGS.$options.next({
      hasNigData: true,
      layer,
      type: null, // No layer type for dropdown
      tokenType: null, // No token type for dropdown
      values: nig[layer],
    });
  } else if (nig) {
    tableNIGS.$options.next({ hasNigData: true, error: 'Invalid layer or no data' });
  }
});

// Log-focused threshold slider Option 1:
// Raw slider value s ∈ [0,1]; s = 0 => threshold = 0 (show all)
// For s > 0: exponent e = -4 + 4*s  (maps to e ∈ [-4,0]) and threshold = 10^e (1e-4 .. 1)
// This compresses unused ultra-small range while keeping intuitive 0..1 control.
const thresholdSlider = widgets.slider({
  values: [0.5],           // midpoint ≈ 10^(-4 + 4*0.5) = 10^-2 = 0.01
  min: 0,
  max: 1,
  step: 0.01,
  formatter: (s) => {
    if (s === 0) return '0';
    const e = -4 + 4 * s;
    const v = Math.pow(10, e);
    if (v === 1) return '1.000';
    if (v >= 0.1) return v.toFixed(3);
    if (v >= 0.01) return v.toFixed(3);
  // For 0.001 <= v < 0.01 use 4 decimals, for 0.0001 <= v < 0.001 use 5 decimals
  if (v >= 0.001) return v.toFixed(4);
  return v.toFixed(5);
  }
});
thresholdSlider.title = 'Threshold for NIG Values';

// Small descriptive text shown under the slider explaining the measurement
const thresholdInfo = widgets.text('Select the fraction of highest-magnitude NIG values to visualize (log-scaled control). 0 = show none, 0.01 ≈ top 1%, 1 = show all (100%).');
thresholdInfo.title = '';

// Subscribe to slider value changes and propagate actual threshold
thresholdSlider.$values.subscribe(([s]) => {
  const threshold = s === 0 ? 0 : Math.pow(10, -4 + 4 * s);
  console.log('[Threshold Slider] raw slider:', s, 'mapped threshold fraction:', threshold);
  architectureComponent.updateThreshold(threshold);
});

// Handle selections from the architecture grid
architectureComponent.$selection.subscribe(sel => {
  // sel: { source, target }
  const { source, target } = sel || {};
  // Clear table if incomplete or empty selection
  if (!source || !target) {
    tableNIGS.$options.next({ ...tableNIGS.$options.getValue(), values: null });
    return;
  }

  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.subset_b;
  if (!nig) return;

  // Determine which underlying layer's data to extract based on pair type
  // Cases:
  // 1. ATTN(source) -> FFN(target same layer): show ATTN src->all tgts (orientation src→tgts)
  // 2. FFN(source) -> ATTN(target next layer, same token): show FFN neuron vector for that token
  // 3. FFN(source) -> ATTN(target same layer): show ATTN tgt -> all srcs (orientation tgt→srcs)
  // 4. FFN L11 -> TOP: show FFN neuron vector for that token (layer 11)

  const pruningCutoffs = architectureComponent.pruningCutoffs$.getValue();
  const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];

  function attnLayerKey(layerIdx) {
    return `bert.encoder.layer.${layerIdx}.attention.self.attention_probs`;
  }
  function ffnLayerKey(layerIdx) {
    return `bert.encoder.layer.${layerIdx}.intermediate.dense`;
  }

  const src = source;
  const tgt = target;
  let layerKey, type, tokenType, values;

  if (src.type === 'ATTN' && tgt.type === 'FFN' && src.layer === tgt.layer) {
    layerKey = attnLayerKey(src.layer);
    type = 'ATTN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey]; // shape (12,5,5) [head][tgt][src]
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) {
      values = layerData.map(head => head.map(row => row[tokenIndex])); // (12,5)
    }
  } else if (src.type === 'FFN' && tgt.type === 'ATTN' && tgt.layer === src.layer + 1 && src.tokenType === tgt.tokenType) {
    layerKey = ffnLayerKey(src.layer);
    type = 'FFN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey]; // shape (5, neurons)
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
  } else if (src.type === 'FFN' && tgt.type === 'ATTN' && tgt.layer === src.layer) {
    // Same-layer reverse attention view (tgt token attends to all src tokens)
    layerKey = attnLayerKey(src.layer);
    type = 'ATTN';
    tokenType = tgt.tokenType; // we take target token as focus for reverse orientation
    const layerData = nig[layerKey];
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) {
      // For each head take the row corresponding to target token (tgtToken -> all src tokens)
      values = layerData.map(head => head[tokenIndex]); // shape (12,5)
    }
  } else if (src.type === 'FFN' && tgt.type === 'TOP' && src.layer === 11) {
    layerKey = ffnLayerKey(src.layer);
    type = 'FFN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey];
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
  } else {
    // Unsupported pair -> clear
    tableNIGS.$options.next({ hasNigData: true, layer: null, type: null, tokenType: null, values: null });
    return;
  }

  if (values === undefined || values === null) {
    tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values: null, pruningCutoffs });
    return;
  }

  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, pruningCutoffs });
  // Violin plot gets the full underlying tensor for its layer (for ATTN give raw head tensor; for FFN give all token rows)
  if (type === 'ATTN') {
    violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: nig[layerKey] });
  } else if (type === 'FFN') {
    violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: nig[layerKey] });
  }
});

// Handle selections from the dropdown
layerDropdown.$value.subscribe(layer => {
	console.log("Dropdown Selection - Layer:", layer);

	const doc = nigModelInstance.$data.getValue();
	const nig = doc && doc.result && doc.result.subset_b;
	if (nig && nig[layer]) {
		tableNIGS.$options.next({
			hasNigData: true,
			layer,
			type: null, // No layer type for dropdown
			tokenType: null, // No token type for dropdown
			values: nig[layer],
		});
	} else if (nig) {
		tableNIGS.$options.next({ 
			hasNigData: true,
			error: 'Invalid layer or no data' 
		});
	}
});

// Create model instance for forward-pass service
const forwardPassModelInstance = nigModel(store, 'forward-pass');

const submitForwardPass = widgets.button('Run Forward Pass');
submitForwardPass.title = 'Forward Pass';
const forwardPassOutput = widgets.text('Results will appear here');
forwardPassOutput.title = 'Forward Pass Output';

const submitPrunedForwardPass = widgets.button('Run Pruned Forward Pass');
submitPrunedForwardPass.title = 'Pruned Forward Pass';
const prunedForwardPassOutput = widgets.text('Results will appear here');
prunedForwardPassOutput.title = 'Pruned Forward Pass Output';

// Forward Pass submit
submitForwardPass.$click.subscribe(() => {
  forwardPassModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
  });
});

// Pruned Forward Pass submit
submitPrunedForwardPass.$click.subscribe(() => {
  // Check if NIG data is available (we'll rely on backend memory)
  const doc = nigModelInstance.$data.getValue();
  console.log("NIG data check:", doc);
  
  if (!doc || !doc.result || !doc.result.subset_b) {
    prunedForwardPassOutput.$value.next('Error: No NIG data available. Please run NIG values calculation first.');
    return;
  }

  // Get current pruner settings
  const prunerOptions = prunerComponent.$options.getValue();
  console.log("Pruner options for request:", prunerOptions);

  // Extract pruning thresholds from pruner component
  let attentionThreshold = 0.0; // Default to no pruning when disabled
  let ffnThreshold = 0.0;

  if (prunerOptions && prunerOptions.enabled) {
    // Use individual thresholds when pruning is enabled
    attentionThreshold = prunerOptions.attentionThreshold || 0.0;
    ffnThreshold = prunerOptions.ffnThreshold || 0.0;

    // Override with specific rules if they exist
    if (prunerOptions.pruningRules && prunerOptions.pruningRules.length > 0) {
      prunerOptions.pruningRules.forEach(rule => {
        if (rule.target === 'attention' && rule.threshold !== undefined) {
          attentionThreshold = rule.threshold;
        } else if (rule.target === 'ffn' && rule.threshold !== undefined) {
          ffnThreshold = rule.threshold;
        }
      });
    }
  }
  // When pruning is disabled (enabled = false), thresholds remain 0.0 (no pruning)

  console.log("Sending pruned forward pass request with thresholds:", {
    attention: attentionThreshold,
    ffn: ffnThreshold
  });
  
  prunedForwardPassModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
    pruning_percentage_attention: attentionThreshold,
    pruning_percentage_ffn: ffnThreshold,
    // NEW: Include pruning rules and targets from the pruner component
    pruning_enabled: prunerOptions ? prunerOptions.enabled : false,
    pruning_rules: prunerOptions ? (prunerOptions.pruningRules || []) : [],
    pruning_targets: prunerOptions ? (prunerOptions.pruningTargets || []) : [],
    // Note: No longer sending nig_data - backend uses raw data from memory
  });
});

// Handle Forward Pass results
forwardPassModelInstance.$data.subscribe(doc => {
  if (!doc || !doc.result) {
    forwardPassOutput.$value.next('No result received.');
    return;
  }

  if (doc.result) {
    const { logits, probabilities, label } = doc.result;
    
    // Extract the actual values (they come as nested arrays)
    const logitValue = Array.isArray(logits) && Array.isArray(logits[0]) ? logits[0][0] : logits;
    const probValue = Array.isArray(probabilities) && Array.isArray(probabilities[0]) ? probabilities[0][0] : probabilities;
    
    // Format probability as percentage
    const confidence = (probValue * 100).toFixed(1);
    
    // Determine relevance description
    const relevance = label === 1 ? 'RELEVANT' : 'NOT RELEVANT';
    
    // For interpretation, use the actual confidence in the prediction
    const interpretationConfidence = label === 1 ? confidence : (100 - parseFloat(confidence)).toFixed(1);
    
    const output = [
      `Classification: ${relevance}`,
      `Confidence: ${interpretationConfidence}%`,
      ``,
      `Raw Logit: ${logitValue.toFixed(4)}`,
      `Probability: ${probValue.toFixed(4)}`,
      `Binary Label: ${label}`
    ].join('<br>');
    
    forwardPassOutput.$value.next(output);
  } else if (doc.status === 'error') {
    forwardPassOutput.$value.next(`ERROR\n=====\n${doc.error}`);
  }
});

// Create pruned forward pass model instance
const prunedForwardPassModelInstance = nigModel(store, 'pruned-forward-pass');

// Handle Pruned Forward Pass results
prunedForwardPassModelInstance.$data.subscribe(doc => {
  console.log("Received pruned forward pass data:", doc);
  
  if (!doc || !doc.result) {
    prunedForwardPassOutput.$value.next('No result received.');
    return;
  }

  if (doc.result) {
    const { logits, probabilities, label } = doc.result;
    
    // Extract the actual values (they come as nested arrays)
    const logitValue = Array.isArray(logits) && Array.isArray(logits[0]) ? logits[0][0] : logits;
    const probValue = Array.isArray(probabilities) && Array.isArray(probabilities[0]) ? probabilities[0][0] : probabilities;
    
    // Format probability as percentage
    const confidence = (probValue * 100).toFixed(1);
    
    // Determine relevance description
    const relevance = label === 1 ? 'RELEVANT' : 'NOT RELEVANT';
    
    // For interpretation, use the actual confidence in the prediction
    const interpretationConfidence = label === 1 ? confidence : (100 - parseFloat(confidence)).toFixed(1);
    
    const output = [
      `[PRUNED MODEL]`,
      `Classification: ${relevance}`,
      `Confidence: ${interpretationConfidence}%`,
      ``,
      `Raw Logit: ${logitValue.toFixed(4)}`,
      `Probability: ${probValue.toFixed(4)}`,
      `Binary Label: ${label}`
    ].join('<br>');
    
    prunedForwardPassOutput.$value.next(output);
  } else if (doc.status === 'error') {
    prunedForwardPassOutput.$value.next(`ERROR\n=====\n${doc.error}`);
  }
});

const prunerComponent = pruner({
  title: 'Pruner',
  options: {
    enabled: false,
    attentionThreshold: 0.0,
    ffnThreshold: 0.0,
    pruningRules: [],
    pruningTargets: [],
  },
});

// Subscribe to pruner component changes for debugging and updating other components
prunerComponent.$options.subscribe((options) => {
  console.log('Pruner options updated:', options);
  
  // Update architecture component with pruning state
  architectureComponent.updatePruningState(options);
  
  // Update NIG table component with pruning state
  tableNIGS.updatePruningState(options);
  
  // Use a small timeout to ensure architecture component has finished calculating cutoffs
  setTimeout(() => {
    // If there's currently a layer selected in the nigtable, refresh it with updated pruning cutoffs
    const currentNigtableOptions = tableNIGS.$options.getValue();
    if (currentNigtableOptions && currentNigtableOptions.layer && currentNigtableOptions.type) {
      // Get the latest pruning cutoffs from architecture component
      const pruningCutoffs = architectureComponent.pruningCutoffs$.getValue();
      
      // Update the nigtable with the same data but new pruning cutoffs
      tableNIGS.$options.next({
        ...currentNigtableOptions,
        pruningCutoffs: pruningCutoffs
      });
      
      console.log('Refreshed nigtable with updated pruning cutoffs:', pruningCutoffs);
    }
  }, 10); // Small delay to let architecture component finish
});

// Dashboard
const dash = dashboard({
  title: 'Integrated Gradients Visualization',
  author: 'ISIR',
});

dash.page('Query Review')
  .use([queryInput, passageInput],[numRepsInput, baselineDropdown, submitQuery], progIG, [outputText]);

//layerDropdown
dash.page('NIG values')
  .use([queryInput, passageInput],[numRepsInput, baselineDropdown], progNIG, [nigSnapshotSelect, clearNigSnapshotsBtn],[loadNigSnapshotBtn, submitNIG] ,[thresholdSlider, thresholdInfo],[architectureComponent, tableNIGS], violinPlotComponent)
  .sidebar( submitForwardPass, forwardPassOutput, submitPrunedForwardPass, prunedForwardPassOutput, prunerComponent);

dash.show();
