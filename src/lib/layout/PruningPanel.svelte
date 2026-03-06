<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { BehaviorSubject } from 'rxjs';
  import { pruneSnapshotManager, type PruneSnapshot } from '$lib/services/prune-snapshots';
  
  interface PruningRule {
    layer: string;
    tokenType: string;
  }
  
  interface PrunedEdge {
    layer: string;
    srcToken: string;
    tgtToken: string;
  }
  
  interface PruningState {
    enabled: boolean;
    rules: PruningRule[];
    targets: any[];
    edges: PrunedEdge[];
    thresholds: { attention?: number; ffn?: number };
  }
  
  interface PrunePreview {
    rules: PruningRule[];
    targets: any[];
    edges: PrunedEdge[];
    thresholds: { attention: number; ffn: number };
  }
  
  interface Props {
    visible?: boolean;
    cursorActive?: boolean;
    pruningState$?: BehaviorSubject<PruningState>;
    prunePreview$?: BehaviorSubject<PrunePreview | null>;
  }

  let { visible = false, cursorActive = $bindable(false), pruningState$, prunePreview$ }: Props = $props();
  
  // Slider values are in [0,1] range, representing logarithmic position
  let attentionSliderValue = $state(0.0);
  let ffnSliderValue = $state(0.0);
  let pruningRules = $state<PruningRule[]>([]);
  let pruningTargets = $state<any[]>([]);
  let prunedEdges = $state<PrunedEdge[]>([]);
  
  // All token types
  const ALL_TOKEN_TYPES = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
  
  // Computed display rules that collapse full layers into "all"
  interface DisplayRule {
    layer: string;
    tokenType: string;
    isFullLayer: boolean;
    originalIndices: number[]; // indices in pruningRules for removal
  }
  
  let displayRules = $derived.by(() => {
    // Group rules by layer
    const layerGroups: Map<string, { tokenTypes: Set<string>, indices: number[] }> = new Map();
    
    pruningRules.forEach((rule, idx) => {
      if (!layerGroups.has(rule.layer)) {
        layerGroups.set(rule.layer, { tokenTypes: new Set(), indices: [] });
      }
      const group = layerGroups.get(rule.layer)!;
      group.tokenTypes.add(rule.tokenType);
      group.indices.push(idx);
    });
    
    const result: DisplayRule[] = [];
    
    layerGroups.forEach((group, layer) => {
      const hasAllTokens = ALL_TOKEN_TYPES.every(tt => group.tokenTypes.has(tt));
      
      if (hasAllTokens) {
        // Full layer - show as single "all" entry
        result.push({
          layer,
          tokenType: 'all',
          isFullLayer: true,
          originalIndices: group.indices
        });
      } else {
        // Individual token types
        group.indices.forEach((idx) => {
          result.push({
            layer,
            tokenType: pruningRules[idx].tokenType,
            isFullLayer: false,
            originalIndices: [idx]
          });
        });
      }
    });
    
    return result;
  });
  
  // Saved prunes state
  let savedPrunes = $state<PruneSnapshot[]>([]);
  let selectedPruneId = $state('');
  let saveName = $state('');
  let showSaveDialog = $state(false);
  
  // Convert slider position [0,1] to actual threshold value using logarithmic scale
  // slider=0 → threshold=0 (no pruning)
  // slider=1 → threshold=1 (max pruning)
  // For slider > 0: threshold = 10^(-4 + 4*slider), giving range [0.0001, 1]
  function sliderToThreshold(sliderValue: number): number {
    if (sliderValue === 0) return 0;
    return Math.pow(10, -4 + 4 * sliderValue);
  }
  
  // Convert actual threshold to slider position
  function thresholdToSlider(threshold: number): number {
    if (threshold <= 0) return 0;
    if (threshold >= 1) return 1;
    // threshold = 10^(-4 + 4*slider)
    // log10(threshold) = -4 + 4*slider
    // slider = (log10(threshold) + 4) / 4
    return Math.max(0, Math.min(1, (Math.log10(threshold) + 4) / 4));
  }
  
  // Format threshold as percentage for display
  function formatThreshold(sliderValue: number): string {
    if (sliderValue === 0) return '0%';
    const threshold = sliderToThreshold(sliderValue);
    const percentage = threshold * 100;
    if (percentage >= 10) return percentage.toFixed(0) + '%';
    if (percentage >= 1) return percentage.toFixed(1) + '%';
    if (percentage >= 0.1) return percentage.toFixed(2) + '%';
    return percentage.toFixed(3) + '%';
  }
  
  // Emit threshold changes to pruningState$
  function emitThresholdChange() {
    if (pruningState$) {
      const attentionThreshold = sliderToThreshold(attentionSliderValue);
      const ffnThreshold = sliderToThreshold(ffnSliderValue);
      console.log('[PruningPanel] Emitting threshold change:', { attention: attentionThreshold, ffn: ffnThreshold });
      pruningState$.next({
        enabled: true,
        rules: pruningRules,
        targets: pruningTargets,
        edges: prunedEdges,
        thresholds: { attention: attentionThreshold, ffn: ffnThreshold }
      });
    }
  }
  
  // Function to remove a specific rule
  function removeRule(index: number) {
    if (pruningState$) {
      const newRules = pruningRules.filter((_, i) => i !== index);
      pruningState$.next({
        enabled: true,
        rules: newRules,
        targets: pruningTargets,
        edges: prunedEdges,
        thresholds: { attention: sliderToThreshold(attentionSliderValue), ffn: sliderToThreshold(ffnSliderValue) }
      });
    }
  }
  
  // Function to remove a display rule (may remove multiple underlying rules for full layers)
  function removeDisplayRule(displayRule: DisplayRule) {
    if (pruningState$) {
      const indicesToRemove = new Set(displayRule.originalIndices);
      const newRules = pruningRules.filter((_, i) => !indicesToRemove.has(i));
      pruningState$.next({
        enabled: true,
        rules: newRules,
        targets: pruningTargets,
        edges: prunedEdges,
        thresholds: { attention: sliderToThreshold(attentionSliderValue), ffn: sliderToThreshold(ffnSliderValue) }
      });
    }
  }
  
  // Function to remove a specific target
  function removeTarget(index: number) {
    if (pruningState$) {
      const newTargets = pruningTargets.filter((_, i) => i !== index);
      pruningState$.next({
        enabled: true,
        rules: pruningRules,
        targets: newTargets,
        edges: prunedEdges,
        thresholds: { attention: sliderToThreshold(attentionSliderValue), ffn: sliderToThreshold(ffnSliderValue) }
      });
    }
  }
  
  // Function to remove a specific edge
  function removeEdge(index: number) {
    if (pruningState$) {
      const newEdges = prunedEdges.filter((_, i) => i !== index);
      pruningState$.next({
        enabled: true,
        rules: pruningRules,
        targets: pruningTargets,
        edges: newEdges,
        thresholds: { attention: sliderToThreshold(attentionSliderValue), ffn: sliderToThreshold(ffnSliderValue) }
      });
    }
  }

  // Save current prune configuration
  async function savePrune() {
    if (!pruningState$) return;
    
    const currentState = pruningState$.getValue();
    const snapshot = pruneSnapshotManager.createSnapshot(
      {
        rules: currentState.rules || [],
        targets: currentState.targets || [],
        edges: currentState.edges || [],
        thresholds: currentState.thresholds || { attention: 0, ffn: 0 }
      },
      saveName || undefined
    );
    
    await pruneSnapshotManager.saveSnapshot(snapshot);
    saveName = '';
    showSaveDialog = false;
  }

  // Load a saved prune configuration
  function loadPrune(pruneId: string) {
    if (!pruningState$ || !pruneId) return;
    
    const snapshot = pruneSnapshotManager.getSnapshotById(pruneId);
    if (!snapshot) {
      console.warn('[PruningPanel] Snapshot not found:', pruneId);
      return;
    }
    
    console.log('[PruningPanel] Loading prune snapshot:', snapshot.name);
    
    // Update slider values from thresholds
    attentionSliderValue = thresholdToSlider(snapshot.thresholds?.attention || 0);
    ffnSliderValue = thresholdToSlider(snapshot.thresholds?.ffn || 0);
    
    // Emit the loaded state to pruningState$
    pruningState$.next({
      enabled: true,
      rules: snapshot.rules || [],
      targets: snapshot.targets || [],
      edges: snapshot.edges || [],
      thresholds: snapshot.thresholds || { attention: 0, ffn: 0 }
    });
    
    selectedPruneId = '';
  }

  // Delete a saved prune
  async function deletePrune(pruneId: string) {
    if (confirm('Delete this saved prune?')) {
      await pruneSnapshotManager.deleteSnapshot(pruneId);
    }
  }

  // Clear all saved prunes
  async function clearAllPrunes() {
    if (confirm('Clear all saved prunes?')) {
      await pruneSnapshotManager.clearSnapshots();
    }
  }

  // Show preview highlighting for a saved prune on hover
  function showPrunePreview(prune: PruneSnapshot) {
    if (prunePreview$) {
      console.log('[PruningPanel] Showing prune preview:', prune.name);
      prunePreview$.next({
        rules: prune.rules || [],
        targets: prune.targets || [],
        edges: prune.edges || [],
        thresholds: prune.thresholds || { attention: 0, ffn: 0 },
        isSavedPrune: true  // Flag to apply full red coloring
      });
    } else {
      console.warn('[PruningPanel] prunePreview$ is not available');
    }
  }

  // Show preview for a single rule
  function showRulePreview(rule: PruningRule) {
    if (prunePreview$) {
      console.log('[PruningPanel] Showing rule preview:', rule);
      prunePreview$.next({
        rules: [rule],
        targets: [],
        edges: [],
        thresholds: { attention: 0, ffn: 0 }
      });
    } else {
      console.warn('[PruningPanel] prunePreview$ is not available');
    }
  }

  // Show preview for a single target
  function showTargetPreview(target: any) {
    if (prunePreview$) {
      console.log('[PruningPanel] Showing target preview:', target);
      prunePreview$.next({
        rules: [],
        targets: [target],
        edges: [],
        thresholds: { attention: 0, ffn: 0 }
      });
    } else {
      console.warn('[PruningPanel] prunePreview$ is not available');
    }
  }

  // Show preview for a single edge
  function showEdgePreview(edge: PrunedEdge) {
    if (prunePreview$) {
      console.log('[PruningPanel] Showing edge preview:', edge);
      prunePreview$.next({
        rules: [],
        targets: [],
        edges: [edge],
        thresholds: { attention: 0, ffn: 0 }
      });
    } else {
      console.warn('[PruningPanel] prunePreview$ is not available');
    }
  }

  // Clear preview highlighting when mouse leaves
  function clearPrunePreview() {
    if (prunePreview$) {
      console.log('[PruningPanel] Clearing prune preview');
      prunePreview$.next(null);
    }
  }

  // Check if current prune has anything to save
  function hasPruneData(): boolean {
    return pruningRules.length > 0 || pruningTargets.length > 0 || prunedEdges.length > 0 ||
           sliderToThreshold(attentionSliderValue) > 0 || sliderToThreshold(ffnSliderValue) > 0;
  }

  function clearPrune() {
    if (pruningState$) {
      pruningState$.next({
        enabled: true,
        rules: [],
        targets: [],
        edges: [],
        thresholds: { attention: sliderToThreshold(attentionSliderValue), ffn: sliderToThreshold(ffnSliderValue) }
      });
    }
  }
  
  let subscription: any;
  let pruneSubscription: (() => void) | null = null;
  
  onMount(() => {
    // Load saved prunes
    savedPrunes = pruneSnapshotManager.getSnapshots();
    
    // Subscribe to prune snapshot changes
    pruneSubscription = pruneSnapshotManager.subscribe(() => {
      savedPrunes = pruneSnapshotManager.getSnapshots();
    });
    
    if (pruningState$) {
      subscription = pruningState$.subscribe((state: PruningState) => {
        console.log('[PruningPanel] Received pruning state update:', state);
        pruningRules = state.rules || [];
        pruningTargets = state.targets || [];
        prunedEdges = state.edges || [];
        // Convert threshold values back to slider positions
        attentionSliderValue = thresholdToSlider(state.thresholds?.attention || 0);
        ffnSliderValue = thresholdToSlider(state.thresholds?.ffn || 0);
      });
    }
  });
  
  onDestroy(() => {
    if (subscription) {
      subscription.unsubscribe();
    }
    if (pruneSubscription) {
      pruneSubscription();
    }
  });
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Section Header with Tooltip -->
      <div class="section-header">
        <span class="section-title">Pruning</span>
        <span class="tooltip-wrapper">
          <span class="tooltip-icon">?</span>
          <span class="tooltip-text">Prune attention heads by clicking on architecture nodes or table cells. Adjust thresholds to filter by magnitude. Save pruning configurations as snapshots.</span>
        </span>
      </div>

      <!-- Icon at top -->
      <div class="flex items-center justify-center py-4">
        <button 
          class="btn btn-circle btn-lg"
          class:btn-primary={cursorActive}
          onclick={() => {
            cursorActive = !cursorActive;
            console.log('[PruningPanel] Scissors clicked! cursorActive is now:', cursorActive);
          }}
          aria-label="Toggle Pruning cursor"
        >
          <!-- ScissorsIcon -->
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="m7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 0 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215-7.794 4.5m-2.882-1.664A4.331 4.331 0 0 0 10.607 12m3.736 0 7.794 4.5-.802.215a4.5 4.5 0 0 1-2.48-.043l-5.326-1.629a4.324 4.324 0 0 1-2.068-1.379M14.343 12l-2.882 1.664" />
          </svg>
        </button>
      </div>

      <p class="text-xs text-center text-base-content/70">
        {cursorActive ? 'Click on architecture or table to prune' : 'Click the icon to activate pruning cursor'}
      </p>

      <div class="divider"></div>

      <!-- Pruned Nodes (Architecture clicks) -->
      <div class="space-y-2">
        <div class="font-semibold text-sm">Pruned Nodes ({displayRules.length})</div>

        {#if displayRules.length === 0}
          <div class="text-xs text-base-content/50 py-2 text-center">
            Click architecture nodes to prune
          </div>
        {:else}
          <div class="space-y-1 max-h-32 overflow-y-auto">
            {#each displayRules as displayRule}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="text-xs bg-base-200 rounded px-2 py-1 flex justify-between items-center group hover:bg-amber-100 transition-colors cursor-pointer"
                onmouseenter={() => { if (displayRule.originalIndices.length > 0) showRulePreview(pruningRules[displayRule.originalIndices[0]]); }}
                onmouseleave={() => clearPrunePreview()}
              >
                <span class="font-mono">
                  {displayRule.layer} → {displayRule.tokenType}
                </span>
                <button 
                  class="btn btn-ghost btn-xs opacity-50 group-hover:opacity-100"
                  onclick={() => removeDisplayRule(displayRule)}
                >×</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Pruned Heads/Neurons (Table clicks) -->
      <div class="space-y-2">
        <div class="font-semibold text-sm">Pruned Heads/Neurons ({pruningTargets.length})</div>

        {#if pruningTargets.length === 0}
          <div class="text-xs text-base-content/50 py-2 text-center">
            Click table rows to prune specific heads/neurons
          </div>
        {:else}
          <div class="space-y-1 max-h-32 overflow-y-auto">
            {#each pruningTargets as target, i}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="text-xs bg-base-200 rounded px-2 py-1 flex justify-between items-center group hover:bg-amber-100 transition-colors cursor-pointer"
                onmouseenter={() => showTargetPreview(target)}
                onmouseleave={() => clearPrunePreview()}
              >
                <span class="font-mono">
                  {target.layer} {target.type === 'ATTN' ? 'head' : 'neuron'}#{target.index} ({target.tokenType})
                </span>
                <button 
                  class="btn btn-ghost btn-xs opacity-50 group-hover:opacity-100"
                  onclick={() => removeTarget(i)}
                >×</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Pruned Edges (Architecture edge clicks) -->
      <div class="space-y-2">
        <div class="font-semibold text-sm">Pruned Edges ({prunedEdges.length})</div>

        {#if prunedEdges.length === 0}
          <div class="text-xs text-base-content/50 py-2 text-center">
            Click architecture edges to prune connections
          </div>
        {:else}
          <div class="space-y-1 max-h-32 overflow-y-auto">
            {#each prunedEdges as edge, i}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="text-xs bg-base-200 rounded px-2 py-1 flex justify-between items-center group hover:bg-amber-100 transition-colors cursor-pointer"
                onmouseenter={() => showEdgePreview(edge)}
                onmouseleave={() => clearPrunePreview()}
              >
                <span class="font-mono">
                  {edge.layer}: {edge.srcToken} → {edge.tgtToken}
                </span>
                <button 
                  class="btn btn-ghost btn-xs opacity-50 group-hover:opacity-100"
                  onclick={() => removeEdge(i)}
                >×</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="divider"></div>

      <!-- Threshold Controls (Logarithmic Scale) -->
      <div class="space-y-4">
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span>Attention Threshold</span>
            <span class="font-mono">{formatThreshold(attentionSliderValue)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="range range-sm"
            bind:value={attentionSliderValue}
            oninput={emitThresholdChange}
          />
        </div>

        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span>FFN Threshold</span>
            <span class="font-mono">{formatThreshold(ffnSliderValue)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="range range-sm"
            bind:value={ffnSliderValue}
            oninput={emitThresholdChange}
          />
        </div>
      </div>

      <div class="divider"></div>

      <!-- Actions -->
      <div class="space-y-2">
        <button class="btn btn-sm btn-outline btn-block" disabled={pruningRules.length === 0 && pruningTargets.length === 0 && prunedEdges.length === 0} onclick={clearPrune}>
          Clear Current Prune
        </button>

        <!-- Save Current Prune -->
        {#if showSaveDialog}
          <div class="bg-base-200 rounded-lg p-3 space-y-2">
            <input
              type="text"
              class="input input-sm input-bordered w-full"
              placeholder="Prune name (optional)"
              bind:value={saveName}
              onkeydown={(e) => e.key === 'Enter' && savePrune()}
            />
            <div class="flex gap-2">
              <button class="btn btn-sm btn-primary flex-1" onclick={savePrune}>
                Save
              </button>
              <button class="btn btn-sm btn-ghost flex-1" onclick={() => { showSaveDialog = false; saveName = ''; }}>
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <button 
            class="btn btn-sm btn-primary btn-block" 
            disabled={!hasPruneData()}
            onclick={() => showSaveDialog = true}
          >
             Save Current Prune
          </button>
        {/if}
      </div>

      <div class="divider"></div>

      <!-- Saved Prunes List -->
      <div class="space-y-2">
        <div class="flex justify-between items-center">
          <div class="font-semibold text-sm">Saved Prunes ({savedPrunes.length})</div>
          {#if savedPrunes.length > 0}
            <button class="btn btn-ghost btn-xs text-error" onclick={clearAllPrunes}>
              Clear All
            </button>
          {/if}
        </div>

        {#if savedPrunes.length === 0}
          <div class="text-xs text-base-content/50 py-4 text-center">
            No saved prunes yet.<br />
            Configure pruning and click "Save Current Prune".
          </div>
        {:else}
          <div class="space-y-1 max-h-48 overflow-y-auto">
            {#each savedPrunes as prune}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="text-xs bg-base-200 rounded px-2 py-2 group hover:bg-base-300 transition-colors"
                onmouseenter={() => showPrunePreview(prune)}
                onmouseleave={() => clearPrunePreview()}
              >
                <div class="flex justify-between items-start">
                  <button 
                    class="flex-1 text-left"
                    onclick={() => loadPrune(prune.id)}
                  >
                    <div class="font-medium">{prune.name}</div>
                    <div class="text-base-content/60 text-[10px]">{prune.timestamp}</div>
                  </button>
                  <button 
                    class="btn btn-ghost btn-xs opacity-50 group-hover:opacity-100"
                    onclick={() => deletePrune(prune.id)}
                  >×</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
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
