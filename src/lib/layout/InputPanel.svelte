<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { NIGConnection } from '$lib/services/nig-connection';
  
  interface Props {
    visible?: boolean;
    connection?: NIGConnection;
    queryInput?: any;
    passageInput?: any;
    passageInput2?: any;
    numRepsInput?: any;
    subsetButtons?: any;
    baseline?: string;
  }

  let { 
    visible = false, 
    connection,
    queryInput,
    passageInput,
    passageInput2,
    numRepsInput,
    subsetButtons: subsetButtonsComponent,
    baseline = $bindable('Padded Query and Passage (Special Tokens Preserved)')
  }: Props = $props();
  
  // DOM containers
  let queryContainer: HTMLDivElement = $state()!;
  let passageContainer: HTMLDivElement = $state()!;
  let passage2Container: HTMLDivElement = $state()!;
  let numRepsContainer: HTMLDivElement = $state()!;
  let subsetContainer: HTMLDivElement = $state()!;
  
  // Unmount functions
  let queryUnmount: (() => void) | null = null;
  let passageUnmount: (() => void) | null = null;
  let passage2Unmount: (() => void) | null = null;
  let numRepsUnmount: (() => void) | null = null;
  let subsetUnmount: (() => void) | null = null;
  
  const baselineOptions = [
    'Only Padded Tokens',
    'Padded Query and Passage (Special Tokens Preserved)',
    'Padded Query (Special Tokens Preserved)'
  ];
  
  let statusMessage = $state('Ready');
  let isProcessing = $state(false);

  // Use $effect to reactively mount components when they become available
  $effect(() => {
    if (!connection) return;
    
    // Register baseline value accessor with connection for snapshot restoration
    connection.baselineValue = {
      get: () => baseline,
      set: (val: string) => { baseline = val; }
    };
  });
  
  $effect(() => {
    // Explicitly track queryInput as reactive dependency
    const input = queryInput;
    console.log('[INPUT PANEL] queryInput $effect - queryInput:', !!input, 'queryContainer:', !!queryContainer, 'queryUnmount:', !!queryUnmount);
    if (queryContainer && input && !queryUnmount) {
      console.log('[INPUT PANEL] Mounting queryInput');
      queryUnmount = input.mount(queryContainer);
    }
  });
  
  $effect(() => {
    // Explicitly track passageInput as reactive dependency
    const input = passageInput;
    console.log('[INPUT PANEL] passageInput $effect - passageInput:', !!input, 'passageContainer:', !!passageContainer, 'passageUnmount:', !!passageUnmount);
    if (passageContainer && input && !passageUnmount) {
      console.log('[INPUT PANEL] Mounting passageInput');
      passageUnmount = input.mount(passageContainer);
    }
  });
  
  $effect(() => {
    const input = passageInput2;
    if (passage2Container && input && !passage2Unmount) {
      passage2Unmount = input.mount(passage2Container);
    }
  });
  
  $effect(() => {
    const input = numRepsInput;
    if (numRepsContainer && input && !numRepsUnmount) {
      numRepsUnmount = input.mount(numRepsContainer);
    }
  });
  
  $effect(() => {
    const component = subsetButtonsComponent;
    if (subsetContainer && component && !subsetUnmount) {
      subsetUnmount = component.mount(subsetContainer);
    }
  });

  onMount(() => {
    if (!connection) return;

    // Subscribe to NIG status
    const statusSub = connection.nigStatus$.subscribe((status: any) => {
      if (status) {
        statusMessage = status.message || status.status || 'Ready';
        isProcessing = status.status === 'processing';
      }
    });

    return () => {
      statusSub.unsubscribe();
    };
  });

  onDestroy(() => {
    // Components are owned by parent, just unmount them from DOM
    if (queryUnmount) queryUnmount();
    if (passageUnmount) passageUnmount();
    if (passage2Unmount) passage2Unmount();
    if (numRepsUnmount) numRepsUnmount();
    if (subsetUnmount) subsetUnmount();
  });
  
  function handleCalculateNIG() {
    if (!connection || !passageInput) return;
    
    const passage = passageInput.$value.getValue();
    if (!passage) return;
    
    connection.submitNIG({
      query: queryInput.$value.getValue(),
      passage,
      passage2: passageInput2.$value.getValue(),
      numReps: numRepsInput.$value.getValue(),
      baselineLabel: baseline
    });
  }
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Query Input - Marcelle betterText component -->
      <div class="marcelle-component">
        <div bind:this={queryContainer}></div>
      </div>

      <!-- Passage Input 1 - Marcelle betterText component -->
      <div class="marcelle-component">
        <div bind:this={passageContainer}></div>
      </div>

      <!-- Passage Input 2 - Marcelle betterText component -->
      <div class="marcelle-component">
        <div bind:this={passage2Container}></div>
      </div>

      <!-- Subset Selection - Marcelle subsetButtons component -->
      <div class="marcelle-component">
        <div bind:this={subsetContainer}></div>
      </div>

      <!-- Number of Repetitions - Marcelle betterNumber component -->
      <div class="marcelle-component">
        <div bind:this={numRepsContainer}></div>
      </div>

      <!-- Baseline Selection -->
      <div class="form-control">
        <label class="label" for="baseline-select">
          <span class="label-text font-semibold">Baseline</span>
        </label>
        <select 
          id="baseline-select"
          class="select select-bordered select-sm text-sm"
          bind:value={baseline}
        >
          {#each baselineOptions as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="divider"></div>

      <!-- Action Buttons -->
      <div class="space-y-2">
        <button 
          class="btn btn-primary btn-block btn-sm"
          class:btn-disabled={isProcessing}
          onclick={handleCalculateNIG}
        >
          {isProcessing ? 'Calculating...' : 'Calculate NIGs'}
        </button>
        
        <button 
          class="btn btn-outline btn-block btn-sm"
          onclick={() => window.location.href = '/query-review'}
        >
          Query Review Dashboard
        </button>
      </div>
    </div>
  {/if}
</div>
