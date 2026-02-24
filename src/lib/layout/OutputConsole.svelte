<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as widgets from '@marcellejs/gui-widgets';
  import type { NIGConnection } from '$lib/services/nig-connection';
  import type { BehaviorSubject } from 'rxjs';
  
  interface PruningState {
    enabled: boolean;
    rules: any[];
    targets: any[];
    edges: any[];
    thresholds: { attention?: number; ffn?: number };
  }
  
  interface Props {
    connection?: NIGConnection;
    statusStream?: any; // RxJS Observable from nigModelInstance.$status
    conditionalStatusStream?: any; // RxJS Observable from conditionalNigModelInstance.$status
    forwardPassStatusStream?: any; // RxJS Observable from forwardPassModelInstance.$status
    prunedForwardPassStatusStream?: any; // RxJS Observable from prunedForwardPassModelInstance.$status
    igStatusStream?: any; // RxJS Observable from igModelInstance.$status
    pruningState$?: BehaviorSubject<PruningState>;
  }

  let { 
    connection,
    statusStream,
    conditionalStatusStream,
    forwardPassStatusStream,
    prunedForwardPassStatusStream,
    igStatusStream,
    pruningState$
  }: Props = $props();

  // Create Marcelle button instances
  const submitForwardPass = widgets.button('Forward Pass');
  const submitPrunedForwardPass = widgets.button('Pruned Forward Pass');
  
  let isProcessing = $state(false);
  let statusMessage = $state('Ready');
  let progress = $state(0);
  let subscription: any = null;
  
  // Forward pass results
  let forwardRelevance = $state('');
  let forwardConfidence = $state('');
  let forwardDetails = $state('');
  
  // Pruned forward pass results
  let prunedRelevance = $state('');
  let prunedConfidence = $state('');
  let prunedDetails = $state('');
  
  let forwardPassSub: any = null;
  let prunedForwardPassSub: any = null;
  let forwardClickSub: any = null;
  let prunedClickSub: any = null;
  let conditionalStatusSub: any = null;
  let forwardPassStatusSub: any = null;
  let prunedForwardPassStatusSub: any = null;
  let igStatusSub: any = null;
  
  onMount(() => {
    if (statusStream) {
      subscription = statusStream.subscribe((status: any) => {
        console.log('Status update:', status);
        if (status) {
          statusMessage = status.message || status.status || 'Ready';
          isProcessing = status.status === 'processing' || status.status === 'pending';
          
          // Calculate progress from backend progress field (0-1) or message pattern
          if (status.status === 'processing') {
            // Backend sends progress as decimal 0-1
            if (typeof status.progress === 'number') {
              progress = Math.round(status.progress * 100);
              console.log('Progress from field:', progress);
            } else if (status.message) {
              // Fallback: try to extract from message pattern "X/Y"
              const match = status.message.match(/(\d+)\/(\d+)/);
              if (match) {
                const current = parseInt(match[1]);
                const total = parseInt(match[2]);
                progress = Math.round((current / total) * 100);
                console.log('Progress from message:', progress);
              } else {
                progress = 50;
              }
            }
          } else if (status.status === 'success') {
            progress = 100;
          } else {
            progress = 0;
          }
        }
      });
    }

    // Subscribe to forward pass results
    if (connection) {
      forwardPassSub = connection.forwardPassData$.subscribe((doc: any) => {
        console.log('[OUTPUT CONSOLE] Forward pass result:', doc);
        
        if (!doc || !doc.result) {
          forwardRelevance = '';
          forwardConfidence = '';
          forwardDetails = '';
          return;
        }

        console.log('[OUTPUT CONSOLE] Forward pass result details:', doc.result);
        
        const { logits, probabilities, label } = doc.result;
        const logitValue = Array.isArray(logits) && Array.isArray(logits[0]) ? logits[0][0] : logits;
        const probValue = Array.isArray(probabilities) && Array.isArray(probabilities[0]) ? probabilities[0][0] : probabilities;
        
        console.log('[OUTPUT CONSOLE] Parsed values - label:', label, 'logit:', logitValue, 'prob:', probValue);
        
        // Map numeric label to human-readable text
        const labelText = label === 1 ? 'Relevant' : label === 0 ? 'Not Relevant' : 'Unknown';
        
        // Confidence is how certain the model is about its prediction
        // For label=1 (relevant): confidence = probability
        // For label=0 (not relevant): confidence = 1 - probability
        const confidence = label === 1 ? probValue : (1 - probValue);
        
        forwardRelevance = labelText;
        forwardConfidence = ((confidence || 0) * 100).toFixed(1);
        forwardDetails = `Logit: ${typeof logitValue === 'number' ? logitValue.toFixed(4) : logitValue}`;
      });

      prunedForwardPassSub = connection.prunedForwardPassData$.subscribe((doc: any) => {
        console.log('[OUTPUT CONSOLE] Pruned forward pass result:', doc);
        
        if (!doc || !doc.result) {
          prunedRelevance = '';
          prunedConfidence = '';
          prunedDetails = '';
          return;
        }

        const { logits, probabilities, label } = doc.result;
        const logitValue = Array.isArray(logits) && Array.isArray(logits[0]) ? logits[0][0] : logits;
        const probValue = Array.isArray(probabilities) && Array.isArray(probabilities[0]) ? probabilities[0][0] : probabilities;
        
        // Map numeric label to human-readable text
        const labelText = label === 1 ? 'Relevant' : label === 0 ? 'Not Relevant' : 'Unknown';
        
        // Confidence is how certain the model is about its prediction
        // For label=1 (relevant): confidence = probability
        // For label=0 (not relevant): confidence = 1 - probability
        const confidence = label === 1 ? probValue : (1 - probValue);
        
        prunedRelevance = labelText;
        prunedConfidence = ((confidence || 0) * 100).toFixed(1);
        prunedDetails = `Logit: ${typeof logitValue === 'number' ? logitValue.toFixed(4) : logitValue}`;
      });
    }

    // Subscribe to conditional NIG status for progress updates
    if (conditionalStatusStream) {
      conditionalStatusSub = conditionalStatusStream.subscribe((status: any) => {
        console.log('[OUTPUT CONSOLE] Conditional status update:', status);
        if (status) {
          statusMessage = status.message || status.status || 'Ready';
          isProcessing = status.status === 'processing' || status.status === 'pending';
          
          if (status.status === 'processing') {
            if (typeof status.progress === 'number') {
              progress = Math.round(status.progress * 100);
            } else if (status.message) {
              const match = status.message.match(/(\d+)\/(\d+)/);
              if (match) {
                const current = parseInt(match[1]);
                const total = parseInt(match[2]);
                progress = Math.round((current / total) * 100);
              } else {
                progress = 50;
              }
            }
          } else if (status.status === 'success') {
            progress = 100;
          }
        }
      });
    }

    // Subscribe to forward pass status
    if (forwardPassStatusStream) {
      forwardPassStatusSub = forwardPassStatusStream.subscribe((status: any) => {
        console.log('[OUTPUT CONSOLE] Forward pass status update:', status);
        if (status) {
          statusMessage = status.message || status.status || 'Ready';
          isProcessing = status.status === 'processing' || status.status === 'pending';
          
          if (status.status === 'success') {
            progress = 100;
          } else if (status.status === 'processing') {
            progress = 50; // No progress reporting for forward pass
          } else {
            progress = 0;
          }
        }
      });
    }

    // Subscribe to pruned forward pass status
    if (prunedForwardPassStatusStream) {
      prunedForwardPassStatusSub = prunedForwardPassStatusStream.subscribe((status: any) => {
        console.log('[OUTPUT CONSOLE] Pruned forward pass status update:', status);
        if (status) {
          statusMessage = status.message || status.status || 'Ready';
          isProcessing = status.status === 'processing' || status.status === 'pending';
          
          if (status.status === 'success') {
            progress = 100;
          } else if (status.status === 'processing') {
            progress = 50; // No progress reporting for pruned forward pass
          } else {
            progress = 0;
          }
        }
      });
    }

    // Subscribe to IG (token integrated gradients) status
    if (igStatusStream) {
      igStatusSub = igStatusStream.subscribe((status: any) => {
        console.log('[OUTPUT CONSOLE] IG status update:', status);
        if (status) {
          statusMessage = status.message || status.status || 'Ready';
          isProcessing = status.status === 'processing' || status.status === 'pending';
          
          if (status.status === 'success') {
            progress = 100;
          } else if (status.status === 'processing') {
            if (typeof status.progress === 'number') {
              progress = Math.round(status.progress * 100);
            } else {
              progress = 50;
            }
          } else {
            progress = 0;
          }
        }
      });
    }

    // Subscribe to button clicks
    forwardClickSub = submitForwardPass.$click.subscribe(() => {
      handleForwardPass();
    });

    prunedClickSub = submitPrunedForwardPass.$click.subscribe(() => {
      handlePrunedForwardPass();
    });
  });
  
  onDestroy(() => {
    if (subscription) subscription.unsubscribe();
    if (forwardPassSub) forwardPassSub.unsubscribe();
    if (prunedForwardPassSub) prunedForwardPassSub.unsubscribe();
    if (forwardClickSub) forwardClickSub.unsubscribe();
    if (prunedClickSub) prunedClickSub.unsubscribe();
    if (conditionalStatusSub) conditionalStatusSub.unsubscribe();
    if (forwardPassStatusSub) forwardPassStatusSub.unsubscribe();
    if (prunedForwardPassStatusSub) prunedForwardPassStatusSub.unsubscribe();
    if (igStatusSub) igStatusSub.unsubscribe();
  });

  function handleForwardPass() {
    if (!connection || !connection.lastNIGRequestInputs) {
      alert('Please run NIG calculation first');
      return;
    }
    
    // Prevent submission if already processing
    if (isProcessing) {
      console.log('[OUTPUT CONSOLE] Operation in progress, ignoring click');
      return;
    }
    
    const inputs = connection.lastNIGRequestInputs;
    const passage = inputs.passage + (inputs.passage2 ? (' \n\n' + inputs.passage2) : '');
    connection.submitForwardPass(inputs.query, passage);
  }

  function handlePrunedForwardPass() {
    if (!connection || !connection.lastNIGRequestInputs) {
      alert('Please run NIG calculation first');
      return;
    }
    
    // Check if in conditional mode
    if (connection.isConditionalMode) {
      alert('Cannot run pruned forward pass in conditional NIG mode. Please exit conditional mode first.');
      return;
    }
    
    // Prevent submission if already processing
    if (isProcessing) {
      console.log('[OUTPUT CONSOLE] Operation in progress, ignoring click');
      return;
    }
    
    const nigDoc = connection.nigData$.getValue();
    if (!nigDoc || !nigDoc.result || !nigDoc.result.subset_b) {
      alert('No NIG data available. Please run NIG calculation first.');
      return;
    }

    const inputs = connection.lastNIGRequestInputs;
    const passage = inputs.passage + (inputs.passage2 ? (' \n\n' + inputs.passage2) : '');
    
    // Get current pruning state from the architecture component
    const pruningState = pruningState$?.getValue() || { 
      enabled: false, 
      rules: [], 
      targets: [], 
      edges: [],
      thresholds: { attention: 0, ffn: 0 } 
    };
    
    console.log('[OUTPUT CONSOLE] Submitting pruned forward pass with state:', pruningState);
    
    connection.submitPrunedForwardPass({
      query: inputs.query,
      passage,
      nigId: nigDoc._id,  // Pass NIG ID for database lookup
      attentionThreshold: pruningState.thresholds?.attention || 0,
      ffnThreshold: pruningState.thresholds?.ffn || 0,
      pruningEnabled: pruningState.rules.length > 0 || pruningState.targets.length > 0 || pruningState.edges.length > 0,
      pruningRules: pruningState.rules || [],
      pruningTargets: pruningState.targets || [],
      pruningEdges: pruningState.edges || [],
    });
  }
</script>

<div class="h-16 bg-base-100 border-t border-base-300 flex items-center px-4 gap-8 flex-shrink-0">
  <!-- Status indicator (left side) -->
  <div class="flex items-center gap-2">
    <div 
      class="radial-progress text-primary"
      style="--value:{isProcessing ? progress : 100}; --size:2rem; --thickness:2px;" 
      role="progressbar"
    >
      <span class="text-[10px] font-medium">{isProcessing ? progress + '%' : '✓'}</span>
    </div>
    <span class="text-xs text-base-content/70">{statusMessage}</span>
  </div>

  <!-- Forward Pass Section (right side) -->
  <div class="ml-auto flex items-center gap-3">
    <div class="marcelle-button-styled" class:disabled={isProcessing || connection?.isConditionalMode}>
      <div use:submitForwardPass.mount></div>
    </div>
    {#if forwardRelevance && forwardConfidence}
      <div class="tooltip tooltip-top" data-tip={forwardDetails}>
        <div class="text-xs cursor-help">
          <span class="font-medium">{forwardRelevance}</span>
          <span class="text-base-content/60 mx-1">·</span>
          <span class="text-base-content/80">{forwardConfidence}%</span>
        </div>
      </div>
    {:else}
      <span class="text-xs text-base-content/40">No result yet</span>
    {/if}
  </div>

  <div class="h-8 w-px bg-base-300"></div>

  <!-- Pruned Pass Section (right side) -->
  <div class="flex items-center gap-3">
    <div class="marcelle-button-styled" class:disabled={isProcessing || connection?.isConditionalMode}>
      <div use:submitPrunedForwardPass.mount></div>
    </div>
    {#if prunedRelevance && prunedConfidence}
      <div class="tooltip tooltip-top" data-tip={prunedDetails}>
        <div class="text-xs cursor-help">
          <span class="font-medium">{prunedRelevance}</span>
          <span class="text-base-content/60 mx-1">·</span>
          <span class="text-base-content/80">{prunedConfidence}%</span>
        </div>
      </div>
    {:else}
      <span class="text-xs text-base-content/40">No result yet</span>
    {/if}
  </div>
</div>

<style>
  :global(.marcelle-button-styled button) {
    /* DaisyUI btn btn-sm btn-outline styles */
    display: inline-flex;
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
  
  /* Disabled state for buttons during processing */
  .marcelle-button-styled.disabled {
    pointer-events: none;
    opacity: 0.5;
  }
</style>