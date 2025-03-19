import '@marcellejs/core/dist/marcelle.css';
import '@marcellejs/gui-widgets/dist/marcelle-gui-widgets.css';
import '@marcellejs/layouts/dist/marcelle-layouts.css';
import * as core from '@marcellejs/core';
import * as widgets from '@marcellejs/gui-widgets';
import { dashboard } from '@marcellejs/layouts';

// Create the UI components for input
const queryInput = widgets.textInput();
queryInput.title = 'Query';
const passageInput = widgets.textInput();
passageInput.title = 'Passage';
const submitButton = widgets.button('Submit');
submitButton.title = 'Submit';
const outputText = widgets.text('Output');
outputText.title = 'Output';


// Set up the dashboard with the components
const dash = dashboard({
  title: 'Integrated Gradients Visualization',
  author: 'ISIR',
});

dash.page('Integrated Gradients Visualization')
    .use([queryInput, passageInput, submitButton]);

// Add the dataset table to the dashboard
dash.page('Integrated Gradients Visualization')
    .use(outputText);

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
submitButton.$click.subscribe(() => {
    const query = queryInput.$value.getValue();
    const passage = passageInput.$value.getValue();

    // Make a POST request to the backend
    fetch('http://127.0.0.1:8000/predict', {
        method: 'POST',
        body: JSON.stringify({ query: query, passage: passage }),
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

// Show the dashboard
dash.show();
