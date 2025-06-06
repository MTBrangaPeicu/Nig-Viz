import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable, nigModel, architecture} from './components';
import { progressBar } from '@marcellejs/gui-widgets';
import { map } from 'rxjs';

const store = core.dataStore('http://localhost:3030');

// Create separate models for IG and NIG connecting to Python service
const igModelInstance = nigModel(store, 'predictions');
const nigModelInstance = nigModel(store, 'nig-values'); 

// Inputs and widgets
const queryInput = widgets.textArea('Enter your query here');
queryInput.title = 'Query';
const passageInput = widgets.textArea('Enter your passage here');
passageInput.title = 'Passage';
const submitQuery = widgets.button('Submit');
submitQuery.title = 'Token IG';
const submitNIG = widgets.button('Calculate');
submitNIG.title = 'NIG values';
const outputText = widgets.text('Submit a query and passage to see the output');
outputText.title = 'Output';
const outputError = widgets.text('Error');
outputError.title = 'Error';

const toggleSplit = widgets.toggle(false);
toggleSplit.title = 'Split into token types';
toggleSplit.$checked.subscribe((x) => {
  toggleSplit.$text.next(x ? 'True' : 'False');
});

const batchSizeInput = widgets.number(10);
batchSizeInput.title = 'Batch Size';

const numRepsInput = widgets.number(20);
numRepsInput.title = 'Number of Repetitions';

const tableNIGS = nigtable();
tableNIGS.title = 'NIG values';

// Use relevant models for progress bars
const progIG = progressBar(igModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));
const progNIG = progressBar(nigModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));

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
    batch_size: batchSizeInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    type: 'ig'
  });
});

// NIG Prediction submit
submitNIG.$click.subscribe(() => {
  nigModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
    batch_size: batchSizeInput.$value.getValue(),
    num_reps: numRepsInput.$value.getValue(),
    baseline_type: getBaselineType(baselineDropdown.$value.getValue()),
    split_type: toggleSplit.$checked.getValue(),
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
nigModelInstance.$data.subscribe(doc => {
  if (!doc || !doc.result) return;

  if (doc.result.nig) {
    const nig = doc.result.nig;
    const layers = Object.keys(nig);
    
    // Always update dropdown options and value
    layerDropdown.$options.next(layers.length > 0 ? layers : ['No layers available']);
    layerDropdown.$value.next(layers.length > 0 ? layers[0] : 'No layers available');

    // Update table for first layer
    if (layers.length > 0) {
      tableNIGS.$options.next({
        layer: layers[0],
        values: nig[layers[0]]
      });
    }
  }
});

//Subscribe to layerDropdown.$value
layerDropdown.$value.subscribe(layer => {
  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.nig;
  if (nig && nig[layer]) {
    tableNIGS.$options.next({
      layer,
      values: nig[layer],
    });
  } else if (nig) {
    tableNIGS.$options.next({ error: 'Invalid layer or no data' });
  }
});

const architectureComponent = architecture();
architectureComponent.title = 'Architecture Grid';

architectureComponent.$selection.subscribe(({ layer, tokenType }) => {
  console.log("Button Clicked - Layer:", layer, "Token Type:", tokenType);

  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.nig;
  const layerKey = `bert.encoder.layer.${layer}.intermediate.dense`; // Correct layer key format
  console.log("Constructed Layer Key:", layerKey);

  if (nig && nig[layerKey]) {
    const tokenIndex = ['cls', 'qry', 'sep1', 'doc', 'sep2'].indexOf(tokenType); // Map tokenType to index
    if (tokenIndex !== -1 && Array.isArray(nig[layerKey])) {
      console.log("Subset Array:", nig[layerKey][tokenIndex]);
      tableNIGS.$options.next({
        layer: layerKey,
        tokenType,
        values: nig[layerKey][tokenIndex], // Pass the subset array to the nigtable
      });
    } else {
      console.log("Error: Invalid token type or no data available");
      tableNIGS.$options.next({ error: 'Invalid token type or no data available' });
    }
  } else {
    console.log("Error: Invalid layer or no data available");
    tableNIGS.$options.next({ error: 'Invalid layer or no data available' });
  }
});

// Dashboard
const dash = dashboard({
  title: 'Integrated Gradients Visualization',
  author: 'ISIR',
});

dash.page('Query Review')
  .sidebar( queryInput, passageInput)
  .use([batchSizeInput, numRepsInput, baselineDropdown, submitQuery], progIG, [outputText]);

dash.page('NIG values')
  .sidebar(queryInput, passageInput, batchSizeInput, numRepsInput, baselineDropdown, toggleSplit, submitNIG)
  .use(layerDropdown, architectureComponent, progNIG, [tableNIGS]);

dash.show();
