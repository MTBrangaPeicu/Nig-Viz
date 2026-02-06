/**
 * Shared input components that persist across page navigation.
 * 
 * This module provides singleton instances of input components (query, passage, etc.)
 * that maintain their state when navigating between the NIG Visualization page
 * and the Query Review Dashboard.
 */

import { writable, get } from 'svelte/store';
import { betterText, betterNumber, subsetButtons } from '$lib/marcelle/components';

// Singleton component instances
let _queryInputComponent: any = null;
let _passageInputComponent: any = null;
let _passageInput2Component: any = null;
let _numRepsInputComponent: any = null;
let _subsetButtonsComponent: any = null;

// Store to track initialization status
export const inputsInitialized = writable(false);

// Store for baseline value (shared between pages)
export const sharedBaseline = writable('Padded Query and Passage (Special Tokens Preserved)');

/**
 * Get or create the shared query input component
 */
export function getQueryInputComponent() {
  if (!_queryInputComponent) {
    _queryInputComponent = betterText('', []);
    _queryInputComponent.title = 'Query';
    _queryInputComponent.samples = [];
  }
  return _queryInputComponent;
}

/**
 * Get or create the shared passage input component
 */
export function getPassageInputComponent() {
  if (!_passageInputComponent) {
    _passageInputComponent = betterText('', []);
    _passageInputComponent.title = 'Passage (required)';
  }
  return _passageInputComponent;
}

/**
 * Get or create the shared passage 2 input component
 */
export function getPassageInput2Component() {
  if (!_passageInput2Component) {
    _passageInput2Component = betterText('', []);
    _passageInput2Component.title = 'Passage 2 (optional)';
  }
  return _passageInput2Component;
}

/**
 * Get or create the shared number of repetitions input component
 */
export function getNumRepsInputComponent() {
  if (!_numRepsInputComponent) {
    _numRepsInputComponent = betterNumber(20);
    _numRepsInputComponent.title = 'Number of Repetitions';
  }
  return _numRepsInputComponent;
}

/**
 * Get or create the shared subset buttons component
 */
export function getSubsetButtonsComponent() {
  if (!_subsetButtonsComponent) {
    _subsetButtonsComponent = subsetButtons(['Random']);
    _subsetButtonsComponent.title = 'Qrels Subsets';
  }
  return _subsetButtonsComponent;
}

/**
 * Get all shared input components at once.
 * This is useful for pages that need all components.
 */
export function getSharedInputComponents() {
  const components = {
    queryInput: getQueryInputComponent(),
    passageInput: getPassageInputComponent(),
    passageInput2: getPassageInput2Component(),
    numRepsInput: getNumRepsInputComponent(),
    subsetButtons: getSubsetButtonsComponent(),
  };
  
  inputsInitialized.set(true);
  return components;
}

/**
 * Check if inputs have been initialized
 */
export function areInputsInitialized(): boolean {
  return get(inputsInitialized);
}
