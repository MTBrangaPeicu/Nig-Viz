import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable, nigModel, architecture, betterNumber, betterText, pruner, violinplot, subsetButtons as subsetButtonsComponent, nigHistogram as nigHistogramFactory, logThresholdSlider as logThresholdSliderFactory } from './components';
import { map } from 'rxjs';
import { analyzeNig } from './utils/analyze-nig';

const store = core.dataStore('http://localhost:3030');
//const store = core.dataStore('https://marcelle.lisn.upsaclay.fr/nig-viz/api/');

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
passageInput.title = 'Passage (required)';

// Optional second passage
const passageInput2 = betterText('', []);
passageInput2.title = 'Passage 2 (optional)';

// Fetch query samples from the backend
const datasetService = store.service('msmarco-samples');
let samplesReady = false;
// Ensure these are defined before any subscriptions that reference them
let selectedQueryId = null; // Store the selected query ID
let currentNigId = null; // Store the current NIG result ID for threshold updates
let lastNIGRequestInputs = null; // Capture inputs at submit time for snapshot metadata
// Keep a global extent [min,max] of signed IG/NIG values for consistent histogram domain
let globalNigExtent = null;
let globalNigAbsMax = null;
// Keep global extent for activation values as well
let globalAttnActivationExtent = null;
let globalFFNActivationExtent = null;
datasetService.on('patched', (doc) => {
  if (doc.status === 'success' && doc.samples) {
    const queries = doc.samples.map((sample) => sample.query); // Extract 'query' field from samples
    queryInput.updateOptions(queries); // Use updateOptions to populate dropdown options
    queryInput.samples = doc.samples; // Attach samples to queryInput for later use
    console.log('Query options updated:', queries); // Debug log to verify options
    samplesReady = true;
    // Auto-select first query if none is selected yet
    try {
      const current = queryInput.$value && queryInput.$value.getValue ? queryInput.$value.getValue() : '';
      // Pick current if still present; else pick first available
      const chosen = current && queries.includes(current) ? current : (queries[0] || '');
      if (chosen) {
        // Ensure value is set to trigger downstream updates (even if same string)
        queryInput.$value.next(chosen);
        // Refresh passage options immediately from new samples
        const selectedSample = doc.samples.find((s) => s.query === chosen);
        if (selectedSample) {
          const passages = selectedSample.passages.map((p) => p.text);
          passageInput.updateOptions(passages);
          passageInput2.updateOptions(passages);
        } else {
          passageInput.updateOptions([]);
          passageInput2.updateOptions([]);
        }
      }
    } catch {}
  }
  // Update subset button options dynamically if levels are provided
  if (doc.status === 'success' && Array.isArray(doc.levels)) {
    const opts = [...doc.levels.map(l => `Rel=${l}`), 'Random'];
    subsetButtons.setOptions(opts);
  }
  // If backend returns passages for a specific query, update passage suggestions only
  if (doc.status === 'success' && Array.isArray(doc.passages)) {
    const passages = doc.passages.map(p => p.text);
    passageInput.updateOptions(passages);
    passageInput2.updateOptions(passages);
  }
});

// Dynamic subset buttons component
const subsetButtons = subsetButtonsComponent(['Random']);
subsetButtons.title = 'Qrels subsets';
subsetButtons.$value.subscribe((lbl) => {
  if (!lbl) return;
  // If a query is currently selected, request passages for that query only
  const currentQuery = queryInput.$value.getValue();
  // Clear histogram while new subset is loading
  try {
    lastHistogramState = { values: null, type: null };
    nigHistogram.$options.next({ values: null });
  } catch {}
  // Prefer stored selectedQueryId if available
  if (selectedQueryId) {
    datasetService.create({ subset: lbl, query_id: selectedQueryId });
    return;
  }
  // Fallback: try to find query id from current sample cache
  if (currentQuery && queryInput.samples && queryInput.samples.length) {
    const sample = queryInput.samples.find(s => s.query === currentQuery);
    if (sample && sample.query_id) {
      datasetService.create({ subset: lbl, query_id: sample.query_id });
      return;
    }
  }
  // Fallback: request full sample refresh if no current query id
  datasetService.create({ n: 10, subset: lbl });
});

// Initial request
datasetService.create({ n: 10, subset: 'Random' });

// Handle query selection
queryInput.$value.subscribe((selectedQuery) => {
  if (!samplesReady || !queryInput.samples || queryInput.samples.length === 0) {
    // Samples not ready yet; ignore early emissions
    return;
  }

  const selectedSample = queryInput.samples.find((sample) => sample.query === selectedQuery);
  if (selectedSample) {
    selectedQueryId = selectedSample.query_id; // Store the selected query ID
    const passages = selectedSample.passages.map((passage) => passage.text); // Extract passage texts
    passageInput.updateOptions(passages);
    passageInput2.updateOptions(passages);
    console.log('Passage options updated:', passages); // Debug log to verify passages
  } else {
  // Selected query not found (possibly stale); ignore quietly
    passageInput.updateOptions([]);
    passageInput2.updateOptions([]);
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

// Subscribe to table selection requests and update architecture
tableNIGS.selectionRequest$.subscribe((selection) => {
  if (selection && architectureComponent.$selection) {
    console.log('[Index] Updating architecture selection from table:', selection);
    architectureComponent.$selection.next(selection);
  }
});

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

  // Reset architecture selection when loading snapshot
  if (architectureComponent && architectureComponent.$selection) {
    architectureComponent.$selection.next({ source: null, target: null });
    console.log('[SNAPSHOT LOAD] Reset architecture selection');
  }

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
      const resultPayload = { subset_b: nigData };
      if (snapshot.activations) {
        if (snapshot.activations.attention) resultPayload.attn_activations = snapshot.activations.attention;
        if (snapshot.activations.ffn) resultPayload.ffn_activations = snapshot.activations.ffn;
      }
      nigModelInstance.$data.next({ _id: `snapshot-${snapshot.id}`, __fromSnapshot: true, result: resultPayload });
    }
  } catch (e) {
    console.warn('[NIG SNAPSHOTS] Failed to inject snapshot into model instance:', e);
  }

  // Initialize histogram immediately from snapshot (in case other subscriptions haven't reacted yet)
  try {
    const sVals = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
      ? thresholdSlider.$values.getValue()
      : [0.5]);
    const threshold = Math.pow(10, -4 + 4 * sVals[0]); // Logarithmic mapping
    // Compute extent and absMax for the snapshot payload
    const statsFrom = (value) => {
      let min = Infinity, max = -Infinity, maxAbs = 0;
      const visit = (v) => {
        if (Array.isArray(v)) {
          for (const x of v) visit(x);
        } else if (v != null && typeof v === 'object') {
          for (const k in v) visit(v[k]);
        } else if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
          const a = Math.abs(v);
          if (a > maxAbs) maxAbs = a;
        }
      };
      visit(value);
      return { extent: (isFinite(min) && isFinite(max) ? [min, max] : null), maxAbs: (maxAbs || null) };
    };
    const stats = statsFrom(nigData);
    globalNigExtent = stats.extent;
    globalNigAbsMax = stats.maxAbs;
    
    // Update threshold slider with global extent
    if (thresholdSlider && thresholdSlider.$options) {
      thresholdSlider.$options.next({ globalExtent: globalNigExtent });
    }
    
    // Compute global extent for activation values from snapshot
    if (snapshot.activations) {
      if (snapshot.activations.attention) {
        const attnStats = statsFrom(snapshot.activations.attention);
        globalAttnActivationExtent = attnStats.extent;
        console.log('[SNAPSHOT LOAD] Global ATTN activation extent:', globalAttnActivationExtent);
      }
      if (snapshot.activations.ffn) {
        const ffnStats = statsFrom(snapshot.activations.ffn);
        globalFFNActivationExtent = ffnStats.extent;
        console.log('[SNAPSHOT LOAD] Global FFN activation extent:', globalFFNActivationExtent);
      }
    }
    
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    lastHistogramState = { values: nigData, type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  } catch (e) {
    console.warn('[SNAPSHOT LOAD] Failed to initialize histogram from snapshot:', e);
  }

  // Analyze snapshot distribution
  try {
    const stats = analyzeNig(nigData);
    console.groupCollapsed('[NIG ANALYZE] Snapshot distribution summary');
    console.table({
      n: stats.n,
      min: stats.min,
      q25: stats.quantiles?.q25,
      median: stats.quantiles?.q50,
      q75: stats.quantiles?.q75,
      max: stats.max,
      mean: stats.mean,
      std: stats.std,
      skew: stats.skew,
      kurt: stats.kurt,
      pPos: stats.proportions?.pPos,
      pNeg: stats.proportions?.pNeg,
      pZero: stats.proportions?.pZero,
      fdBins: stats.fd?.bins,
    });
    console.log('Visualization hints:', stats.recommendation);
    console.groupEnd();
  } catch (e) {
    console.warn('[NIG ANALYZE] Failed to analyze snapshot:', e);
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
    passage: passageInput.$value.getValue() + (passageInput2.$value.getValue() ? (' \n\n' + passageInput2.$value.getValue()) : ''),
    //batch_size: batchSizeInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    type: 'ig'
  });
});

// NIG Prediction submit
submitNIG.$click.subscribe(() => {
  // Reset architecture selection when calculating new NIGs
  if (architectureComponent && architectureComponent.$selection) {
    architectureComponent.$selection.next({ source: null, target: null });
    console.log('[Calculate NIGs] Reset architecture selection');
  }
  
  // Capture inputs at click time to ensure snapshot metadata matches the request
  lastNIGRequestInputs = {
    query: queryInput.$value.getValue() || '',
    passage: passageInput.$value.getValue() || '',
    baselineLabel: baselineDropdown.$value.getValue(),
    numReps: numRepsInput.$value.getValue(),
  };

  nigModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue() + (passageInput2.$value.getValue() ? (' \n\n' + passageInput2.$value.getValue()) : ''),
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
  // Capture activations if available under various backend keys
  const r = doc.result;
  const attnActs = r.attn_activations || r.activations_attn || r.attention_probs || null;
  const ffnActs = r.ffn_activations || r.activations_ffn || r.activations || null;
  return {
    version: 2,
    id: doc._id,
    timestamp: new Date().toLocaleTimeString(),
    query: meta.query,
    passage: meta.passage,
    baselineLabel: meta.baselineLabel,
    numReps: meta.numReps,
    data: nig,
    activations: { attention: attnActs, ffn: ffnActs },
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

  // Compute global extent once per result
  try {
    const computeExtent = (value) => {
      let min = Infinity, max = -Infinity;
      let maxAbs = 0;
      const visit = (v) => {
        if (Array.isArray(v)) {
          for (const x of v) visit(x);
        } else if (v != null && typeof v === 'object') {
          for (const k in v) visit(v[k]);
        } else if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
          const a = Math.abs(v);
          if (a > maxAbs) maxAbs = a;
        }
      };
      visit(value);
      const extent = isFinite(min) && isFinite(max) ? [min, max] : null;
      return { extent, maxAbs: maxAbs || null };
    };
    const stats = computeExtent(nig);
    globalNigExtent = stats.extent;
    globalNigAbsMax = stats.maxAbs;
    console.log('[MODEL STREAM] Global NIG extent:', globalNigExtent, 'absMax:', globalNigAbsMax);
    
    // Update threshold slider with global extent
    if (thresholdSlider && thresholdSlider.$options) {
      thresholdSlider.$options.next({ globalExtent: globalNigExtent });
    }
    
    // Compute global extent for activation values
    const r = doc.result;
    const attnActs = r.attn_activations || r.activations_attn || r.attention_probs || null;
    const ffnActs = r.ffn_activations || r.activations_ffn || r.activations || null;
    if (attnActs) {
      const attnStats = computeExtent(attnActs);
      globalAttnActivationExtent = attnStats.extent;
      console.log('[MODEL STREAM] Global ATTN activation extent:', globalAttnActivationExtent);
    }
    if (ffnActs) {
      const ffnStats = computeExtent(ffnActs);
      globalFFNActivationExtent = ffnStats.extent;
      console.log('[MODEL STREAM] Global FFN activation extent:', globalFFNActivationExtent);
    }
  } catch (e) {
    console.warn('[NIG] Failed to compute extent:', e);
  }

  // Analyze live computation distribution
  try {
    const stats = analyzeNig(nig);
    console.groupCollapsed('[NIG ANALYZE] Live distribution summary');
    console.table({
      n: stats.n,
      min: stats.min,
      q25: stats.quantiles?.q25,
      median: stats.quantiles?.q50,
      q75: stats.quantiles?.q75,
      max: stats.max,
      mean: stats.mean,
      std: stats.std,
      skew: stats.skew,
      kurt: stats.kurt,
      pPos: stats.proportions?.pPos,
      pNeg: stats.proportions?.pNeg,
      pZero: stats.proportions?.pZero,
      fdBins: stats.fd?.bins,
    });
    console.log('Visualization hints:', stats.recommendation);
    console.groupEnd();
  } catch (e) {
    console.warn('[NIG ANALYZE] Failed to analyze live data:', e);
  }

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
    tableNIGS.$options.next({ hasNigData: true, layer: null, values: null, summary: 'Select a layer/token above to see details', globalNigExtent });
  // Push full distribution to histogram
  const s = thresholdSlider.$value.getValue ? thresholdSlider.$value.getValue() : 0.5;
  const threshold = Math.pow(10, -4 + 4 * s); // Logarithmic mapping
  const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
  lastHistogramState = { values: nig, type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
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
  summary: `Layer ${layer}`,
      globalNigExtent
    });
  const sv = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
    ? thresholdSlider.$values.getValue()
    : [0.5]);
  const threshold = Math.pow(10, -4 + 4 * sv[0]); // Logarithmic mapping
  const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
  lastHistogramState = { values: nig[layer], type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  } else if (nig) {
    tableNIGS.$options.next({ hasNigData: true, error: 'Invalid layer or no data', globalNigExtent });
  }
});

// Toggle for absolute values mode
const absoluteValuesToggle = widgets.toggle(true);
absoluteValuesToggle.title = 'Use Absolute Values';
absoluteValuesToggle.$checked.subscribe((checked) => {
  absoluteValuesToggle.$text.next(checked ? 'Enabled' : 'Disabled');
  console.log('[Absolute Values] Mode:', checked ? 'Absolute' : 'Signed');
  
  // Reset architecture selection when toggling absolute values
  if (architectureComponent && architectureComponent.$selection) {
    architectureComponent.$selection.next({ source: null, target: null });
    console.log('[Absolute Values] Reset architecture selection');
  }
  
  // Update architecture component's absolute values stream and recompute edges
  if (architectureComponent && architectureComponent.absoluteValues$) {
    architectureComponent.absoluteValues$.next(checked);
    // Trigger recomputation of edges with new absolute values mode
    architectureComponent.computeEdgesFromSubsetB();
  }
  
  // Update table component's absolute values stream
  if (tableNIGS && tableNIGS.absoluteValues$) {
    tableNIGS.absoluteValues$.next(checked);
  }

  // Update histogram with new absolute values mode
  const currentGlobalCutoff = architectureComponent.globalCutoff$.getValue();
  const s = thresholdSlider.$value.getValue ? thresholdSlider.$value.getValue() : 0.5;
  const threshold = Math.pow(10, -4 + 4 * s); // Logarithmic mapping
  nigHistogram.$options.next({
    ...lastHistogramState,
    threshold,
    scale: 'symlog',
    extent: globalNigExtent,
    absMax: globalNigAbsMax,
    globalCutoff: currentGlobalCutoff,
    useAbsoluteValues: checked
  });
});

// Toggle for architecture node colors
const architectureColorsToggle = widgets.toggle(false);
architectureColorsToggle.title = 'Architecture Node Colors';
architectureColorsToggle.$checked.subscribe((checked) => {
  architectureColorsToggle.$text.next(checked ? 'Enabled' : 'Disabled');
  console.log('[Architecture Colors] Mode:', checked ? 'Enabled' : 'Disabled');
  
  // Update architecture component's color mode stream
  if (architectureComponent && architectureComponent.colorNodesEnabled$) {
    architectureComponent.colorNodesEnabled$.next(checked);
    // Trigger node color update with current NIG data
    const doc = nigModelInstance.$data.getValue();
    const nig = doc && doc.result && doc.result.subset_b;
    if (nig) {
      architectureComponent.updateNodeColors(nig);
    }
  }
});

// Threshold slider with logarithmic mapping:
// Raw slider value s ∈ [0,1] maps to threshold:
// s = 0 → threshold = 0 (0% - show nothing, cutoff = max value)
// s > 0 → threshold = 10^(-4 + 4*s) (logarithmic: 0.01% to 100%)
//   s = 0.01 → ~0.01%, s = 0.5 → ~1%, s = 1 → 100%
// Labels show percentages for intuitive UX, but mapping is logarithmic for precision
const thresholdSlider = logThresholdSliderFactory(0.5);
thresholdSlider.title = 'Threshold for NIG Values';

// Small descriptive text shown under the slider explaining the measurement
const thresholdInfo = widgets.text('Select the percentage of highest-magnitude NIG values to visualize. 0% shows nothing, 100% shows all values.');
thresholdInfo.title = '';

// Histogram (log-x) under the threshold slider, and static log tick labels
const nigHistogram = nigHistogramFactory();
nigHistogram.title = '';

// Keep last histogram payload to refresh on threshold change
let lastHistogramState = { values: null, type: null };

// Histogram scale fixed to symlog

// Wire up the reactive globalCutoff stream to components (single source of truth)
architectureComponent.globalCutoff$.subscribe((cutoff) => {
  nigHistogram.$globalCutoff.next(cutoff);
  tableNIGS.$globalCutoff.next(cutoff);
});

// Subscribe to slider value changes and propagate actual threshold
thresholdSlider.$value.subscribe((s) => {
  // Special case: s = 0 means show nothing (0%)
  // Otherwise: map logarithmically s ∈ (0,1] → threshold = 10^(-4 + 4*s) ∈ [0.0001, 1]
  const threshold = s === 0 ? 0 : Math.pow(10, -4 + 4 * s);
  console.log('[Threshold Slider] slider:', s, '=> threshold:', threshold, '(show top', s === 0 ? '0%' : (threshold * 100).toFixed(4) + '%', 'of values)');
  architectureComponent.updateThreshold(threshold);
  // Histogram cutoff will automatically update via globalCutoff$ stream
  if (lastHistogramState.values) {
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  }
});

// Bootstrap: if model already has NIG data (e.g., snapshot auto-loaded before histogram existed),
// initialize the histogram now to mirror the architecture update behavior.
try {
  const bootstrapDoc = nigModelInstance.$data.getValue && nigModelInstance.$data.getValue();
  const bootstrapNig = bootstrapDoc && bootstrapDoc.result && bootstrapDoc.result.subset_b;
  if (bootstrapNig) {
    const s0 = thresholdSlider.$value.getValue ? thresholdSlider.$value.getValue() : 0.5;
    const thr0 = Math.pow(10, -4 + 4 * s0); // Logarithmic mapping
    // Compute extent from bootstrap data
    const computeExtent = (value) => {
      let min = Infinity, max = -Infinity, maxAbs = 0;
      const visit = (v) => {
        if (Array.isArray(v)) {
          for (const x of v) visit(x);
        } else if (v != null && typeof v === 'object') {
          for (const k in v) visit(v[k]);
        } else if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
          const a = Math.abs(v);
          if (a > maxAbs) maxAbs = a;
        }
      };
      visit(value);
      return { extent: (isFinite(min) && isFinite(max) ? [min, max] : null), maxAbs: (maxAbs || null) };
    };
    const stats0 = computeExtent(bootstrapNig);
    globalNigExtent = stats0.extent;
    globalNigAbsMax = stats0.maxAbs;
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    lastHistogramState = { values: bootstrapNig, type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold: thr0, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  }
} catch {}

// Keep histogram synced with table only when there is no active selection context
tableNIGS.$options.subscribe((opts) => {
  if (!opts) return;
  // If a selection-driven table is active (ATTN/FFN), don't override histogram here
  if (opts.type) return;
  const doc = nigModelInstance.$data.getValue();
  const allNig = doc && doc.result && doc.result.subset_b;
  const s = thresholdSlider.$value.getValue ? thresholdSlider.$value.getValue() : 0.5;
  const threshold = Math.pow(10, -4 + 4 * s); // Logarithmic mapping
  const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
  if (allNig) {
    lastHistogramState = { values: allNig, type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  } else {
    lastHistogramState = { values: null, type: null };
    nigHistogram.$options.next({ values: null });
  }
});

// Handle selections from the architecture grid
architectureComponent.$selection.subscribe(sel => {
  // sel: { source, target }
  const { source, target } = sel || {};
  // Clear table if incomplete or empty selection
  if (!source || !target) {
    // Clear table to a non-selection state
    tableNIGS.$options.next({ hasNigData: true, layer: null, type: null, tokenType: null, values: null, summary: 'Select a layer/token above to see details', globalNigExtent });
    // Reset histogram/ECDF to total distribution
    const doc0 = nigModelInstance.$data.getValue();
    const allNig0 = doc0 && doc0.result && doc0.result.subset_b;
    const s0 = thresholdSlider.$value.getValue ? thresholdSlider.$value.getValue() : 0.5;
    const thr0 = Math.pow(10, -4 + 4 * s0); // Logarithmic mapping
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    if (allNig0) {
      lastHistogramState = { values: allNig0, type: null };
      nigHistogram.$options.next({ ...lastHistogramState, threshold: thr0, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
    } else {
      lastHistogramState = { values: null, type: null };
      nigHistogram.$options.next({ values: null });
    }
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
  let activations = null; // optional FFN activations row

  function formatLayerTitle(layerKey, type, aToken, bToken, orientation) {
    // Derive Lx from layerKey
    let L = '?';
    try {
      const m = String(layerKey || '').match(/layer\.(\d+)/);
      if (m) L = Number(m[1]);
    } catch {}
    const T = type || (String(layerKey || '').includes('attention') ? 'ATTN' : 'FFN');
    if (T === 'ATTN') {
      const a = aToken || '?';
      const b = bToken || '?';
      const map = orientation === 'tgtsToSrcs' ? `${b} → ${a}` : `${a} → ${b}`;
      return `L${L} ${T} table ${map}`;
    }
    // FFN: single token focus
    return `L${L} ${T} table ${aToken || ''}`.trim();
  }

  if (src.type === 'ATTN' && tgt.type === 'FFN' && src.layer === tgt.layer) {
    layerKey = attnLayerKey(src.layer);
    type = 'ATTN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey]; // shape (12,5,5) [head][tgt][src]
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) {
      // srcToTgts: fix source row, list across target columns
      // Need to extract src token's row across all targets
      // layerData[head][tgt][src] so we map over tgt for fixed src
      values = layerData.map(head => head.map(row => row[tokenIndex])); // (12,5)
    }
    // Optional ATTN activations
    try {
      const result = nigModelInstance.$data.getValue()?.result;
      console.log('[UI] result keys:', Object.keys(result||{}));
      const candidates = [result?.attn_activations, result?.activations_attn, result?.attention, result?.attention_probs];
      const srcMap = candidates.find(x => x && x[layerKey]);
      if (srcMap) {
        const raw = srcMap[layerKey]; // expect (12,5,5)
        if (Array.isArray(raw)) {
          var attnActivations = raw.map(head => head[tokenIndex]); // (12,5)
        }
      }
    } catch {}
  tableNIGS.title = formatLayerTitle(layerKey, type, tokenType, tgt.tokenType, 'srcToTgts');
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, attnActivations, pruningCutoffs, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, orientation: 'srcToTgts', sortTokenType: tgt.tokenType, summary: formatLayerTitle(layerKey, type, tokenType, tgt.tokenType, 'srcToTgts') });
    // Histogram shows distribution of all NIG values in the selected layer
    const sVals = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
      ? thresholdSlider.$values.getValue()
      : [0.5]);
    const threshold = Math.pow(10, -4 + 4 * sVals[0]); // Logarithmic mapping
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    lastHistogramState = { values: nig[layerKey], type: null };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
    if (type === 'ATTN') violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: nig[layerKey] });
    return;
  } else if (src.type === 'FFN' && tgt.type === 'ATTN' && tgt.layer === src.layer + 1 && src.tokenType === tgt.tokenType) {
    layerKey = ffnLayerKey(src.layer);
    type = 'FFN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey]; // shape (5, neurons)
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
    // Try to fetch activations for FFN if backend provided them (optional)
  try {
      const result = nigModelInstance.$data.getValue()?.result;
      const candidates = [result?.ffn_activations, result?.activations_ffn, result?.activations];
      const srcMap = candidates.find(x => x && x[layerKey]);
      if (srcMap) {
        const row = srcMap[layerKey][tokenIndex];
        if (Array.isArray(row)) activations = row;
      }
    } catch {}
  tableNIGS.title = formatLayerTitle(layerKey, type, tokenType);
  const sVals = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
    ? thresholdSlider.$values.getValue()
    : [0.5]);
  const threshold = Math.pow(10, -4 + 4 * sVals[0]); // Logarithmic mapping
  const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
  lastHistogramState = { values, type: 'FFN_SUBSET' };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, activations, pruningCutoffs, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, summary: formatLayerTitle(layerKey, type, tokenType) });
  } else if (src.type === 'FFN' && tgt.type === 'ATTN' && tgt.layer === src.layer) {
    // Same-layer: Square → Circle - show all sources to the square's target
    layerKey = attnLayerKey(src.layer);
    type = 'ATTN';
    tokenType = src.tokenType; // The square's token (this will be the target in the attention)
    const layerData = nig[layerKey];
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) {
      // tgtsToSrcs: show all sources → fixed target (square's token)
      // layerData[head][tgt][src] => pick row where tgt=square's token
      values = layerData.map(head => head[tokenIndex]); // (12,5) - row for target=square
    }
    // Optional ATTN activations for reverse orientation
    try {
      const result = nigModelInstance.$data.getValue()?.result;
      const candidates = [result?.attn_activations, result?.activations_attn, result?.attention, result?.activations];
      const srcMap = candidates.find(x => x && x[layerKey]);
      if (srcMap) {
        const raw = srcMap[layerKey]; // (12,5,5)
        if (Array.isArray(raw)) {
          var attnActivations = raw.map(head => head[tokenIndex]); // (12,5) - row for target=square
        }
      }
    } catch {}
  tableNIGS.title = formatLayerTitle(layerKey, type, tokenType, tgt.tokenType, 'tgtsToSrcs');
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, attnActivations, pruningCutoffs, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, orientation: 'tgtsToSrcs', sortTokenType: tgt.tokenType, summary: formatLayerTitle(layerKey, type, tokenType, tgt.tokenType, 'tgtsToSrcs') });
    const sVals = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
      ? thresholdSlider.$values.getValue()
      : [0.5]);
    const threshold = Math.pow(10, -4 + 4 * sVals[0]); // Logarithmic mapping
    const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
    lastHistogramState = { values: nig[layerKey], type: null };
    nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
    if (type === 'ATTN') violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: nig[layerKey] });
    return;
  } else if (src.type === 'FFN' && tgt.type === 'TOP' && src.layer === 11) {
    layerKey = ffnLayerKey(src.layer);
    type = 'FFN';
    tokenType = src.tokenType;
    const layerData = nig[layerKey];
    const tokenIndex = tokenTypes.indexOf(tokenType);
    if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
    // Optional activations for FFN
    try {
      const result = nigModelInstance.$data.getValue()?.result;
      const candidates = [result?.ffn_activations, result?.activations_ffn, result?.activations];
      const srcMap = candidates.find(x => x && x[layerKey]);
      if (srcMap) {
        const row = srcMap[layerKey][tokenIndex];
        if (Array.isArray(row)) activations = row;
      }
    } catch {}
  tableNIGS.title = formatLayerTitle(layerKey, type, tokenType);
  const sVals = (thresholdSlider && thresholdSlider.$values && typeof thresholdSlider.$values.getValue === 'function'
    ? thresholdSlider.$values.getValue()
    : [0.5]);
  const threshold = Math.pow(10, -4 + 4 * sVals[0]); // Logarithmic mapping
  const useAbsoluteValues = absoluteValuesToggle.$checked.getValue ? absoluteValuesToggle.$checked.getValue() : true;
  lastHistogramState = { values, type: 'FFN_SUBSET' };
  nigHistogram.$options.next({ ...lastHistogramState, threshold, scale: 'symlog', extent: globalNigExtent, absMax: globalNigAbsMax, useAbsoluteValues });
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, activations, pruningCutoffs, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, summary: formatLayerTitle(layerKey, type, tokenType) });
  } else {
    // Unsupported pair -> clear
    tableNIGS.title = 'NIG values';
    tableNIGS.$options.next({ hasNigData: true, layer: null, type: null, tokenType: null, values: null, summary: undefined, globalNigExtent });
    return;
  }

  if (values === undefined || values === null) {
  tableNIGS.title = 'NIG values';
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values: null, pruningCutoffs, globalNigExtent, summary: formatLayerTitle(layerKey, type, tokenType) });
    return;
  }

  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type, tokenType, values, activations, attnActivations, pruningCutoffs, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, summary: formatLayerTitle(layerKey, type, tokenType) });
  // Violin plot gets the full underlying tensor for its layer (for ATTN give raw head tensor; for FFN give all token rows)
  if (type === 'FFN') {
    violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: nig[layerKey] });
  }
});

// New: handle clicks on ATTN layer labels to show token-type by token-type heatmap in the NIG table
architectureComponent.labelClick$.subscribe((evt) => {
  if (!evt) return;
  const { layer, type } = evt;
  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.subset_b;
  if (!nig) return;
  if (type === 'ATTN') {
    const layerKey = `bert.encoder.layer.${layer}.attention.self.attention_probs`;
    const attn = nig[layerKey]; // expect [12,5,5]
    if (Array.isArray(attn)) {
      // DEBUG: Examine directional mapping for a few pairs (cls->qry vs qry->cls)
      try {
        const TOKENS = ['cls','qry','sep1','doc','sep2'];
        const tokenIndex = t => TOKENS.indexOf(t);
        const agg = Array.from({length:5}, () => Array(5).fill(0)); // [src][tgt]
        for (let h=0; h<attn.length; h++) {
          for (let tgt=0; tgt<5; tgt++) {
            for (let src=0; src<5; src++) {
              const v = attn[h]?.[tgt]?.[src];
              if (typeof v === 'number') agg[src][tgt] += v;
            }
          }
        }
        const cls_qry = agg[tokenIndex('cls')][tokenIndex('qry')];
        const qry_cls = agg[tokenIndex('qry')][tokenIndex('cls')];
        console.log('[DEBUG ATTN_LAYER_HEATMAP] Aggregated matrix [src][tgt] sample:', {
          'cls->qry': cls_qry,
          'qry->cls': qry_cls,
          row_cls: agg[tokenIndex('cls')],
          row_qry: agg[tokenIndex('qry')]
        });
      } catch (e) { console.warn('Debug aggregation failed', e); }
  tableNIGS.title = `L${layer} ATTN token↔token heatmap (tgt→src view)`;
  tableNIGS.$options.next({ hasNigData: true, layer: layerKey, type: 'ATTN_LAYER_HEATMAP', values: attn, globalNigExtent, globalAttnActivationExtent, globalFFNActivationExtent, orientation: 'tgtsToSrcs', summary: `Layer L${layer} ATTN token-by-token (tgt→src)` });
    }
  } else if (type === 'FFN') {
    // Optional: could show per-token aggregation overview; for now keep existing selection-driven behavior
    // No action on FFN label click
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
			globalNigExtent
		});
	} else if (nig) {
		tableNIGS.$options.next({ 
			hasNigData: true,
			error: 'Invalid layer or no data',
			globalNigExtent
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
    // Include pruning rules and targets from the pruner component
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
        pruningCutoffs: pruningCutoffs,
        globalNigExtent
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
  .use([
    queryInput,
    passageInput,
    passageInput2
  ],
  subsetButtons,
  [numRepsInput, baselineDropdown, submitQuery], progIG, [outputText]);

//layerDropdown
dash.page('NIG values')
  .use(
  [queryInput, subsetButtons],
  [passageInput,passageInput2],
  [numRepsInput, baselineDropdown, submitNIG], progNIG, [nigSnapshotSelect, clearNigSnapshotsBtn,loadNigSnapshotBtn] ,
  thresholdSlider,
  [absoluteValuesToggle, architectureColorsToggle, thresholdInfo],
  nigHistogram,
  [architectureComponent, tableNIGS], violinPlotComponent)
  .sidebar( submitForwardPass, forwardPassOutput, submitPrunedForwardPass, prunedForwardPassOutput, prunerComponent);

dash.show();
