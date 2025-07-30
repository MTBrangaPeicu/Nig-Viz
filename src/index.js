import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable, nigModel, architecture, betterNumber, betterText, pruner, violinplot} from './components';
import { progressBar, slider } from '@marcellejs/gui-widgets';
import { map } from 'rxjs';

const store = core.dataStore('http://localhost:3030');

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

// Use relevant models for progress bars
const progIG = progressBar(igModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));
const progNIG = progressBar(nigModelInstance.$status.pipe(map(x => ({ ...x, message: x.status }))));
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
nigModelInstance.$data.subscribe(doc => {
  if (!doc || !doc.result) {
    return;
  }

  // Store the current NIG result ID for threshold updates
  currentNigId = doc._id;

  if (doc.result.subset_b) {
    const nig = doc.result.subset_b;
    // const error = doc.result.error;
    const layers = Object.keys(nig);

    // Update dropdown options and value
    layerDropdown.$options.next(layers.length > 0 ? layers : ['No layers available']);
    layerDropdown.$value.next(layers.length > 0 ? layers[0] : 'No layers available');

    // Update table for first layer - but don't show data initially, just indicate that NIG data exists
    if (layers.length > 0) {
      tableNIGS.$options.next({
        hasNigData: true, // Flag to indicate NIG data is available
        layer: null, // No specific layer selected yet
        values: null, // No values to show initially
      });
    }

    // Feed subset_b into the architecture component for counting/visualization
    architectureComponent.updateEdges(nig); // Removed error parameter
  }
}); 

//Subscribe to layerDropdown.$value
layerDropdown.$value.subscribe(layer => {
  const doc = nigModelInstance.$data.getValue();
  const nig = doc && doc.result && doc.result.subset_b;
  if (nig && nig[layer]) {
    tableNIGS.$options.next({
      layer,
      type: null, // No layer type for dropdown
      tokenType: null, // No token type for dropdown
      values: nig[layer],
    });
  } else if (nig) {
    tableNIGS.$options.next({ error: 'Invalid layer or no data' });
  }
});

const thresholdSlider = slider({
  values: [0.05], 
  min: 0,
  max: 1,
  step: 0.01,
});
thresholdSlider.title = 'Threshold for NIG Values';

// Subscribe to threshold slider changes
thresholdSlider.$values.subscribe(([threshold]) => {
  architectureComponent.updateThreshold(threshold); // Update threshold in the architecture component
});

// Handle selections from the architecture grid
architectureComponent.$selection.subscribe(({ layer, type, tokenType }) => {
	console.log("Architecture Selection - Layer:", layer, "Type:", type, "Token Type:", tokenType);

	const doc = nigModelInstance.$data.getValue();
	const nig = doc && doc.result && doc.result.subset_b;
	const layerKey = `bert.encoder.layer.${layer}.${type === 'FFN' ? 'intermediate.dense' : 'attention.self.attention_probs'}`; 
	console.log("Constructed Layer Key:", layerKey);

	if (nig && nig[layerKey]) {
    const layerData = nig[layerKey];
		const tokenIndex = ['cls', 'qry', 'sep1', 'doc', 'sep2'].indexOf(tokenType); // Map tokenType to index
		if (tokenIndex !== -1) {
      if (type === 'ATTN' && Array.isArray(layerData) && Array.isArray(layerData[0]) && Array.isArray(layerData[0][0])) {
        // layerData: (12, 5, 5) => attention from tokenIndex to all others
        const values = layerData.map(head => head.map(row => row[tokenIndex])); // shape (12, 5)
        tableNIGS.$options.next({
          hasNigData: true,
          layer: layerKey,
          type,
          tokenType,
          values,
        });
        violinPlotComponent.$options.next({ layer: layerKey, type, tokenType, values: layerData});
      } else if (type === 'FFN' && Array.isArray(layerData) && Array.isArray(layerData[tokenIndex])) {
        // layerData: (5, 1536) => FFN activation per token type
        tableNIGS.$options.next({
          hasNigData: true,
          layer: layerKey,
          type,
          tokenType,
          values: layerData[tokenIndex],
        });
        violinPlotComponent.$options.next({ layer: layerKey, type, tokenType,values: layerData });
      } else {
        console.log("Error: Invalid token type or malformed data structure");
        tableNIGS.$options.next({ 
          hasNigData: true,
          error: 'Invalid token type or data' 
        });
      }
    }
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

// Forward Pass submit
submitForwardPass.$click.subscribe(() => {
  forwardPassModelInstance.predict({
    query: queryInput.$value.getValue(),
    passage: passageInput.$value.getValue(),
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

const prunerComponent = pruner({
  title: 'Pruner',
  options: {
    enabled: false,
    globalThreshold: 0.1,
    pruningRules: [],
    pruningTargets: [],
  },
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
  .use([queryInput, passageInput],[numRepsInput, baselineDropdown], progNIG, [thresholdSlider,submitNIG] ,[architectureComponent, tableNIGS], violinPlotComponent)
  .sidebar( submitForwardPass, forwardPassOutput, prunerComponent);

dash.show();
