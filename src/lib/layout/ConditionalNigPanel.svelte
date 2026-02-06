<script lang="ts">
  import { nigConnection } from '$lib/services/nig-connection';
  import { onMount, onDestroy } from 'svelte';
  
  interface Props {
    visible?: boolean;
    cursorActive?: boolean;
    currentQuery?: string;
    currentPassage?: string;
    numReps?: number;
    hasNigData?: boolean;
    currentThreshold?: number;
    onThresholdChange?: (threshold: number) => void;
  }

  let { 
    visible = false, 
    cursorActive = $bindable(false),
    currentQuery = '',
    currentPassage = '',
    numReps = 20,
    hasNigData = false,
    currentThreshold = 0.01,
    onThresholdChange
  }: Props = $props();
  
  // Target selection state
  let selectedLayerIdx = $state<number | null>(null);
  let selectedNeuronIdx = $state<number | null>(null);
  let selectedNeuronType = $state<'attention' | 'ffn' | null>(null);
  // For attention heads: source = "who is attending", target = "what is being attended to"
  // For FFN neurons: only target_input_part is used (source doesn't apply)
  let selectedSourceInputPart = $state<'cls' | 'query' | 'sep_1' | 'document' | 'sep_2' | null>(null);
  let selectedTargetInputPart = $state<'cls' | 'query' | 'sep_1' | 'document' | 'sep_2' | null>(null);
  
  // Computation state
  let isComputing = $state(false);
  let isNigProcessing = $state(false);
  let progress = $state(0);
  let computedResult = $state<any>(null);
  let errorMessage = $state<string | null>(null);
  
  // Conditional mode state
  let isInConditionalMode = $state(false);
  
  // Subscription cleanup
  let subscriptions: any[] = [];
  
  // Full reset of panel to fresh state (exported for external calls)
  export function resetPanel() {
    console.log('[CONDITIONAL NIG] Resetting panel to fresh state');
    isInConditionalMode = false;
    computedResult = null;
    selectedLayerIdx = null;
    selectedNeuronIdx = null;
    selectedNeuronType = null;
    selectedSourceInputPart = null;
    selectedTargetInputPart = null;
    cursorActive = false;
    errorMessage = null;
    progress = 0;
    // Also clear service's target selection
    nigConnection.conditionalTarget = null;
  }
  
  // Save current target selection to service (for persistence across panel switches)
  function saveTargetToService() {
    if (selectedLayerIdx !== null && selectedNeuronIdx !== null && selectedNeuronType !== null) {
      nigConnection.conditionalTarget = {
        layerIdx: selectedLayerIdx,
        neuronIdx: selectedNeuronIdx,
        neuronType: selectedNeuronType,
        sourceInputPart: selectedSourceInputPart,
        targetInputPart: selectedTargetInputPart
      };
    } else {
      nigConnection.conditionalTarget = null;
    }
  }
  
  // Restore target selection from service
  function restoreTargetFromService() {
    const target = nigConnection.conditionalTarget;
    if (target) {
      selectedLayerIdx = target.layerIdx;
      selectedNeuronIdx = target.neuronIdx;
      selectedNeuronType = target.neuronType;
      selectedSourceInputPart = target.sourceInputPart ?? null;
      selectedTargetInputPart = target.targetInputPart ?? null;
      console.log('[CONDITIONAL NIG] Restored target from service:', target);
    }
  }
  
  onMount(() => {
    // Restore target selection from service if available
    restoreTargetFromService();
    
    // Subscribe to regular NIG status to disable compute button
    const nigStatusSub = nigConnection.nigStatus$.subscribe((status: any) => {
      if (status) {
        isNigProcessing = status.status === 'processing' || status.status === 'pending';
      }
    });
    subscriptions.push(nigStatusSub);
    
    // Subscribe to main NIG data stream to reset UI when new NIG/snapshot arrives
    // Skip first emission (existing data) to avoid resetting on panel switch
    let isFirstEmission = true;
    const mainNigDataSub = nigConnection.nigModelInstance.$data.subscribe((doc: any) => {
      if (isFirstEmission) {
        isFirstEmission = false;
        return;
      }
      // Reset panel when non-conditional data arrives (new computation, snapshot load)
      // Skip restored data (handled by Restore Original button) and conditional data
      if (doc && doc.result && !doc.__isConditional && !doc.__restored) {
        resetPanel();
      }
    });
    subscriptions.push(mainNigDataSub);
    
    // Subscribe to conditional NIG results
    const dataSub = nigConnection.conditionalNigData$.subscribe((doc: any) => {
      if (doc && doc.result) {
        // Only process if:
        // 1. We're actively computing (fresh result from our computation), OR
        // 2. We're in conditional mode (service says so - e.g., restoring state)
        // This prevents re-applying old cached conditional results when panel is recreated
        // after the user has computed new NIG or loaded a snapshot
        if (!isComputing && !nigConnection.isConditionalMode) {
          console.log('[CONDITIONAL NIG] Ignoring stale conditional data - not computing and not in conditional mode');
          return;
        }
        
        computedResult = doc.result;
        isComputing = false;
        progress = 1;
        console.log('[CONDITIONAL NIG] Result received:', doc.result);
        
        // Automatically apply the conditional NIG to the visualization
        applyConditionalNig();
      } else if (doc && doc.status === 'error') {
        errorMessage = doc.data || 'An error occurred';
        isComputing = false;
      }
    });
    subscriptions.push(dataSub);
    
    const statusSub = nigConnection.conditionalNigStatus$.subscribe((status: string) => {
      if (status === 'processing') {
        isComputing = true;
        errorMessage = null;
      } else if (status === 'success') {
        isComputing = false;
      } else if (status === 'error') {
        isComputing = false;
      }
    });
    subscriptions.push(statusSub);
  });
  
  onDestroy(() => {
    // Save current target selection before panel is destroyed (for panel switch persistence)
    saveTargetToService();
    subscriptions.forEach(sub => sub?.unsubscribe?.());
  });
  
  // Set target from external click (architecture or table)
  export function setTarget(layerIdx: number, neuronIdx: number, neuronType: 'attention' | 'ffn') {
    selectedLayerIdx = layerIdx;
    selectedNeuronIdx = neuronIdx;
    selectedNeuronType = neuronType;
    computedResult = null;
    errorMessage = null;
    // Persist to service for panel switch persistence
    saveTargetToService();
    console.log('[CONDITIONAL NIG] Target set:', { layerIdx, neuronIdx, neuronType });
  }
  
  // Compute conditional NIG
  function computeConditionalNig() {
    if (selectedLayerIdx === null || selectedNeuronIdx === null || selectedNeuronType === null) {
      errorMessage = 'Please select a target neuron first';
      return;
    }
    
    if (!currentQuery || !currentPassage) {
      errorMessage = 'Query and passage are required';
      return;
    }
    
    // Save original NIG data before computing conditional
    const currentNigData = nigConnection.nigModelInstance.$data.getValue();
    if (currentNigData && currentNigData.result && !currentNigData.__isConditional) {
      nigConnection.saveOriginalNigData(currentNigData.result, currentThreshold);
    }
    
    isComputing = true;
    progress = 0;
    errorMessage = null;
    
    nigConnection.submitConditionalNIG({
      query: currentQuery,
      passage: currentPassage,
      numReps: numReps,
      layerIdx: selectedLayerIdx,
      neuronIdx: selectedNeuronIdx,
      neuronType: selectedNeuronType,
      sourceInputPart: selectedNeuronType === 'attention' ? selectedSourceInputPart : null,
      targetInputPart: selectedTargetInputPart,
    });
  }
  
  // Apply computed conditional NIG to the visualization
  function applyConditionalNig() {
    if (!computedResult) return;
    
    nigConnection.enterConditionalMode(computedResult);
    isInConditionalMode = true;
    cursorActive = false; // Disable cursor after applying
  }
  
  // Restore original NIG values
  function restoreOriginalNig() {
    // Restore threshold if saved
    const originalThreshold = nigConnection.getOriginalThreshold();
    if (originalThreshold !== null && onThresholdChange) {
      onThresholdChange(originalThreshold);
    }
    
    nigConnection.exitConditionalMode();
    isInConditionalMode = false;
    computedResult = null;
    // Keep target selection in case user wants to try another computation
  }
  
  // Clear selection and exit conditional mode
  function clearSelection() {
    if (isInConditionalMode) {
      restoreOriginalNig();
    }
    selectedLayerIdx = null;
    selectedNeuronIdx = null;
    selectedNeuronType = null;
    selectedSourceInputPart = null;
    selectedTargetInputPart = null;
    computedResult = null;
    errorMessage = null;
    cursorActive = false;
  }
  
  // Check if we have a valid target selected
  const hasValidTarget = $derived(
    selectedLayerIdx !== null && 
    selectedNeuronIdx !== null && 
    selectedNeuronType !== null
  );
  
  // Format target description
  const targetDescription = $derived(() => {
    if (!hasValidTarget) return 'No target selected';
    const typeLabel = selectedNeuronType === 'attention' ? 'Attention Head' : 'FFN Neuron';
    return `Layer ${selectedLayerIdx}, ${typeLabel} ${selectedNeuronIdx}`;
  });
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Conditional Mode Banner -->
      {#if isInConditionalMode}
        <div class="alert alert-info text-xs py-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>Viewing Conditional NIG - layers after target are greyed out</span>
        </div>
      {/if}

      <!-- Cursor Toggle Button -->
      <div class="flex items-center justify-center py-2">
        <button 
          class="btn btn-circle btn-lg"
          class:btn-primary={cursorActive}
          class:btn-ghost={!cursorActive}
          onclick={() => cursorActive = !cursorActive}
          aria-label="Toggle Conditional NIG cursor"
          disabled={isInConditionalMode}
        >
          <!-- MagnifyingGlassIcon -->
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </button>
      </div>

      <p class="text-xs text-center text-base-content/70">
        {#if isInConditionalMode}
          Conditional NIG applied. Click "Restore Original" to go back.
        {:else if cursorActive}
          Click on architecture or table to select target neuron
        {:else}
          Click the icon to activate cursor mode
        {/if}
      </p>

      <div class="divider my-2"></div>

      <!-- Target Selection Summary -->
      <div class="space-y-2">
        <div class="py-0">
          <span class="text-sm font-semibold">Selected Target</span>
        </div>

        {#if hasValidTarget}
          <div class={`rounded-lg p-3 space-y-1 ${isInConditionalMode ? 'bg-info/10' : 'bg-primary/10'}`}>
            <div class="text-sm font-medium">{targetDescription()}</div>
            <div class="flex flex-wrap gap-1 text-xs text-base-content/70">
              <span class="badge badge-sm badge-outline">Layer {selectedLayerIdx}</span>
              <span class="badge badge-sm badge-outline">{selectedNeuronType === 'attention' ? 'ATTN' : 'FFN'}</span>
              <span class="badge badge-sm badge-outline">#{selectedNeuronIdx}</span>
            </div>
            {#if isInConditionalMode}
              <div class="text-xs text-info mt-1">
                Showing attributions for layers 0-{selectedLayerIdx}
              </div>
            {/if}
          </div>
        {:else}
          <div class="text-xs text-base-content/50 py-2 text-center bg-base-200 rounded-lg">
            No target selected. Enable cursor mode and click on a neuron.
          </div>
        {/if}
      </div>

      <!-- Input Part Filters (only show when not in conditional mode) -->
      {#if !isInConditionalMode}
        <div class="space-y-3">
          <!-- Source Input Part (only for attention heads) -->
          {#if selectedNeuronType === 'attention'}
            <div class="space-y-1">
              <label for="source-input-part-select" class="text-sm font-medium">
                Attending From (Source)
                <span class="text-xs text-base-content/60 font-normal block">Which tokens are doing the attending</span>
              </label>
              <select 
                id="source-input-part-select"
                class="select select-bordered select-sm w-full"
                bind:value={selectedSourceInputPart}
              >
                <option value={null}>All Tokens</option>
                <option value="cls">[CLS]</option>
                <option value="query">Query</option>
                <option value="sep_1">[SEP] (first)</option>
                <option value="document">Document</option>
                <option value="sep_2">[SEP] (last)</option>
              </select>
            </div>
          {/if}

          <!-- Target Input Part -->
          <div class="space-y-1">
            <label for="target-input-part-select" class="text-sm font-medium">
              {#if selectedNeuronType === 'attention'}
                Attending To (Target)
                <span class="text-xs text-base-content/60 font-normal block">Which tokens are being attended to</span>
              {:else}
                Focus on Input Part
                <span class="text-xs text-base-content/60 font-normal block">Which tokens to focus the FFN activation on</span>
              {/if}
            </label>
            <select 
              id="target-input-part-select"
              class="select select-bordered select-sm w-full"
              bind:value={selectedTargetInputPart}
            >
              <option value={null}>All Tokens</option>
              <option value="cls">[CLS]</option>
              <option value="query">Query</option>
              <option value="sep_1">[SEP] (first)</option>
              <option value="document">Document</option>
              <option value="sep_2">[SEP] (last)</option>
            </select>
          </div>

          <!-- Help text for attention pattern selection -->
          {#if selectedNeuronType === 'attention' && (selectedSourceInputPart || selectedTargetInputPart)}
            <div class="text-xs text-info bg-info/10 rounded p-2">
              {#if selectedSourceInputPart && selectedTargetInputPart}
                Analyzing: <strong>{selectedSourceInputPart}</strong> → <strong>{selectedTargetInputPart}</strong>
              {:else if selectedSourceInputPart}
                Analyzing: <strong>{selectedSourceInputPart}</strong> → all tokens
              {:else if selectedTargetInputPart}
                Analyzing: all tokens → <strong>{selectedTargetInputPart}</strong>
              {/if}
            </div>
          {/if}
        </div>

        <div class="divider my-2"></div>
      {/if}

      <!-- Action Buttons -->
      {#if isInConditionalMode}
        <!-- Restore Original Button (Primary action in conditional mode) -->
        <button 
          class="btn btn-warning btn-block"
          onclick={restoreOriginalNig}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
          Restore Original NIG
        </button>
        
        <p class="text-xs text-center text-base-content/60">
          Returns to the full NIG visualization
        </p>
      {:else}
        <!-- Compute Button -->
        <button 
          class="btn btn-primary btn-block"
          disabled={!hasValidTarget || isComputing || !hasNigData || isNigProcessing}
          onclick={computeConditionalNig}
        >
          {#if isComputing}
            <span class="loading loading-spinner loading-sm"></span>
            Computing...
          {:else}
            Compute Conditional NIG
          {/if}
        </button>
        
        {#if !hasNigData}
          <p class="text-xs text-warning text-center">
            Run standard NIG first
          </p>
        {:else if isNigProcessing}
          <p class="text-xs text-warning text-center">
            Wait for NIG computation to finish
          </p>
        {/if}
      {/if}

      <!-- Error Message -->
      {#if errorMessage}
        <div class="alert alert-error text-xs py-2">
          <span>{errorMessage}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
