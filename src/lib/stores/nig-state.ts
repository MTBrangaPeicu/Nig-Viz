import { writable, derived } from 'svelte/store';

// Main NIG computation data
export const nigData = writable(null);

// Architecture selection state (two-step: source -> target)
export const selection = writable({ source: null, target: null });

// Threshold for filtering edges/values
export const threshold = writable(0.5);

// Visualization settings
export const useAbsoluteValues = writable(true);
export const architectureNodeColors = writable(false);

// Pruning state
export const pruningEnabled = writable(false);
export const attentionThreshold = writable(0.0);
export const ffnThreshold = writable(0.0);

// Snapshots
export const nigSnapshots = writable([]);

// Derived: current global cutoff value
export const globalCutoff = derived(
  [nigData, threshold],
  ([$nigData, $threshold]) => {
    if (!$nigData) return 0;
    // Calculate actual cutoff value based on threshold percentage
    // This will be implemented based on your NIG data structure
    return $threshold;
  }
);
