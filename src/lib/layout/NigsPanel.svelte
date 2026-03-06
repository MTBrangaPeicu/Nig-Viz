<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  let isNigProcessing = $state(false);
  let isConditionalProcessing = $state(false);
  let unsubscribe: (() => void) | null = null;
  
  // Derived state - disabled if either is processing
  const isProcessing = $derived(isNigProcessing || isConditionalProcessing);

  let nigStatusSub: any = null;
  let conditionalStatusSub: any = null;

  onMount(() => {
    // Load initial snapshots
    snapshots = snapshotManager.getSnapshots();

    // Subscribe to snapshot changes
    unsubscribe = snapshotManager.subscribe(() => {
      snapshots = snapshotManager.getSnapshots();
    });
    
    // Track NIG and Conditional NIG processing state to disable load button
    if (connection) {
      nigStatusSub = connection.nigStatus$.subscribe((status: any) => {
        if (status) {
          isNigProcessing = status.status === 'processing' || status.status === 'pending';
        }
      });
      
      conditionalStatusSub = connection.conditionalNigStatus$.subscribe((status: any) => {
        if (status) {
          isConditionalProcessing = status.status === 'processing' || status.status === 'pending';
        }
      });
    }
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    if (nigStatusSub) nigStatusSub.unsubscribe();
    if (conditionalStatusSub) conditionalStatusSub.unsubscribe();
  });

  function selectSnapshot(index: number) {
    selectedIndex = index;
  }

  function handleLoadSelected() {
    if (selectedIndex >= 0 && selectedIndex < snapshots.length && connection && !isProcessing) {
      const snapshot = snapshots[selectedIndex];
      console.log('[SAVED NIGS] Loading snapshot', snapshot.id);
      connection.loadSnapshot(snapshot);
    }
  }

  async function handleClearAll() {
    if (confirm('Clear all saved NIG runs from backend?')) {
      await snapshotManager.clearSnapshots();
      selectedIndex = -1;
    }
  }

  async function handleDeleteSnapshot(snapshotId: string, event: Event) {
    event.stopPropagation();
    await snapshotManager.deleteSnapshot(snapshotId);
    if (selectedIndex >= snapshots.length) {
      selectedIndex = snapshots.length - 1;
    }
  }
</script>

<div class="h-full flex flex-col bg-base-100 overflow-hidden">
  {#if visible}
    <div class="flex-shrink-0 p-4 border-b border-base-300">
      <div class="section-header">
        <span class="section-title">Saved NIG Runs</span>
        <span class="tooltip-wrapper">
          <span class="tooltip-icon">?</span>
          <span class="tooltip-text">View and load previously computed NIG results. Results are auto-saved after each NIG calculation.</span>
        </span>
      </div>
      <p class="text-xs text-base-content/60 mt-1">
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
            <div class="relative group">
              <button
                class="w-full text-left p-3 rounded-lg border border-base-300 hover:bg-base-200 transition-colors pr-8"
                class:border-primary={selectedIndex === index}
                class:border-2={selectedIndex === index}
                onclick={() => selectSnapshot(index)}
              >
                <div class="text-xs font-mono text-base-content/60 mb-1">
                  {snapshot.timestamp}
                </div>
                <div class="text-sm font-medium truncate">
                  Q: {snapshot.query.slice(0, 50)}{snapshot.query.length > 50 ? '…' : ''}
                </div>
                <div class="text-sm font-medium truncate mb-1">
                  P: {snapshot.passage.slice(0, 50)}{snapshot.passage.length > 50 ? '…' : ''}
                </div>
                <div class="text-xs text-base-content/50">
                  {snapshot.baselineLabel || 'No baseline'} · {snapshot.numReps} reps
                </div>
              </button>
              <button
                class="absolute top-2 right-2 btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onclick={(e) => handleDeleteSnapshot(snapshot.id, e)}
                aria-label="Delete snapshot"
              >
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Action Buttons -->
    <div class="flex-shrink-0 p-4 border-t border-base-300 space-y-2">
      <button 
        class="btn btn-sm btn-outline w-full"
        disabled={isProcessing || selectedIndex < 0}
        onclick={handleLoadSelected}
      >
        Load Selected
      </button>
      <button 
        class="btn btn-sm btn-outline w-full"
        onclick={handleClearAll}
      >
        Clear All
      </button>
    </div>
  {/if}
</div>

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  
  .section-title {
    font-weight: 600;
    font-size: 0.875rem;
    color: hsl(var(--bc) / 0.8);
  }
  
  .tooltip-wrapper {
    position: relative;
    display: inline-flex;
  }
  
  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 50%;
    background-color: hsl(var(--b3));
    color: hsl(var(--bc) / 0.7);
    cursor: help;
    border: 2px solid hsl(var(--bc) / 0.3);
  }
  
  .tooltip-wrapper:hover .tooltip-icon {
    background-color: hsl(var(--p));
    color: hsl(var(--pc));
    border-color: hsl(var(--p));
  }
  
  .tooltip-text {
    visibility: hidden;
    opacity: 0;
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 0.5rem;
    padding: 0.625rem 0.75rem;
    background-color: #1a1a1a;
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 400;
    border-radius: 0.375rem;
    width: 220px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    line-height: 1.5;
    transition: opacity 0.15s ease, visibility 0.15s ease;
  }
  
  .tooltip-wrapper:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }
</style>
