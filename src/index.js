import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable, progressbar } from './components';

// Side Constant panel
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
    if (x) {
        toggleSplit.$text.next('True');
    } else {
        toggleSplit.$text.next('False');
    }
});

// Add number inputs for batch size and number of repetitions
const batchSizeInput = widgets.number(10); // Default value: 10
batchSizeInput.title = 'Batch Size';

const numRepsInput = widgets.number(20); // Default value: 20
numRepsInput.title = 'Number of Repetitions';

// NIG explroation
const tableNIGS = nigtable();
tableNIGS.title = 'NIG values';

// Progress bar for server response
const progress = progressbar();

// Keep a reference to the current progress WebSocket
let progressWS = null;
let pendingOpenProgressWS = false;

// Dropdown for selecting a layer
const layerDropdown = widgets.select(['Loading...']); 
layerDropdown.title = 'Select Layer';

// Dropdown for selecting a baseline
const baselineDropdown = widgets.select([
    'Only Padded Tokens',
    'Padded Query and Passage (Special Tokens Preserved)',
    'Padded Query (Special Tokens Preserved)',
]);
baselineDropdown.title = 'Select Baseline';

// Ensure options are updated before rendering
layerDropdown.$value.subscribe(selectedLayer => {
    if (!layerDropdown.options || layerDropdown.options.length === 0) {
        console.warn('Layer dropdown options are not yet populated.');
    }
});

// Set up the dashboard with the components
const dash = dashboard({
  title: 'Integrated Gradients Visualization',
  author: 'ISIR',
});

dash.page('Query Review')
    .sidebar(queryInput, passageInput) 
    .use([batchSizeInput, numRepsInput, baselineDropdown, submitQuery], progress, [outputText]);

dash.page('NIG values')
    .sidebar(queryInput, passageInput, batchSizeInput, numRepsInput, baselineDropdown, submitNIG) 
    .use([layerDropdown,toggleSplit], [tableNIGS]);

// Function to get color based on IG value
function getColor(attr) {
    let r, g, b;
    if (attr > 0) {
        g = Math.min(255, Math.max(0, 128 + Math.floor(127 * attr)));
        b = Math.min(255, Math.max(0, 128 - Math.floor(64 * attr)));
        r = Math.min(255, Math.max(0, 128 - Math.floor(64 * attr)));
    } else {
        g = Math.min(255, Math.max(0, 128 + Math.floor(64 * attr)));
        b = Math.min(255, Math.max(0, 128 + Math.floor(64 * attr)));
        r = Math.min(255, Math.max(0, 127 - Math.floor(128 * attr)));
    }
    return `rgb(${r},${g},${b})`;
}

// Function to map baseline selection to corresponding index
function getBaselineType(selectedBaseline) {
    return selectedBaseline === 'Only Padded Tokens' ? 0 :
           selectedBaseline === 'Padded Query and Passage (Special Tokens Preserved)' ? 1 :
           selectedBaseline === 'Padded Query (Special Tokens Preserved)' ? 2 : null;
}

// Handle the submit button click
submitQuery.$click.subscribe(() => {
    const query = queryInput.$value.getValue();
    const passage = passageInput.$value.getValue();
    const batchSize = batchSizeInput.$value.getValue();
    const numReps = numRepsInput.$value.getValue();
    const baselineType = getBaselineType(baselineDropdown.$value.getValue());

    progress.updateProgress(0); // Reset progress bar immediately

    // Make a POST request to the backend
    fetch('http://127.0.0.1:8000/predict', {
        method: 'POST',
        body: JSON.stringify({ 
            query, 
            passage, 
            batch_size: batchSize, 
            num_reps: numReps, 
            baseline_type: baselineType 
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then(response => response.json())
        .then(data => {
            const tokens = data.tokens;
            const attributions = data.attributions;
            const baselineError = data.error;

            //console.log('Baseline Error:', baselineError, 'Type:', typeof baselineError); 

            let html = tokens.map((token, index) => {
                const attr = attributions[index];
                const color = getColor(attr);
                return `<span style="color:${color}" title="${attr.toFixed(4)}">${token}</span>`;
            }).join(" ");

            outputText.$value.next(`${html}<br><br>Baseline Error: ${baselineError.toFixed(4)}`);
        })
        .catch(error => {
            console.error('Error:', error);
            outputText.$value.next('An error occurred while fetching the prediction.');
        });
    

    connectProgressWebSocket(); // Connect to WebSocket for progress updates
});

submitNIG.$click.subscribe(() => {
    const query = queryInput.$value.getValue();
    const passage = passageInput.$value.getValue();
    const batchSize = batchSizeInput.$value.getValue();
    const numReps = numRepsInput.$value.getValue();
    const baselineType = getBaselineType(baselineDropdown.$value.getValue());
    const splitType = toggleSplit.$checked.getValue();

    progress.updateProgress(0); // Reset progress bar immediately

    // Make a POST request to the backend
    fetch('http://127.0.0.1:8000/nig_predict', {
        method: 'POST',
        body: JSON.stringify({ query: query, passage: passage, batch_size: batchSize, num_reps: numReps, baseline_type: baselineType, split_type: splitType }),
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then(response => response.json())
        .then(data => {
            const nig = data.nig;
            // Update Layer Dropdown
            const layerOptions = Object.keys(nig);
            if (layerOptions.length > 0) {
                layerDropdown.$options.next(layerOptions); // Update dropdown options
                layerDropdown.$value.next(layerOptions[0]); // Set the first layer as the default selected value
            } else {
                layerDropdown.$options.next(['No layers available']); // Fallback if no layers are available
                layerDropdown.$value.next('No layers available');
            }
            // Handle layer selection
            layerDropdown.$value.subscribe((selectedLayer) => {
                console.log('Selected Layer:', selectedLayer); // Log the selected layer for debugging

                if (selectedLayer && nig[selectedLayer]) {
                    tableNIGS.$options.next({
                        layer: selectedLayer,
                        values: nig[selectedLayer] || [], // Ensure values are not null
                    }); // Update table with selected layer's values
                } else {
                    console.warn(`Invalid layer selected or missing data for: ${selectedLayer}`);
                    tableNIGS.$options.next({ error: 'Invalid layer selected or missing data.' }); // Handle invalid selection
                }
            });
        })
        .catch(error => {
            console.error('Error:', error);
            tableNIGS.$value.next('An error occurred while fetching the prediction.');
            layerDropdown.$options.next(['Error fetching layers']); 
            layerDropdown.$value.next('Error fetching layers'); 
        });

    connectProgressWebSocket(); // Connect to WebSocket for progress updates
});

// Function to handle WebSocket connection for progress updates
function connectProgressWebSocket() {
    // If a WebSocket is already open or closing, close it and wait for it to close before opening a new one
    if (progressWS && progressWS.readyState !== WebSocket.CLOSED) {
        pendingOpenProgressWS = true;
        progressWS.onclose = () => {
            progressWS = null;
            pendingOpenProgressWS = false;
            connectProgressWebSocket(); // Now open the new one
        };
        progressWS.close();
        return;
    }
    // Prevent multiple opens if already pending
    if (pendingOpenProgressWS) return;

    progressWS = new WebSocket("ws://127.0.0.1:8000/progress");

    progressWS.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.progress !== undefined) {
            progress.updateProgress(data.progress);
        }
    };

    progressWS.onerror = (error) => {
        console.error("WebSocket error:", error);
    };

    progressWS.onclose = () => {
        progressWS = null;
        pendingOpenProgressWS = false;
        console.log("WebSocket connection closed.");
    };
}

// Show the dashboard
dash.show();
