<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as widgets from '@marcellejs/gui-widgets';
  import { snapshotManager, type NIGSnapshot } from '$lib/services/nig-snapshots';
  import type { NIGConnection } from '$lib/services/nig-connection';

  interface Props {
    visible?: boolean;
    connection?: NIGConnection;
  }

  let { visible = false, connection }: Props = $props();

  // State
  let snapshots = $state<NIGSnapshot[]>([]);
  let selectedIndex = $state<number>(-1);
  let unsubscribe: (() => void) | null = null;

  // Create Marcelle widgets
  const loadButton = widgets.button('Load Selected');
  const clearButton = widgets.button('Clear All');
  
  let loadClickSub: any = null;
  let clearClickSub: any = null;

  onMount(() => {
    // Load initial snapshots
    snapshots = snapshotManager.getSnapshots();

    // Subscribe to snapshot changes
    unsubscribe = snapshotManager.subscribe(() => {
      snapshots = snapshotManager.getSnapshots();
    });

    // Button click handlers
    loadClickSub = loadButton.$click.subscribe(() => {
      if (selectedIndex >= 0 && selectedIndex < snapshots.length && connection) {
        const snapshot = snapshots[selectedIndex];
        console.log('[SAVED NIGS] Loading snapshot', snapshot.id);
        connection.loadSnapshot(snapshot);
      }
    });

    clearClickSub = clearButton.$click.subscribe(async () => {
      if (confirm('Clear all saved NIG runs from backend?')) {
        await snapshotManager.clearSnapshots();
        selectedIndex = -1;
      }
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    if (loadClickSub) loadClickSub.unsubscribe();
    if (clearClickSub) clearClickSub.unsubscribe();
  });

  function selectSnapshot(index: number) {
    selectedIndex = index;
  }
</script>

<div class="h-full flex flex-col bg-base-100 overflow-hidden">
  {#if visible}
    <div class="flex-shrink-0 p-4 border-b border-base-300">
      <h3 class="text-lg font-semibold mb-2">Saved NIG Runs</h3>
      <p class="text-xs text-base-content/60">
        {snapshots.length} saved run{snapshots.length !== 1 ? 's' : ''}
      </p>
    </div>

    <!-- Snapshot List -->
    <div class="flex-1 overflow-y-auto p-4">
      {#if snapshots.length === 0}
        <div class="text-center text-base-content/40 text-sm py-8">
          No saved runs yet.<br />
          Run a NIG calculation to auto-save results.
        </div>
      {:else}
        <div class="space-y-2">
          {#each snapshots as snapshot, index}
            <button
              class="w-full text-left p-3 rounded-lg border border-base-300 hover:bg-base-200 transition-colors"
              class:bg-primary={selectedIndex === index}
              class:bg-opacity-10={selectedIndex === index}
              class:border-primary={selectedIndex === index}
              class:border-2={selectedIndex === index}
              onclick={() => selectSnapshot(index)}
            >
              <div class="text-xs font-mono text-base-content/80 mb-1">
                {snapshot.timestamp}
              </div>
              <div class="text-sm font-medium mb-1">
                {snapshot.baselineLabel || 'No baseline'}
              </div>
              <div class="text-xs text-base-content/60 mb-1">
                Repetitions: {snapshot.numReps}
              </div>
              <div class="text-xs text-base-content/50 truncate">
                Q: {snapshot.query.slice(0, 40)}{snapshot.query.length > 40 ? '…' : ''}
              </div>
              <div class="text-xs text-base-content/50 truncate">
                P: {snapshot.passage.slice(0, 40)}{snapshot.passage.length > 40 ? '…' : ''}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Action Buttons -->
    <div class="flex-shrink-0 p-4 border-t border-base-300 space-y-2">
      <div class="marcelle-button-styled w-full">
        <div use:loadButton.mount></div>
      </div>
      <div class="marcelle-button-styled w-full">
        <div use:clearButton.mount></div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(.marcelle-button-styled button) {
    /* DaisyUI btn btn-sm btn-outline styles */
    display: inline-flex;
    width: 100%;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    border-radius: var(--rounded-btn, 0.5rem);
    text-align: center;
    transition-property: color, background-color, border-color, opacity, box-shadow, transform;
    transition-duration: 200ms;
    transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
    border-width: 1px;
    border-color: transparent;
    background-color: transparent;
    font-weight: 600;
    text-transform: uppercase;
    text-transform: var(--btn-text-case, uppercase);
    
    /* btn-sm */
    height: 2rem;
    padding-left: 0.75rem;
    padding-right: 0.75rem;
    min-height: 2rem;
    font-size: 0.875rem;
    
    /* btn-outline */
    border-color: currentColor;
    background-color: transparent;
    
    /* DaisyUI theme colors */
    --tw-border-opacity: 0.2;
    border-color: hsl(var(--bc) / var(--tw-border-opacity));
    --tw-text-opacity: 1;
    color: hsl(var(--bc) / var(--tw-text-opacity));
  }
  
  :global(.marcelle-button-styled button:hover) {
    --tw-border-opacity: 1;
    border-color: hsl(var(--bc) / var(--tw-border-opacity));
    --tw-bg-opacity: 1;
    background-color: hsl(var(--bc) / var(--tw-bg-opacity));
    --tw-text-opacity: 1;
    color: hsl(var(--b1) / var(--tw-text-opacity));
  }
</style>
