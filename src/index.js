import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';
import { nigtable } from './components';

// Side Constant panel

// Query exploration
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

// Add number inputs for batch size and number of repetitions
const batchSizeInput = widgets.number(10); // Default value: 10
batchSizeInput.title = 'Batch Size';

const numRepsInput = widgets.number(20); // Default value: 20
numRepsInput.title = 'Number of Repetitions';

// NIG explroation
const tableNIGS = nigtable();
tableNIGS.title = 'NIG values';

// Dropdown for selecting a layer
const layerDropdown = widgets.select(['Loading...']); // Initialize with a default option
layerDropdown.title = 'Select Layer';

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
    .sidebar(queryInput, passageInput) // Add inputs to sidebar
    .use([batchSizeInput, numRepsInput, submitQuery],[outputText]);
    

dash.page('NIG values')
    .sidebar(queryInput, passageInput, batchSizeInput, numRepsInput, submitNIG) // Add inputs to sidebar
    .use(layerDropdown,[tableNIGS]);

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

// Handle the submit button click
submitQuery.$click.subscribe(() => {
    const query = queryInput.$value.getValue();
    const passage = passageInput.$value.getValue();
    const batchSize = batchSizeInput.$value.getValue();
    const numReps = numRepsInput.$value.getValue();

    // Make a POST request to the backend
    fetch('http://127.0.0.1:8000/predict', {
        method: 'POST',
        body: JSON.stringify({ query: query, passage: passage, batch_size: batchSize, num_reps: numReps }),
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                outputText.$value.next(data.error);
            } else {
                const tokens = data.tokens;
                const attributions = data.attributions;
                let html = "";
                tokens.forEach((token, index) => {
                    const attr = attributions[index];
                    const color = getColor(attr);
                    html += `<span style="color:${color}" title="${attr}">${token}</span> `;
                });
                outputText.$value.next(html);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            outputText.$value.next('An error occurred while fetching the prediction.');
        });
});

submitNIG.$click.subscribe(() => {
    const query = queryInput.$value.getValue();
    const passage = passageInput.$value.getValue();
    const batchSize = batchSizeInput.$value.getValue();
    const numReps = numRepsInput.$value.getValue();

    // Make a POST request to the backend
    fetch('http://127.0.0.1:8000/nig_predict', {
        method: 'POST',
        body: JSON.stringify({ query: query, passage: passage, batch_size: batchSize, num_reps: numReps }),
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then((response) => response.json())
        .then((data) => {
            console.log('Server Response:', data); // Log the server response for debugging

            if (data.error) {
                tableNIGS.$options.next({ error: data.error }); // Update table with error
                layerDropdown.$options.next(['Error fetching layers']); // Update dropdown with error message
                layerDropdown.$value.next('Error fetching layers'); // Ensure dropdown reflects the error
            } else {
                const nig = data.nig;

                // Extract the keys from the `nig` object and update the dropdown options
                const layerOptions = Object.keys(nig);
                console.log('Layer Options:', layerOptions); // Log the layer options for debugging

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
                            error: 'No error available for this layer',
                        }); // Update table with selected layer's values and error
                    } else {
                        console.warn(`Invalid layer selected or missing data for: ${selectedLayer}`);
                        tableNIGS.$options.next({ error: 'Invalid layer selected or missing data.' }); // Handle invalid selection
                    }
                });
            }
        })
        .catch((error) => {
            console.error('Error:', error);
            tableNIGS.$options.next({ error: 'An error occurred while fetching the NIG values.' });
            layerDropdown.$options.next(['Error fetching layers']); // Update dropdown with error message
            layerDropdown.$value.next('Error fetching layers'); // Ensure dropdown reflects the error
        });
});

// Show the dashboard
dash.show();
