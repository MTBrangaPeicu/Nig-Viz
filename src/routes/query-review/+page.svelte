<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { get } from 'svelte/store';
  import { getSharedInputComponents, sharedBaseline } from '$lib/stores';
  import { nigConnection } from '$lib/services/nig-connection';

  // Get shared Marcelle components (same instances as main page)
  const sharedInputs = getSharedInputComponents();
  let queryInput = sharedInputs.queryInput;
  let passageInput = sharedInputs.passageInput;
  let passageInput2 = sharedInputs.passageInput2;
  let numRepsInput = sharedInputs.numRepsInput;
  let subsetButtonsComponent = sharedInputs.subsetButtons;

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

  // Baseline synced with shared store
  let baseline = $state(get(sharedBaseline));

  const baselineOptions = [
    'Only Padded Tokens',
    'Padded Query and Passage (Special Tokens Preserved)',
    'Padded Query (Special Tokens Preserved)',
  ];

  let igOutput = $state('');
  let isProcessing = $state(false);

  // Sync baseline changes to store
  $effect(() => {
    sharedBaseline.set(baseline);
  });

  // Color function for attribution visualization (from Nig-Viz index.js lines 421-432)
  function getColor(attr: number): string {
    let r, g, b;
    if (attr > 0) {
      g = Math.min(255, 128 + Math.floor(127 * attr));
      b = Math.min(255, 128 - Math.floor(64 * attr));
      r = Math.min(255, 128 - Math.floor(64 * attr));
    } else {
      g = Math.min(255, 128 + Math.floor(64 * attr));
      b = Math.min(255, 128 + Math.floor(64 * attr));
      r = Math.min(255, 127 - Math.floor(128 * attr));
    }
    return `rgb(${r},${g},${b})`;
  }

  // Mount shared components using $effect for proper reactivity
  $effect(() => {
    if (queryContainer && queryInput && !queryUnmount) {
      queryUnmount = queryInput.mount(queryContainer);
    }
  });

  $effect(() => {
    if (passageContainer && passageInput && !passageUnmount) {
      passageUnmount = passageInput.mount(passageContainer);
    }
  });

  // Passage 2 is hidden - not mounted

  $effect(() => {
    if (numRepsContainer && numRepsInput && !numRepsUnmount) {
      numRepsUnmount = numRepsInput.mount(numRepsContainer);
    }
  });

  $effect(() => {
    if (subsetContainer && subsetButtonsComponent && !subsetUnmount) {
      subsetUnmount = subsetButtonsComponent.mount(subsetContainer);
    }
  });

  onMount(() => {
    // Initialize baseline from shared store
    const unsubBaseline = sharedBaseline.subscribe((val) => {
      if (val) baseline = val;
    });

    // Subscribe to dataset service updates
    const datasetSub = nigConnection.datasetService.on(
      'patched',
      (doc: any) => {
        if (doc.status === 'success' && doc.samples) {
          const queries = doc.samples.map((sample: any) => sample.query);
          queryInput.updateOptions(queries);
          queryInput.samples = doc.samples;
          nigConnection.samplesReady = true;

          // Auto-select first query
          try {
            const current =
              queryInput.$value && queryInput.$value.getValue
                ? queryInput.$value.getValue()
                : '';
            
            // Only set a value if current is empty
            if (!current || !current.trim()) {
              const chosen = queries[0] || '';
              if (chosen) {
                queryInput.$value.next(chosen);
              }
            }
            
            // Update passages for the current query (whether user-typed or from list)
            const queryToUse = current && current.trim() ? current : queryInput.$value.getValue();
            const selectedSample = doc.samples.find(
              (s: any) => s.query === queryToUse,
            );
            if (selectedSample) {
              const passages = selectedSample.passages.map(
                (p: any) => p.text,
              );
              passageInput.updateOptions(passages);
              passageInput2.updateOptions(passages);
            }
          } catch {}
        }

        // Update subset button options
        if (doc.status === 'success' && Array.isArray(doc.levels)) {
          const opts = [...doc.levels.map((l: number) => `Rel=${l}`), 'Random'];
          subsetButtonsComponent.setOptions(opts);
        }

        // Update passages for specific query
        if (doc.status === 'success' && Array.isArray(doc.passages)) {
          const passages = doc.passages.map((p: any) => p.text);
          passageInput.updateOptions(passages);
          passageInput2.updateOptions(passages);
        }
      },
    );

    // Subscribe to subset button changes
    const subsetSub = subsetButtonsComponent.$value.subscribe(
      (subset: string) => {
        if (!subset) return;
        const currentQuery = queryInput.$value.getValue();
        if (nigConnection.selectedQueryId) {
          nigConnection.requestSamples({
            subset,
            query_id: nigConnection.selectedQueryId,
          });
        } else {
          nigConnection.requestSamples({ n: 10, subset });
        }
      },
    );

    // Subscribe to query changes
    const querySub = queryInput.$value.subscribe((query: string) => {
      if (!query || !queryInput.samples) return;
      const selectedSample = queryInput.samples.find(
        (s: any) => s.query === query,
      );
      if (selectedSample) {
        nigConnection.selectedQueryId = selectedSample.query_id;
        const passages = selectedSample.passages.map((p: any) => p.text);
        passageInput.updateOptions(passages);
        passageInput2.updateOptions(passages);

        // Only auto-select passage if current passage is empty
        const currentPassage = passageInput.$value.getValue();
        if (passages.length > 0 && (!currentPassage || !currentPassage.trim())) {
          passageInput.$value.next(passages[0]);
        }
      }
    });

    // Subscribe to IG results (from Nig-Viz index.js lines 482-495)
    const igDataSub = nigConnection.igData$.subscribe((doc: any) => {
      if (!doc || !doc.result) return;

      if (doc.result.tokens && doc.result.attributions) {
        const { tokens, attributions, error } = doc.result;
        const html = tokens
          .map((token: string, i: number) => {
            const color = getColor(attributions[i]);
            return `<span style="color:${color}" title="${attributions[i].toFixed(4)}">${token}</span>`;
          })
          .join(' ');
        igOutput = `${html}<br><br>Baseline Error: ${error?.toFixed(4) ?? 'N/A'}`;
      }
    });

    // Subscribe to IG status
    const igStatusSub = nigConnection.igStatus$.subscribe((status: any) => {
      if (status) {
        isProcessing = status.status === 'processing';
      }
    });

    // Only request samples if shared components don't have data yet
    if (!queryInput.samples || queryInput.samples.length === 0) {
      nigConnection.requestSamples({ n: 10, subset: 'Random' });
    }

    return () => {
      unsubBaseline();
      querySub.unsubscribe();
      subsetSub.unsubscribe();
      igDataSub.unsubscribe();
      igStatusSub.unsubscribe();
    };
  });

  onDestroy(() => {
    // Unmount components from DOM (their state is preserved in the singleton BehaviorSubjects)
    if (queryUnmount) queryUnmount();
    if (passageUnmount) passageUnmount();
    if (numRepsUnmount) numRepsUnmount();
    if (subsetUnmount) subsetUnmount();
  });

  function handleSubmitIG() {
    nigConnection.submitIG({
      query: queryInput.$value.getValue(),
      passage: passageInput.$value.getValue(),
      passage2: passageInput2.$value.getValue(),
      numReps: numRepsInput.$value.getValue(),
      baselineLabel: baseline,
    });
  }

  function goBack() {
    // Use SvelteKit navigation to preserve app state
    goto(`${base}/`);
  }
</script>

<svelte:head>
  <title>Query Review Dashboard</title>
</svelte:head>

<!-- Full-screen layout matching main app -->
<div class="fixed inset-0 bg-base-200 flex flex-col">
  <!-- Top Bar with heading and back button -->
  <div
    class="flex-shrink-0 bg-base-300 border-b border-base-content/10 px-4 py-2 flex items-center gap-4"
  >
    <button class="btn btn-ghost btn-sm" onclick={goBack}> ← Back </button>
    <h1 class="text-lg font-semibold">Query Review</h1>
  </div>

  <!-- Main Content Area -->
  <div class="flex-1 overflow-hidden flex">
    <!-- Left Panel: Inputs (similar to InputPanel) -->
    <div
      class="w-80 flex-shrink-0 bg-base-100 border-r border-base-300 overflow-y-auto"
    >
      <div class="p-4 space-y-4">
        <!-- Query Input -->
        <div class="marcelle-component">
          <div bind:this={queryContainer}></div>
        </div>

        <!-- Passage Input 1 -->
        <div class="marcelle-component">
          <div bind:this={passageContainer}></div>
        </div>

        <!-- Passage Input 2 - Disabled until backend supports 2 passages -->
        <!-- <div class="marcelle-component">
          <div bind:this={passage2Container}></div>
        </div> -->

        <!-- Subset Selection -->
        <div class="marcelle-component">
          <div bind:this={subsetContainer}></div>
        </div>

        <!-- Number of Repetitions -->
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

        <!-- Action Button -->
        <button
          class="btn btn-primary btn-block btn-sm"
          class:btn-disabled={isProcessing}
          onclick={handleSubmitIG}
        >
          {isProcessing ? 'Calculating...' : 'Calculate Token IG'}
        </button>
      </div>
    </div>

    <!-- Right Panel: Results/Output -->
    <div class="flex-1 overflow-auto bg-base-100">
      <div class="p-6">
        <div class="flex items-center gap-2 mb-4 border-b border-base-300 pb-2">
          <h2 class="text-sm font-semibold text-base-content/70">
            Token IG Results
          </h2>
        </div>

        {#if !igOutput}
          <div class="text-sm text-base-content/60">
            Submit a query and passage to see token-level integrated gradients
            visualization.
          </div>
          <div class="mt-4 p-4 bg-base-200 border border-base-300 rounded">
            <p class="text-sm text-base-content/60">
              Results will appear here after calculation.
            </p>
          </div>
        {:else}
          <div class="p-4 bg-base-200 border border-base-300 rounded">
            <div class="text-base leading-relaxed">
              {@html igOutput}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  @reference "../../app.css";

  :global(.marcelle-component) {
    @apply mb-4;
  }
</style>
