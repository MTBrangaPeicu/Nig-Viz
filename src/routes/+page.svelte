<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get, writable } from 'svelte/store';
  import { goto, afterNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { Pane, Splitpanes } from 'svelte-splitpanes';
  import { toggle } from '@marcellejs/gui-widgets';
  import {
    IconBar,
    InputPanel,
    NigsPanel,
    ArchitecturePanel,
    PruningPanel,
    ConditionalNigPanel,
    OutputConsole,
  } from '$lib/layout';
  import UserMenu from '$lib/header/UserMenu.svelte';
  import {
    architecture,
    nigtable,
    logThresholdSlider,
    distributionChart,
    ecdfChart,
  } from '$lib/marcelle/components';
  import { nigConnection } from '$lib/services/nig-connection';
  import { snapshotManager } from '$lib/services/nig-snapshots';
  import { pruneSnapshotManager } from '$lib/services/prune-snapshots';
  import {
    nigData,
    selection,
    threshold,
    useAbsoluteValues,
    architectureNodeColors,
    getSharedInputComponents,
    sharedBaseline,
  } from '$lib/stores';
  import { store, isAuthenticated } from '$lib/marcelle/store';

  // Check authentication on mount
  let authChecked = $state(false);

  onMount(async () => {
    try {
      await store.connect();
      // Check if user is authenticated (not anonymous)
      if (!store.user || store.user.role === 'anonymous') {
        goto(`${base}/login`);
        return;
      }
      authChecked = true;

      // Reload snapshot managers now that we're authenticated
      snapshotManager.reload();
      pruneSnapshotManager.reload();

      // Request initial samples now that we're authenticated
      const subset = subsetButtonsComponent.$value.getValue() || 'Random';
      nigConnection.requestSamples({ n: 10, subset });
    } catch (error) {
      // Not authenticated, redirect to login
      goto(`${base}/login`);
    }
  });

  // State for which sidebar panel is active
  let activeSidebarPanel = $state('input'); // Always holds the selected panel ID
  let sidebarPaneSize = $state(20); // Actual size of the sidebar pane (bound to Pane) - open by default after login
  let outputVisible = $state(false);

  // Open sidebar when returning from query-review dashboard
  afterNavigate(({ from }) => {
    if (from?.url?.pathname?.includes('query-review')) {
      sidebarPaneSize = 20;
    }
  });
  let pruningCursorActive = $state(false);
  let conditionalCursorActive = $state(false);
  let conditionalNigPanel: any = $state(null); // Reference to ConditionalNigPanel for setTarget
  let hasNigData = $state(false); // Track if NIG data is loaded
  let currentThresholdValue = $state(0.01); // Track current threshold for conditional mode save/restore
  
  // Token IG results state
  let activeDistributionsTab = $state('charts'); // 'charts' or 'tokenResults'
  let igOutput = $state('');
  
  // Bottom panel popup/maximize state
  let bottomPanelCollapsed = $state(false);
  let topPaneSize = $state(34);
  let bottomPaneSize = $state(66);
  
  // Sync collapsed state when user manually drags the splitpane
  $effect(() => {
    // Consider collapsed if bottom pane is at or near minimum (header-only)
    bottomPanelCollapsed = bottomPaneSize <= 10;
  });
  
  function toggleBottomPanelCollapse() {
    if (bottomPanelCollapsed) {
      // Expand to default sizes
      topPaneSize = 34;
      bottomPaneSize = 66;
    } else {
      // Collapse to header-only (8%)
      topPaneSize = 92;
      bottomPaneSize = 8;
    }
  }
  
  // Architecture zoom state
  let archZoom = $state(1);
  // Fixed architecture natural dimensions: SVG viewBox width=520, height=2038 (slider is outside transform)
  const ARCH_SVG_HEIGHT = 2038;
  const ARCH_SVG_WIDTH = 520;
  let archContentEl: HTMLDivElement = $state()!; // Reference to content


  // Update body class when pruning mode changes
  $effect(() => {
    console.log(
      '[PRUNING] pruningCursorActive changed to:',
      pruningCursorActive,
    );
    if (pruningCursorActive) {
      document.body.classList.add('pruning-mode');
      console.log(
        '[PRUNING] Added pruning-mode class to body. Classes:',
        document.body.className,
      );
    } else {
      document.body.classList.remove('pruning-mode');
      console.log(
        '[PRUNING] Removed pruning-mode class from body. Classes:',
        document.body.className,
      );
    }
  });

  // Update body class when conditional cursor mode changes
  $effect(() => {
    if (conditionalCursorActive) {
      document.body.classList.add('conditional-mode');
      console.log('[CONDITIONAL] Added conditional-mode class to body');
    } else {
      document.body.classList.remove('conditional-mode');
      console.log('[CONDITIONAL] Removed conditional-mode class from body');
    }
  });

  // Deactivate scissors mode when switching away from the relevant tabs
  $effect(() => {
    // When leaving the Pruning tab, deactivate pruning cursor
    if (activeSidebarPanel !== 'pruning' && pruningCursorActive) {
      pruningCursorActive = false;
      console.log('[PAGE] Deactivated pruning cursor mode - switched away from Pruning tab');
    }
    // When leaving the Conditional NIG tab, deactivate conditional cursor
    if (activeSidebarPanel !== 'conditional' && conditionalCursorActive) {
      conditionalCursorActive = false;
      console.log('[PAGE] Deactivated conditional cursor mode - switched away from Conditional tab');
    }
  });

  // Snip animation effect on click in pruning mode
  function createSnipEffect(x: number, y: number) {
    const el = document.createElement('div');
    el.className = 'snip-effect';
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e53935" stroke-width="2">
      <circle cx="6" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>`;
    el.style.left = `${x - 16}px`;
    el.style.top = `${y - 16}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 300);
  }

  // Focus animation effect on click in conditional NIG mode
  function createFocusEffect(x: number, y: number) {
    const el = document.createElement('div');
    el.className = 'focus-effect';
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`;
    el.style.left = `${x - 16}px`;
    el.style.top = `${y - 16}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 300);
  }

  // Global click handler for snip animation
  $effect(() => {
    if (!pruningCursorActive) return;

    const handleClick = (e: MouseEvent) => {
      if (pruningCursorActive) {
        createSnipEffect(e.clientX, e.clientY);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });

  // Global click handler for focus animation
  $effect(() => {
    if (!conditionalCursorActive) return;

    const handleClick = (e: MouseEvent) => {
      if (conditionalCursorActive) {
        createFocusEffect(e.clientX, e.clientY);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });

  // Marcelle component instances (using $state so template bindings update after onMount)
  let archComponent: any = $state(null);
  let tableComponent: any = $state(null);
  let distributionGeneralComponent: any = $state(null);
  let distributionLayerComponent: any = $state(null);
  let ecdfComponent: any = $state(null);
  let thresholdSliderComponent: any = $state(null);

  // Selection panel state (attached to architecture header)
  let selectionPanelVisible = $state(false);
  let selectionAssistEnabled = $state(true); // Toggle to enable/disable selection assist popover
  let currentArchSelection: { source: any; target: any } = $state({ source: null, target: null });
  let currentArchHover: { layer: number; type: string; tokenType: string } | null = $state(null);

  // Detect inverted selection mode: only when hovering same-layer ATTN after clicking FFN
  // In this case, FFN is semantically the TARGET, ATTN is the SOURCE (attention flows down to FFN)
  let isHoverInverted = $derived.by(() => {
    if (!currentArchHover || !currentArchSelection?.source || currentArchSelection?.target) return false;
    const src = currentArchSelection.source;
    const hover = currentArchHover;
    return src.type === 'FFN' && hover.type === 'ATTN' && hover.layer === src.layer;
  });

  // Simple check if hover is a valid target (matches yellow highlighting logic in architecture.view.svelte)
  let isHoverValidTarget = $derived.by(() => {
    if (!currentArchHover || !currentArchSelection?.source || currentArchSelection?.target) return false;
    const src = currentArchSelection.source;
    const hover = currentArchHover;
    
    // Same node = would clear, not valid target
    if (src.layer === hover.layer && src.type === hover.type && src.tokenType === hover.tokenType) return false;
    
    return (
      (src.type === 'ATTN' && hover.type === 'FFN' && hover.layer === src.layer) ||
      (src.type === 'FFN' && hover.type === 'ATTN' && hover.layer === src.layer + 1 && hover.tokenType === src.tokenType) ||
      (src.type === 'FFN' && hover.type === 'ATTN' && hover.layer === src.layer) ||
      (src.type === 'FFN' && src.layer === 11 && hover.type === 'TOP')
    );
  });

  // Check if hover is a normal (non-inverted) valid target: ATTN→FFN, FFN→next-ATTN, FFN→TOP
  let isHoverNormal = $derived.by(() => {
    if (!isHoverValidTarget || !currentArchHover || !currentArchSelection?.source) return false;
    const src = currentArchSelection.source;
    const hover = currentArchHover;
    // Normal cases: ATTN→FFN (same layer), FFN→ATTN (next layer), FFN→TOP
    return (
      (src.type === 'ATTN' && hover.type === 'FFN' && hover.layer === src.layer) ||
      (src.type === 'FFN' && hover.type === 'ATTN' && hover.layer === src.layer + 1) ||
      (src.type === 'FFN' && hover.type === 'TOP')
    );
  });

  // Input panel components (shared across pages for state persistence)
  const sharedInputs = getSharedInputComponents();
  let queryInputComponent = sharedInputs.queryInput;
  let passageInputComponent = sharedInputs.passageInput;
  let passageInput2Component = sharedInputs.passageInput2;
  let numRepsInputComponent = sharedInputs.numRepsInput;
  let subsetButtonsComponent = sharedInputs.subsetButtons;

  // Settings toggle components (created immediately, persist across panel switches)
  let absoluteValuesToggle = toggle(true);
  let architectureColorsToggle = toggle(false);

  // DOM element references  // DOM element references
  let archContainer: HTMLDivElement = $state()!;
  let tableContainer: HTMLDivElement = $state()!;
  let distributionGeneralContainer: HTMLDivElement = $state()!;
  let distributionLayerContainer: HTMLDivElement = $state()!;
  let ecdfContainer: HTMLDivElement = $state()!;
  let thresholdSliderContainer: HTMLDivElement = $state()!;

  // Cleanup functions
  let archUnmount: (() => void) | null = null;
  let tableUnmount: (() => void) | null = null;
  let distributionGeneralUnmount: (() => void) | null = null;
  let distributionLayerUnmount: (() => void) | null = null;
  let ecdfUnmount: (() => void) | null = null;
  let thresholdSliderUnmount: (() => void) | null = null;

  // Track last state for threshold updates
  let lastDistributionGeneralState: any = { values: null, type: null };
  let lastDistributionLayerState: any = { values: null, type: null };
  
  // Table summary info (populated from tableComponent.$options)
  let tableSummary: string = $state('');

  onMount(() => {
    console.log('[PAGE] onMount - Creating architecture components...');
    // Create Marcelle component instances for architecture/visualization
    archComponent = architecture();
    tableComponent = nigtable();
    distributionGeneralComponent = distributionChart();
    distributionLayerComponent = distributionChart();
    ecdfComponent = ecdfChart();
    thresholdSliderComponent = logThresholdSlider(0.5);

    console.log('[PAGE] Architecture components created');

    // Sync pruning state between architecture and table components (bidirectional)
    archComponent.pruningState$.subscribe((state: any) => {
      console.log('[PAGE] Architecture pruningState changed:', state);
      tableComponent.pruningState$.next(state);
    });
    tableComponent.pruningState$.subscribe((state: any) => {
      // Only update if different to avoid infinite loop
      const archState = archComponent.pruningState$.getValue();
      if (JSON.stringify(archState) !== JSON.stringify(state)) {
        console.log('[PAGE] Table pruningState changed:', state);
        archComponent.pruningState$.next(state);
      }
    });

    // Register input components with connection for snapshot restoration
    nigConnection.queryInput = queryInputComponent;
    nigConnection.passageInput = passageInputComponent;
    nigConnection.passageInput2 = passageInput2Component;
    nigConnection.numRepsInput = numRepsInputComponent;

    // Subscribe to table options to update summary display
    tableComponent.$options.subscribe((opts: any) => {
      if (opts?.summary) {
        tableSummary = opts.summary;
      } else {
        tableSummary = '';
      }
    });

    // Set up toggle subscriptions to update stores
    absoluteValuesToggle.$checked.subscribe((checked: boolean) => {
      console.log('[TOGGLE] Absolute values changed to:', checked);
      useAbsoluteValues.set(checked);
    });

    architectureColorsToggle.$checked.subscribe((checked: boolean) => {
      console.log('[TOGGLE] Architecture colors changed to:', checked);
      architectureNodeColors.set(checked);
    });

    // Subscribe to useAbsoluteValues store AFTER components are created
    const useAbsSub = useAbsoluteValues.subscribe((val: boolean) => {
      console.log('[PAGE] useAbsoluteValues changed:', val);

      // Reset architecture selection when toggling absolute values
      if (archComponent && archComponent.$selection) {
        archComponent.$selection.next({ source: null, target: null });
        console.log('[Absolute Values] Reset architecture selection');
      }

      // Update architecture component's absolute values stream and recompute edges
      if (archComponent && archComponent.absoluteValues$) {
        archComponent.absoluteValues$.next(val);
        // Trigger recomputation of edges with new absolute values mode
        if (archComponent.computeEdgesFromSubsetB) {
          archComponent.computeEdgesFromSubsetB();
        }
      }

      // Update table component's absolute values stream
      if (tableComponent && tableComponent.absoluteValues$) {
        tableComponent.absoluteValues$.next(val);
      }

      // Update distribution charts with new absolute values mode
      const s = thresholdSliderComponent?.$value?.getValue
        ? thresholdSliderComponent.$value.getValue()
        : 0.5;
      const threshold = Math.pow(10, -4 + 4 * s);

      if (distributionGeneralComponent && lastDistributionGeneralState.values) {
        distributionGeneralComponent.$options.next({
          ...lastDistributionGeneralState,
          threshold,
          scale: 'symlog',
          extent: nigConnection.globalNigExtent,
          absMax: nigConnection.globalNigAbsMax,
          useAbsoluteValues: val,
        });
      }

      if (distributionLayerComponent && lastDistributionLayerState.values) {
        distributionLayerComponent.$options.next({
          ...lastDistributionLayerState,
          threshold,
          scale: 'symlog',
          extent: nigConnection.globalNigExtent,
          absMax: nigConnection.globalNigAbsMax,
          useAbsoluteValues: val,
        });
      }
    });

    // Subscribe to architectureNodeColors store AFTER components are created
    const archColorsSub = architectureNodeColors.subscribe((val: boolean) => {
      console.log('[PAGE] architectureNodeColors changed:', val);
      if (archComponent && archComponent.colorNodesEnabled$) {
        archComponent.colorNodesEnabled$.next(val);
        // Trigger node color update with current NIG data
        const doc = nigConnection.nigData$.getValue();
        const nig = doc && doc.result && doc.result.subset_b;
        if (nig) {
          archComponent.updateNodeColors(nig);
        }
      }
    });

    // Sync pruning cursor state to architecture and table components
    $effect(() => {
      if (archComponent && archComponent.pruningCursorEnabled$) {
        archComponent.pruningCursorEnabled$.next(pruningCursorActive);
      }
      if (tableComponent && tableComponent.pruningCursorEnabled$) {
        tableComponent.pruningCursorEnabled$.next(pruningCursorActive);
      }
    });

    // Sync conditional NIG cursor state to architecture component
    $effect(() => {
      if (archComponent && archComponent.conditionalCursorEnabled$) {
        archComponent.conditionalCursorEnabled$.next(conditionalCursorActive);
      }
      if (tableComponent && tableComponent.conditionalCursorEnabled$) {
        tableComponent.conditionalCursorEnabled$.next(conditionalCursorActive);
      }
    });

    // Subscribe to conditional NIG target selection from architecture
    $effect(() => {
      if (archComponent && archComponent.conditionalNigTarget$) {
        const sub = archComponent.conditionalNigTarget$.subscribe(
          (target: any) => {
            if (
              target &&
              conditionalNigPanel &&
              conditionalNigPanel.setTarget
            ) {
              console.log(
                '[PAGE] Conditional NIG target from architecture:',
                target,
              );
              // Architecture provides tokenType as a single value (used for both source and target)
              conditionalNigPanel.setTarget(
                target.layerIdx,
                target.neuronIdx,
                target.neuronType,
                target.tokenType,
                target.tokenType,
              );
            }
          },
        );
        return () => sub.unsubscribe();
      }
    });

    // Subscribe to conditional NIG target selection from table
    $effect(() => {
      if (tableComponent && tableComponent.conditionalNigTarget$) {
        const sub = tableComponent.conditionalNigTarget$.subscribe(
          (target: any) => {
            if (
              target &&
              conditionalNigPanel &&
              conditionalNigPanel.setTarget
            ) {
              console.log('[PAGE] Conditional NIG target from table:', target);
              // Table provides separate sourceTokenType and targetTokenType
              conditionalNigPanel.setTarget(
                target.layerIdx,
                target.neuronIdx,
                target.neuronType,
                target.sourceTokenType,
                target.targetTokenType,
              );
            }
          },
        );
        return () => sub.unsubscribe();
      }
    });

    // Subscribe to subset button changes
    const subsetSub = subsetButtonsComponent.$value.subscribe(
      (subset: string) => {
        if (!subset || !authChecked) return; // Wait for auth before requesting samples
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
    const querySub = queryInputComponent.$value.subscribe((query: string) => {
      if (!query || !queryInputComponent.samples || !authChecked) return; // Wait for auth
      const selectedSample = queryInputComponent.samples.find(
        (s: any) => s.query === query,
      );
      if (selectedSample) {
        nigConnection.selectedQueryId = selectedSample.query_id;
        const subset = subsetButtonsComponent.$value.getValue() || 'Random';
        nigConnection.requestSamples({
          query_id: selectedSample.query_id,
          subset,
        });
      }
    });

    // Note: Initial dataset request is handled by subsetButtonsComponent subscription above
    // (BehaviorSubject emits initial 'Random' value on subscribe)

    // Subscribe to NIG results (from index.js lines 522-650)
    const nigDataSub = nigConnection.nigData$.subscribe((doc: any) => {
      handleNIGResult(doc);
    });

    // Subscribe to dataset service for query/passage options (from index.js lines 46-87)
    nigConnection.datasetService.on('patched', (doc: any) => {
      handleDatasetUpdate(doc);
    });

    // Subscribe to architecture selection changes to update table
    const archSelectionSub = archComponent.$selection.subscribe((sel: any) => {
      console.log('[Architecture] Selection changed:', sel);
      
      // Update selection panel state
      currentArchSelection = sel || { source: null, target: null };
      if (currentArchSelection.source && selectionAssistEnabled) {
        selectionPanelVisible = true;
      }

      // Only update table if we have NIG data loaded
      const subsetB = archComponent.subsetBData$.getValue();
      if (!subsetB) {
        console.log('[Architecture] No NIG data yet, skipping table update');
        return;
      }

      const { source: src, target: tgt } = sel || {};

      // Clear table if incomplete or empty selection
      if (!src || !tgt) {
        tableComponent.$options.next({
          hasNigData: true,
          layer: null,
          type: null,
          tokenType: null,
          values: null,
          summary: '',
          globalNigExtent: nigConnection.globalNigExtent,
          globalAttnActivationExtent: nigConnection.globalAttnActivationExtent,
        });
        // Reset layer distribution to empty, keep general distribution unchanged
        const s = thresholdSliderComponent.$value.getValue();
        const threshold = Math.pow(10, -4 + 4 * s);
        const useAbs = get(useAbsoluteValues);
        lastDistributionLayerState = { values: null, type: null };
        distributionLayerComponent.$options.next({
          values: null,
          threshold,
          scale: 'symlog',
          extent: nigConnection.globalNigExtent,
          absMax: nigConnection.globalNigAbsMax,
          useAbsoluteValues: useAbs,
        });
        return;
        return;
      }

      // Extract data based on source/target pair type
      const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
      const attnLayerKey = (layerIdx: number) =>
        `bert.encoder.layer.${layerIdx}.attention.self.attention_probs`;
      const ffnLayerKey = (layerIdx: number) =>
        `bert.encoder.layer.${layerIdx}.intermediate.dense`;

      let layerKey, type, tokenType, values;
      let orientation = undefined;
      let sortTokenType = undefined;
      let activations = null;
      let attnActivations = null;

      // Get full result for activation data
      const resultDoc = nigConnection.nigData$.getValue();
      const result = resultDoc?.result;

      if (
        src.type === 'ATTN' &&
        tgt.type === 'FFN' &&
        src.layer === tgt.layer
      ) {
        // ATTN -> FFN (same layer): show ATTN src->all tgts
        layerKey = attnLayerKey(src.layer);
        type = 'ATTN';
        tokenType = src.tokenType;
        orientation = 'srcToTgts';
        sortTokenType = tgt.tokenType;
        const layerData = subsetB[layerKey];
        const tokenIndex = tokenTypes.indexOf(tokenType);
        if (layerData && tokenIndex !== -1) {
          values = layerData.map((head: any) =>
            head.map((row: any) => row[tokenIndex]),
          );
        }
        // Try to fetch ATTN activations
        try {
          const candidates = [
            result?.attn_activations,
            result?.activations_attn,
            result?.attention,
            result?.attention_probs,
          ];
          const srcMap = candidates.find((x: any) => x && x[layerKey]);
          if (srcMap) {
            const raw = srcMap[layerKey];
            if (Array.isArray(raw)) {
              attnActivations = raw.map((head: any) => head[tokenIndex]);
            }
          }
        } catch {}
      } else if (
        src.type === 'FFN' &&
        tgt.type === 'ATTN' &&
        tgt.layer === src.layer + 1 &&
        src.tokenType === tgt.tokenType
      ) {
        // FFN -> ATTN (next layer, same token): show FFN neuron vector
        layerKey = ffnLayerKey(src.layer);
        type = 'FFN';
        tokenType = src.tokenType;
        const layerData = subsetB[layerKey];
        const tokenIndex = tokenTypes.indexOf(tokenType);
        if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
        // Try to fetch FFN activations
        try {
          const candidates = [
            result?.ffn_activations,
            result?.activations_ffn,
            result?.activations,
          ];
          const srcMap = candidates.find((x: any) => x && x[layerKey]);
          if (srcMap) {
            const row = srcMap[layerKey][tokenIndex];
            if (Array.isArray(row)) activations = row;
          }
        } catch {}
      } else if (
        src.type === 'FFN' &&
        tgt.type === 'ATTN' &&
        tgt.layer === src.layer
      ) {
        // FFN -> ATTN (same layer): show ATTN tgts->src
        layerKey = attnLayerKey(src.layer);
        type = 'ATTN';
        tokenType = src.tokenType;
        orientation = 'tgtsToSrcs';
        sortTokenType = tgt.tokenType;
        const layerData = subsetB[layerKey];
        const tokenIndex = tokenTypes.indexOf(tokenType);
        if (layerData && tokenIndex !== -1) {
          values = layerData.map((head: any) => head[tokenIndex]);
        }
        // Try to fetch ATTN activations for reverse orientation
        try {
          const candidates = [
            result?.attn_activations,
            result?.activations_attn,
            result?.attention,
            result?.activations,
          ];
          const srcMap = candidates.find((x: any) => x && x[layerKey]);
          if (srcMap) {
            const raw = srcMap[layerKey];
            if (Array.isArray(raw)) {
              attnActivations = raw.map((head: any) => head[tokenIndex]);
            }
          }
        } catch {}
      } else if (src.type === 'FFN' && tgt.type === 'TOP' && src.layer === 11) {
        // FFN L11 -> TOP: show FFN neuron vector
        layerKey = ffnLayerKey(src.layer);
        type = 'FFN';
        tokenType = src.tokenType;
        const layerData = subsetB[layerKey];
        const tokenIndex = tokenTypes.indexOf(tokenType);
        if (layerData && tokenIndex !== -1) values = layerData[tokenIndex];
        // Try to fetch FFN activations
        try {
          const candidates = [
            result?.ffn_activations,
            result?.activations_ffn,
            result?.activations,
          ];
          const srcMap = candidates.find((x: any) => x && x[layerKey]);
          if (srcMap) {
            const row = srcMap[layerKey][tokenIndex];
            if (Array.isArray(row)) activations = row;
          }
        } catch {}
      } else {
        // Unsupported pair
        tableComponent.$options.next({
          hasNigData: true,
          layer: null,
          type: null,
          tokenType: null,
          values: null,
          summary: '',
          globalNigExtent: nigConnection.globalNigExtent,
          globalAttnActivationExtent: nigConnection.globalAttnActivationExtent,
          globalFFNActivationExtent: nigConnection.globalFFNActivationExtent,
        });
        return;
      }

      // Update table
      const pruningCutoffs = archComponent.pruningCutoffs$.getValue();

      // Build readable summary - account for orientation
      let summaryText = `L${src.layer} ${type} ${tokenType}`;
      if (orientation === 'srcToTgts' && sortTokenType) {
        // ATTN -> FFN: showing source token flowing to targets, sorted by target token
        summaryText = `L${src.layer} ${type} ${tokenType} → ${sortTokenType}`;
      } else if (orientation === 'tgtsToSrcs' && sortTokenType) {
        // FFN -> ATTN: showing targets flowing into source token, sorted by target token
        summaryText = `L${src.layer} ${type} ${sortTokenType} → ${tokenType}`;
      } else if (tgt.type !== 'TOP' && tgt.tokenType !== src.tokenType) {
        summaryText += ` → ${tgt.tokenType}`;
      }

      tableComponent.$options.next({
        hasNigData: true,
        layer: layerKey,
        type,
        tokenType,
        values,
        activations, // FFN activation values
        attnActivations, // ATTN activation values
        orientation,
        sortTokenType,
        pruningCutoffs,
        globalNigExtent: nigConnection.globalNigExtent,
        globalAttnActivationExtent: nigConnection.globalAttnActivationExtent,
        globalFFNActivationExtent: nigConnection.globalFFNActivationExtent,
        summary: summaryText,
      });

      // Update layer distribution to show selected layer data
      const s = thresholdSliderComponent.$value.getValue();
      const threshold = Math.pow(10, -4 + 4 * s);
      const useAbs = get(useAbsoluteValues);
      lastDistributionLayerState = {
        values: type === 'FFN' ? values : subsetB[layerKey],
        type: type === 'FFN' ? 'FFN_SUBSET' : null,
      };
      distributionLayerComponent.$options.next({
        ...lastDistributionLayerState,
        threshold,
        scale: 'symlog',
        extent: nigConnection.globalNigExtent,
        absMax: nigConnection.globalNigAbsMax,
        useAbsoluteValues: useAbs,
      });
    });

    // Subscribe to hover events from architecture for preview
    const archHoverSub = archComponent.hover$.subscribe((hovered: any) => {
      currentArchHover = hovered;
    });

    // Subscribe to table selection requests (from index.js lines 164-169)
    const tableSelectionSub = tableComponent.selectionRequest$.subscribe(
      (selection: any) => {
        if (selection && archComponent.$selection) {
          console.log('[Table] Requesting architecture selection:', selection);
          archComponent.$selection.next(selection);
        }
      },
    );

    // Subscribe to threshold slider changes using Marcelle streams
    const thresholdSub = thresholdSliderComponent.$value.subscribe(
      (sliderVal: number) => {
        const thresholdValue = Math.pow(10, -4 + 4 * sliderVal);
        console.log(
          '[Threshold Slider] slider:',
          sliderVal,
          '=> threshold:',
          thresholdValue,
        );

        // Track current threshold value for conditional mode save/restore
        currentThresholdValue = thresholdValue;

        // Call updateThreshold method which updates stream AND triggers recomputation
        archComponent.updateThreshold(thresholdValue);

        // Update both distributions and ECDF with new threshold via options stream
        if (lastDistributionGeneralState.values) {
          const useAbs = get(useAbsoluteValues);
          distributionGeneralComponent.$options.next({
            ...lastDistributionGeneralState,
            threshold: thresholdValue,
            scale: 'symlog',
            extent: nigConnection.globalNigExtent,
            absMax: nigConnection.globalNigAbsMax,
            useAbsoluteValues: useAbs,
          });
          ecdfComponent.$options.next({
            ...lastDistributionGeneralState,
            threshold: thresholdValue,
            scale: 'symlog',
            extent: nigConnection.globalNigExtent,
            absMax: nigConnection.globalNigAbsMax,
            useAbsoluteValues: useAbs,
          });
        }
        if (lastDistributionLayerState.values) {
          const useAbs = get(useAbsoluteValues);
          distributionLayerComponent.$options.next({
            ...lastDistributionLayerState,
            threshold: thresholdValue,
            scale: 'symlog',
            extent: nigConnection.globalNigExtent,
            absMax: nigConnection.globalNigAbsMax,
            useAbsoluteValues: useAbs,
          });
        }
      },
    );

    // Subscribe to architecture's globalCutoff$ and forward to distributions, ECDF and table
    const globalCutoffSub = archComponent.globalCutoff$.subscribe(
      (cutoff: number) => {
        console.log('[Architecture] Global cutoff updated:', cutoff);
        distributionGeneralComponent.$globalCutoff.next(cutoff);
        distributionLayerComponent.$globalCutoff.next(cutoff);
        ecdfComponent.$globalCutoff.next(cutoff);
        tableComponent.$globalCutoff.next(cutoff);
      },
    );

    // Subscribe to IG results (token-level integrated gradients)
    const igDataSub = nigConnection.igData$.subscribe((doc: any) => {
      if (!doc || !doc.result) return;
      
      if (doc.result.tokens && doc.result.attributions) {
        const { tokens, attributions, error } = doc.result;
        const html = tokens
          .map((token: string, i: number) => {
            const color = getTokenColor(attributions[i]);
            return `<span style="color:${color}" title="${attributions[i].toFixed(4)}">${token}</span>`;
          })
          .join(' ');
        igOutput = `${html}<br><br>Baseline Error: ${error?.toFixed(4) ?? 'N/A'}`;
        // Auto-switch to Token Results tab when results arrive
        activeDistributionsTab = 'tokenResults';
      }
    });

    return () => {
      nigDataSub.unsubscribe();
      archSelectionSub.unsubscribe();
      archHoverSub.unsubscribe();
      tableSelectionSub.unsubscribe();
      thresholdSub.unsubscribe();
      globalCutoffSub.unsubscribe();
      igDataSub.unsubscribe();
      useAbsSub(); // Svelte store returns unsubscriber function
      archColorsSub(); // Svelte store returns unsubscriber function
    };
  });

  // Color function for token IG visualization
  function getTokenColor(attr: number): string {
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

  // Handle NIG results (from index.js lines 522-650)
  function handleNIGResult(doc: any) {
    if (!doc || !doc.result) return;

    if (doc.__fromSnapshot) {
      console.log('[MODEL STREAM] Received injected snapshot doc id=', doc._id);
    } else {
      console.log('[MODEL STREAM] Received fresh computation doc id=', doc._id);
    }

    nigConnection.currentNigId = doc._id;

    if (!doc.result.subset_b) return;
    const nig = doc.result.subset_b;
    console.log(
      '[MODEL STREAM] subset_b size (layers)=',
      Object.keys(nig).length,
    );

    // Track that we have NIG data
    hasNigData = true;

    // Clear original data if this is a fresh (non-conditional) NIG computation
    if (!doc.__isConditional && !doc.__fromSnapshot) {
      nigConnection.clearOriginalNigData();
    }

    // Update architecture conditional mode state
    if (archComponent && archComponent.conditionalModeState$) {
      if (doc.__isConditional && doc.__conditionalTarget) {
        archComponent.conditionalModeState$.next({
          isConditional: true,
          targetLayerIdx: doc.__conditionalTarget.layerIdx,
          targetNeuronType: doc.__conditionalTarget.neuronType,
        });
        // Reset architecture selection when entering conditional mode
        // This clears the table and prevents stale selection on greyed-out layers
        archComponent.$selection.next({ source: null, target: null });
      } else {
        archComponent.conditionalModeState$.next({
          isConditional: false,
          targetLayerIdx: null,
          targetNeuronType: null,
        });
      }
    }

    // Update table conditional mode state
    if (tableComponent && tableComponent.conditionalModeState$) {
      tableComponent.conditionalModeState$.next({
        isConditional: doc.__isConditional && doc.__conditionalTarget,
      });
    }

    // Compute global extent (from index.js lines 542-580)
    try {
      const computeExtent = (value: any) => {
        let min = Infinity,
          max = -Infinity;
        let maxAbs = 0;
        const visit = (v: any): void => {
          if (Array.isArray(v)) {
            for (const x of v) visit(x);
          } else if (v != null && typeof v === 'object') {
            for (const k in v) visit(v[k]);
          } else if (Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
            const a = Math.abs(v);
            if (a > maxAbs) maxAbs = a;
          }
        };
        visit(value);
        const extent =
          isFinite(min) && isFinite(max)
            ? ([min, max] as [number, number])
            : null;
        return { extent, maxAbs: maxAbs || null };
      };
      const stats = computeExtent(nig);
      nigConnection.globalNigExtent = stats.extent;
      nigConnection.globalNigAbsMax = stats.maxAbs;
      console.log(
        '[MODEL STREAM] Global NIG extent:',
        nigConnection.globalNigExtent,
        'absMax:',
        nigConnection.globalNigAbsMax,
      );

      // Update threshold slider with global extent
      if (thresholdSliderComponent && thresholdSliderComponent.$options) {
        thresholdSliderComponent.$options.next({
          globalExtent: nigConnection.globalNigExtent,
        });
      }

      // Compute global extent for activation values
      const r = doc.result;
      const attnActs =
        r.attn_activations || r.activations_attn || r.attention_probs || null;
      const ffnActs =
        r.ffn_activations || r.activations_ffn || r.activations || null;
      if (attnActs) {
        const attnStats = computeExtent(attnActs);
        nigConnection.globalAttnActivationExtent = attnStats.extent;
        console.log(
          '[MODEL STREAM] Global ATTN activation extent:',
          nigConnection.globalAttnActivationExtent,
        );
      }
      if (ffnActs) {
        const ffnStats = computeExtent(ffnActs);
        nigConnection.globalFFNActivationExtent = ffnStats.extent;
        console.log(
          '[MODEL STREAM] Global FFN activation extent:',
          nigConnection.globalFFNActivationExtent,
        );
      }
    } catch (e) {
      console.warn('[NIG] Failed to compute extent:', e);
    }

    // Update table (from index.js lines 625-627)
    const layers = Object.keys(nig);
    if (layers.length) {
      tableComponent.$options.next({
        hasNigData: true,
        layer: null,
        values: null,
        summary: '',
        globalNigExtent: nigConnection.globalNigExtent,
        globalAttnActivationExtent: nigConnection.globalAttnActivationExtent,
        globalFFNActivationExtent: nigConnection.globalFFNActivationExtent,
      });

      // Update general distribution and ECDF with full NIG data
      const s =
        thresholdSliderComponent &&
        thresholdSliderComponent.$value &&
        thresholdSliderComponent.$value.getValue
          ? thresholdSliderComponent.$value.getValue()
          : 0.5;
      const thresholdVal = Math.pow(10, -4 + 4 * s);
      const useAbs = get(useAbsoluteValues);
      lastDistributionGeneralState = { values: nig, type: null };
      distributionGeneralComponent.$options.next({
        ...lastDistributionGeneralState,
        threshold: thresholdVal,
        scale: 'symlog',
        extent: nigConnection.globalNigExtent,
        absMax: nigConnection.globalNigAbsMax,
        useAbsoluteValues: useAbs,
      });
      ecdfComponent.$options.next({
        ...lastDistributionGeneralState,
        threshold: thresholdVal,
        scale: 'symlog',
        extent: nigConnection.globalNigExtent,
        absMax: nigConnection.globalNigAbsMax,
        useAbsoluteValues: useAbs,
      });
    }

    // Update architecture (from index.js lines 636-637)
    archComponent.updateEdges(nig);
    console.log('[MODEL STREAM] Edges recomputed for doc id=', doc._id);
    
    // Show selection panel when NIGs are calculated (if assist enabled)
    if (selectionAssistEnabled) {
      selectionPanelVisible = true;
    }

    // Force table to update with new data by re-emitting current selection
    // This ensures table reflects the new NIG data even if selection hasn't changed
    const currentSelection = archComponent.$selection.getValue();
    if (
      currentSelection &&
      currentSelection.source &&
      currentSelection.target
    ) {
      // Re-emit the selection to trigger table update with new NIG data
      archComponent.$selection.next(currentSelection);
    }
  }

  // Handle dataset updates (from index.js lines 46-87)
  function handleDatasetUpdate(doc: any) {
    if (doc.status === 'success' && doc.samples) {
      console.log('[DATASET] Received samples:', doc.samples.length);
      nigConnection.samplesReady = true;

      // Update query options (but don't auto-select)
      if (queryInputComponent && doc.samples) {
        const queries = doc.samples.map((sample: any) => sample.query);
        queryInputComponent.updateOptions(queries);
        queryInputComponent.samples = doc.samples;
      }

      // Update subset options if levels provided
      if (Array.isArray(doc.levels) && subsetButtonsComponent) {
        const opts = [...doc.levels.map((l: number) => `Rel=${l}`), 'Random'];
        subsetButtonsComponent.setOptions(opts);
      }
    }

    // Update passages for specific query
    if (doc.status === 'success' && Array.isArray(doc.passages)) {
      console.log('[DATASET] Received passages for query');
      const passages = doc.passages.map((p: any) => p.text);
      if (passageInputComponent) passageInputComponent.updateOptions(passages);
    }
  }

  // Mount components when containers are available
  $effect(() => {
    if (archContainer && archComponent && !archUnmount) {
      archUnmount = archComponent.mount(archContainer);
    }
  });

  $effect(() => {
    if (tableContainer && tableComponent && !tableUnmount) {
      tableUnmount = tableComponent.mount(tableContainer);
    }
  });

  $effect(() => {
    if (
      distributionGeneralContainer &&
      distributionGeneralComponent &&
      !distributionGeneralUnmount
    ) {
      distributionGeneralUnmount = distributionGeneralComponent.mount(
        distributionGeneralContainer,
      );
    }
  });

  $effect(() => {
    if (
      distributionLayerContainer &&
      distributionLayerComponent &&
      !distributionLayerUnmount
    ) {
      distributionLayerUnmount = distributionLayerComponent.mount(
        distributionLayerContainer,
      );
    }
  });

  $effect(() => {
    if (ecdfContainer && ecdfComponent && !ecdfUnmount) {
      ecdfUnmount = ecdfComponent.mount(ecdfContainer);
    }
  });

  $effect(() => {
    if (
      thresholdSliderContainer &&
      thresholdSliderComponent &&
      !thresholdSliderUnmount
    ) {
      thresholdSliderUnmount = thresholdSliderComponent.mount(
        thresholdSliderContainer,
      );
    }
  });

  onDestroy(() => {
    // Cleanup component mounts
    if (archUnmount) archUnmount();
    if (tableUnmount) tableUnmount();
    if (distributionGeneralUnmount) distributionGeneralUnmount();
    if (distributionLayerUnmount) distributionLayerUnmount();
    if (ecdfUnmount) ecdfUnmount();
    if (thresholdSliderUnmount) thresholdSliderUnmount();
  });

  // Determine which panel to show based on active selection
  $effect(() => {
    // Auto-collapse panels when clicking the same icon
    if (activeSidebarPanel === 'outputs') {
      outputVisible = true;
    }
  });
</script>

<svelte:head>
  <title>IR Lens</title>
  <link rel="icon" href="/favicon.png" />
</svelte:head>

{#if !authChecked}
  <!-- Loading state while checking authentication -->
  <div class="fixed inset-0 bg-base-200 flex items-center justify-center">
    <span class="loading loading-spinner loading-lg"></span>
  </div>
{:else}
<!-- Full-screen layout with Icon Bar | Sidebar | Main Content -->
<div class="fixed inset-0 bg-base-200 flex flex-col">
  <!-- Top Bar -->
  <div
    class="flex-shrink-0 bg-base-300 border-b border-base-content/10 px-4 py-2 flex items-center justify-between"
  >
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <img src="/favicon.png" alt="IR Lens" class="w-6 h-6" />
        <h1 class="text-lg font-semibold">IR Lens</h1>
      </div>
      <!-- Placeholder for future tabs -->
      <div class="tabs tabs-boxed bg-base-200">
        <button class="tab tab-active">Main</button>
        <!-- Future tabs will go here -->
      </div>
    </div>
    <div class="flex items-center">
      <UserMenu />
    </div>
  </div>

  <!-- Layout matching whiteboard diagram: Icon Bar | Sidebar | Main (Arch + Table top, Graphs bottom) -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left Icon Bar (60px fixed) -->
    <IconBar
      bind:selected={activeSidebarPanel}
      bind:sidebarSize={sidebarPaneSize}
    />

    <!-- Resizable Sidebar and Main Content -->
    <Splitpanes theme="modern-theme" class="flex-1" style="overflow: hidden;">
      <!-- Sidebar Panel (resizable, can be closed by dragging to 0) -->
      <Pane bind:size={sidebarPaneSize} minSize={0} maxSize={40}>
        <div
          class="h-full overflow-y-auto bg-base-100 border-r border-base-300"
          style="max-width: 100%; overflow-x: hidden;"
        >
          {#if activeSidebarPanel === 'input'}
            <InputPanel
              visible={true}
              connection={nigConnection}
              queryInput={queryInputComponent}
              passageInput={passageInputComponent}
              passageInput2={passageInput2Component}
              numRepsInput={numRepsInputComponent}
              subsetButtons={subsetButtonsComponent}
            />
          {:else if activeSidebarPanel === 'nigs'}
            <NigsPanel visible={true} connection={nigConnection} />
          {:else if activeSidebarPanel === 'architecture'}
            <ArchitecturePanel
              visible={true}
              {absoluteValuesToggle}
              {architectureColorsToggle}
              bind:selectionAssistEnabled
            />
          {:else if activeSidebarPanel === 'pruning'}
            <PruningPanel
              visible={true}
              bind:cursorActive={pruningCursorActive}
              pruningState$={archComponent?.pruningState$}
              prunePreview$={archComponent?.prunePreview$}
            />
          {:else if activeSidebarPanel === 'conditional'}
            <ConditionalNigPanel
              visible={true}
              bind:cursorActive={conditionalCursorActive}
              bind:this={conditionalNigPanel}
              currentQuery={nigConnection.lastNIGRequestInputs?.query ?? ''}
              currentPassage={nigConnection.lastNIGRequestInputs?.passage ?? ''}
              numReps={numRepsInputComponent?.$value?.getValue?.() ?? 20}
              {hasNigData}
              currentThreshold={currentThresholdValue}
              onThresholdChange={(newThreshold) => {
                // Convert threshold to slider value and update
                const sliderVal = (Math.log10(newThreshold) + 4) / 4;
                if (
                  thresholdSliderComponent &&
                  thresholdSliderComponent.$value
                ) {
                  thresholdSliderComponent.$value.next(sliderVal);
                }
              }}
            />
          {/if}
        </div>
      </Pane>

      <!-- Main Content Pane (always present) -->
      <Pane size={sidebarPaneSize > 0 ? 80 : 100}>
        <div class="h-full w-full flex flex-col overflow-hidden">
          <!-- Main View: horizontal = Top/Bottom split -->
          <div class="flex-1 min-h-0 overflow-hidden">
            <Splitpanes theme="modern-theme" horizontal>
              <!-- TOP SECTION: Architecture and Table side-by-side -->
              <Pane bind:size={topPaneSize} minSize={6}>
                <!-- Inner horizontal = Left/Right split for Arch | Table -->
                <Splitpanes theme="modern-theme" class="h-full">
                  <!-- Architecture (Left) -->
                  <Pane size={65} minSize={20}>
                    <div class="h-full w-full flex flex-col overflow-hidden bg-base-100 relative">
                      <!-- Header -->
                      <div
                        class="px-4 h-10 border-b border-base-300 flex items-center justify-between flex-shrink-0"
                      >
                        <h2 class="text-sm font-semibold text-base-content/70">
                          Architecture
                        </h2>
                        <div class="flex items-center gap-2">
                          <!-- Zoom controls -->
                          <div class="flex items-center gap-1 mr-2">
                            <button 
                              class="btn btn-xs btn-ghost px-1"
                              onclick={() => {
                                const snapped = Math.floor(archZoom * 4) / 4;
                                archZoom = Math.max(0.5, snapped === archZoom ? archZoom - 0.25 : snapped);
                              }}
                              title="Zoom out"
                            >
                              −
                            </button>
                            <span class="text-xs text-base-content/60 w-10 text-center">{Math.round(archZoom * 100)}%</span>
                            <button 
                              class="btn btn-xs btn-ghost px-1"
                              onclick={() => {
                                const snapped = Math.ceil(archZoom * 4) / 4;
                                archZoom = Math.min(1.5, snapped === archZoom ? archZoom + 0.25 : snapped);
                              }}
                              title="Zoom in"
                            >
                              +
                            </button>
                          </div>
                          <span class="tooltip-wrapper">
                            <span class="tooltip-icon">?</span>
                            <span class="tooltip-text">Neural network layer structure showing attention heads and NIG attribution flow. Use threshold to affect edges.</span>
                          </span>
                        </div>
                      </div>
                      <!-- Threshold Slider (tied to pane size not zoom) -->
                      <div
                        class="border-b border-base-300 flex-shrink-0"
                        bind:this={thresholdSliderContainer}
                      ></div>
                      <!-- Sticky token column labels - matches SVG grid: margin.left=100, gridSize=80 -->
                      <div 
                        class="flex-shrink-0 bg-base-100 flex"
                        style="padding-left: {100 * archZoom}px; padding-top: {8 * archZoom}px; padding-bottom: {4 * archZoom}px;"
                      >
                        {#each ['cls', 'qry', 'sep1', 'doc', 'sep2'] as label}
                          <span 
                            class="text-center"
                            style="width: {80 * archZoom}px; font-size: {14 * archZoom}px; font-family: sans-serif; color: #333;"
                          >{label}</span>
                        {/each}
                      </div>
                      
                      <!-- Scrollable area fills remaining space -->
                      <div class="flex-1 min-h-0 overflow-auto relative">
                        <!-- Wrapper with scaled dimensions for proper scrollbar sizing -->
                        <div style="width: {ARCH_SVG_WIDTH * archZoom}px; height: {ARCH_SVG_HEIGHT * archZoom}px;">
                          <!-- Architecture content - scaled -->
                          <div 
                            bind:this={archContentEl}
                            style="transform: scale({archZoom}); transform-origin: top left;"
                          >
                            <div bind:this={archContainer}></div>
                          </div>
                        </div>
                      </div>
                      
                      <!-- Selection Panel Popover (fixed position within arch pane) -->
                      {#if selectionPanelVisible && selectionAssistEnabled}
                        <div class="selection-popover">
                          <div class="selection-popover-header">
                            <span class="text-xs font-semibold text-base-content/70 uppercase tracking-wide">Selection</span>
                            <button 
                              class="selection-popover-close"
                              onclick={() => { selectionPanelVisible = false; }}
                              title="Close"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                              </svg>
                            </button>
                          </div>
                          
                          <div class="selection-popover-content">
                            {#if tableSummary}
                              <!-- Complete selection: show table summary directly -->
                              <div class="selection-popover-summary">
                                {tableSummary}
                              </div>
                              <p class="selection-popover-success">See table →</p>
                            {:else if currentArchSelection?.source}
                              <!-- Fixed layout: Source always top, Target always bottom -->
                              <!-- Green block position changes based on hover state -->
                              
                              <!-- SOURCE (top) -->
                              <div class="selection-popover-box"
                                class:active={!isHoverInverted}
                                class:preview={isHoverInverted}
                              >
                                <div class="selection-popover-label">
                                  <span class="selection-popover-number"
                                    class:active={!isHoverInverted}
                                    class:preview={isHoverInverted}
                                  >1</span>
                                  <span>Source</span>
                                </div>
                                {#if isHoverInverted && currentArchHover}
                                  <!-- Inverted: ATTN is the source (from hover) -->
                                  <div class="selection-popover-info">
                                    <span class="selection-popover-type attn">ATTN</span>
                                    <span class="selection-popover-detail">L{currentArchHover?.layer}</span>
                                    <span class="selection-popover-token">{currentArchHover?.tokenType}</span>
                                  </div>
                                {:else if isHoverNormal}
                                  <!-- Normal: clicked node is the source -->
                                  <div class="selection-popover-info">
                                    <span class="selection-popover-type"
                                      class:attn={currentArchSelection.source.type === 'ATTN'}
                                      class:ffn={currentArchSelection.source.type === 'FFN'}
                                    >{currentArchSelection.source.type}</span>
                                    <span class="selection-popover-detail">L{currentArchSelection.source.layer}</span>
                                    <span class="selection-popover-token">{currentArchSelection.source.tokenType}</span>
                                  </div>
                                {:else}
                                  <!-- Default: clicked node shown as source -->
                                  <div class="selection-popover-info">
                                    <span class="selection-popover-type"
                                      class:attn={currentArchSelection.source.type === 'ATTN'}
                                      class:ffn={currentArchSelection.source.type === 'FFN'}
                                    >{currentArchSelection.source.type}</span>
                                    <span class="selection-popover-detail">L{currentArchSelection.source.layer}</span>
                                    <span class="selection-popover-token">{currentArchSelection.source.tokenType}</span>
                                  </div>
                                {/if}
                              </div>
                              
                              <!-- Arrow -->
                              <div class="selection-popover-arrow">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M12 5v14M19 12l-7 7-7-7"/>
                                </svg>
                              </div>
                              
                              <!-- TARGET (bottom) -->
                              <div class="selection-popover-box"
                                class:active={isHoverInverted}
                                class:preview={isHoverNormal}
                                class:waiting={!isHoverInverted && !isHoverNormal}
                              >
                                <div class="selection-popover-label">
                                  <span class="selection-popover-number"
                                    class:active={isHoverInverted}
                                    class:preview={isHoverNormal}
                                    class:waiting={!isHoverInverted && !isHoverNormal}
                                  >2</span>
                                  <span>Target</span>
                                </div>
                                {#if isHoverInverted}
                                  <!-- Inverted: FFN (clicked node) is the target -->
                                  <div class="selection-popover-info">
                                    <span class="selection-popover-type ffn">FFN</span>
                                    <span class="selection-popover-detail">L{currentArchSelection.source.layer}</span>
                                    <span class="selection-popover-token">{currentArchSelection.source.tokenType}</span>
                                  </div>
                                {:else if isHoverNormal && currentArchHover}
                                  <!-- Normal: hover is the target -->
                                  <div class="selection-popover-info">
                                    {#if currentArchHover?.type === 'TOP'}
                                      <span class="selection-popover-type top">OUT</span>
                                    {:else}
                                      <span class="selection-popover-type"
                                        class:attn={currentArchHover?.type === 'ATTN'}
                                        class:ffn={currentArchHover?.type === 'FFN'}
                                      >{currentArchHover?.type}</span>
                                      <span class="selection-popover-detail">L{currentArchHover?.layer}</span>
                                    {/if}
                                    <span class="selection-popover-token">{currentArchHover?.tokenType}</span>
                                  </div>
                                {:else}
                                  <span class="selection-popover-placeholder">Hover yellow node</span>
                                {/if}
                              </div>
                            {:else}
                              <!-- No selection yet -->
                              <div class="selection-popover-box">
                                <span class="selection-popover-placeholder">Click any node to start</span>
                              </div>
                            {/if}
                            
                            {#if currentArchSelection?.source}
                              <button 
                                class="selection-popover-clear"
                                onclick={() => { archComponent?.$selection.next({ source: null, target: null }); selectionPanelVisible = false; }}
                              >
                                Clear
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </Pane>

                  <!-- Table (Right) -->
                  <Pane size={35} minSize={10}>
                    <div
                      class="h-full w-full flex flex-col bg-base-100 border-l border-base-300"
                    >
                      <div
                        class="px-4 h-10 border-b border-base-300 flex-shrink-0 flex items-center justify-between"
                      >
                        <h2 class="text-sm font-semibold text-base-content/70">
                          NIG Table{#if tableSummary} <span class="font-normal text-base-content/50">({tableSummary})</span>{/if}
                        </h2>
                        <span class="tooltip-wrapper">
                          <span class="tooltip-icon">?</span>
                          <span class="tooltip-text">Tabular view of NIG values per layer. Provides aggregated summaries of both neurons and heads.</span>
                        </span>
                      </div>
                      <!-- Table container fills remaining space -->
                      <div class="flex-1 min-h-0">
                        <div
                          class="h-full w-full"
                          bind:this={tableContainer}
                        ></div>
                      </div>
                    </div>
                  </Pane>
                </Splitpanes>
              </Pane>

              <!-- BOTTOM SECTION: Three visualizations -->
              <Pane bind:size={bottomPaneSize} minSize={8}>
                <div
                  class="h-full w-full flex flex-col bg-base-100 border-t border-base-300"
                >
                  <div class="px-4 py-2 border-b border-base-300 flex-shrink-0 flex items-center justify-between">
                    <div class="flex items-center">
                      <!-- Tab-style headers -->
                      <button 
                        class="text-sm font-semibold px-3 py-1 rounded-l border-y border-l transition-colors {activeDistributionsTab === 'charts' ? 'bg-primary text-primary-content border-primary' : 'bg-base-200 text-base-content/70 border-base-300 hover:bg-base-300'}"
                        onclick={() => activeDistributionsTab = 'charts'}
                      >
                        Distributions & ECDF
                      </button>
                      <button 
                        class="text-sm font-semibold px-3 py-1 rounded-r border transition-colors {activeDistributionsTab === 'tokenResults' ? 'bg-primary text-primary-content border-primary' : 'bg-base-200 text-base-content/70 border-base-300 hover:bg-base-300'}"
                        onclick={() => activeDistributionsTab = 'tokenResults'}
                      >
                        Token Results
                      </button>
                      <!-- Collapse/Expand button next to tabs -->
                      <button
                        class="btn btn-xs btn-ghost px-1 ml-2"
                        onclick={toggleBottomPanelCollapse}
                        title={bottomPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
                      >
                        {#if bottomPanelCollapsed}
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                          </svg>
                        {:else}
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        {/if}
                      </button>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="tooltip-wrapper">
                        <span class="tooltip-icon">?</span>
                        <span class="tooltip-text">{activeDistributionsTab === 'charts' ? 'Statistical distributions and cumulative density functions of NIG attribution values.' : 'Token-level integrated gradients visualization showing attribution per token.'}</span>
                      </span>
                    </div>
                  </div>
                  
                  <!-- Tab Content -->
                  <!-- Charts tab - use CSS visibility to preserve DOM -->
                  <div class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" class:hidden={activeDistributionsTab !== 'charts'}>
                    <div class="flex flex-row gap-3 p-3">
                      <div class="flex-shrink-0">
                        <h3 class="text-xs font-medium text-base-content/60 mb-2">Signed distribution of IG values (log density)</h3>
                        <div bind:this={distributionGeneralContainer}></div>
                      </div>
                      <div class="flex-shrink-0">
                        <h3 class="text-xs font-medium text-base-content/60 mb-2">ECDF + Mass-weighted ECDF of |NIG|</h3>
                        <div bind:this={ecdfContainer}></div>
                      </div>
                      <div class="flex-shrink-0">
                        <h3 class="text-xs font-medium text-base-content/60 mb-2">Layer distribution of IG values (log density)</h3>
                        <div bind:this={distributionLayerContainer}></div>
                      </div>
                    </div>
                  </div>
                  <!-- Token Results tab - use CSS visibility to preserve DOM -->
                  <div class="flex-1 min-h-0 overflow-auto p-4" class:hidden={activeDistributionsTab !== 'tokenResults'}>
                    {#if !igOutput}
                      <div class="text-sm text-base-content/60">
                        Click "Calculate Token IG" to compute token-level integrated gradients visualization.
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
              </Pane>
            </Splitpanes>
          </div>
          <!-- Output Console - fixed at bottom, outside Splitpanes -->
          <div class="flex-shrink-0 border-t border-base-300">
            <OutputConsole
              statusStream={nigConnection.nigStatus$}
              conditionalStatusStream={nigConnection.conditionalNigStatus$}
              forwardPassStatusStream={nigConnection.forwardPassStatus$}
              prunedForwardPassStatusStream={nigConnection.prunedForwardPassStatus$}
              igStatusStream={nigConnection.igStatus$}
              connection={nigConnection}
              pruningState$={archComponent?.pruningState$}
            />
          </div>
        </div>
      </Pane>
    </Splitpanes>
  </div>
</div>
{/if}

<style>
  @reference "../app.css";

  :global(.modern-theme.splitpanes) {
    @apply bg-base-200;
  }

  :global(.modern-theme.splitpanes .splitpanes__pane) {
    @apply bg-base-100;
  }

  :global(.modern-theme.splitpanes .splitpanes__splitter) {
    @apply bg-base-300 hover:bg-primary transition-colors;
    min-width: 4px;
    min-height: 4px;
  }

  :global(.modern-theme.splitpanes .splitpanes__splitter:hover) {
    @apply bg-primary/50;
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
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    line-height: 1.5;
    transition: opacity 0.15s ease, visibility 0.15s ease;
  }
  
  .tooltip-wrapper:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }
  
  /* Selection Popover Styles */
  .selection-popover {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 160px;
    background: linear-gradient(to bottom, #ffffff, #f8fafc);
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08);
    z-index: 100;
    overflow: hidden;
  }
  
  .selection-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
  }
  
  .selection-popover-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .selection-popover-close:hover {
    background: #e2e8f0;
    color: #475569;
  }
  
  .selection-popover-content {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .selection-popover-summary {
    font-size: 12px;
    font-weight: 600;
    color: #22C55E;
    text-align: center;
    padding: 8px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 6px;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  
  .selection-popover-box {
    background: #fff;
    border: 2px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px;
    transition: all 0.2s ease;
  }
  
  .selection-popover-box.active {
    border-color: #22C55E;
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.15);
  }
  
  .selection-popover-box.preview {
    border-color: #F59E0B;
    border-style: dashed;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
    background: #fffbeb;
  }
  
  .selection-popover-box.waiting {
    border-color: #F59E0B;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
    animation: popoverPulse 2s ease-in-out infinite;
  }
  
  @keyframes popoverPulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15); }
    50% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25); }
  }
  
  .selection-popover-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 500;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 4px;
  }
  
  .selection-popover-number {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e2e8f0;
    color: #475569;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 600;
  }
  
  .selection-popover-number.active {
    background: #22C55E;
    color: white;
  }
  
  .selection-popover-number.preview {
    background: #F59E0B;
    color: white;
    border: 1px dashed #fff;
  }
  
  .selection-popover-number.waiting {
    background: #F59E0B;
    color: white;
  }
  
  .selection-popover-info {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  
  .selection-popover-type {
    display: inline-flex;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  
  .selection-popover-type.attn {
    background: #dbeafe;
    color: #1d4ed8;
  }
  
  .selection-popover-type.ffn {
    background: #fef3c7;
    color: #b45309;
  }
  
  .selection-popover-type.top {
    background: #f3e8ff;
    color: #7c3aed;
  }
  
  .selection-popover-detail {
    font-size: 11px;
    font-weight: 500;
    color: #475569;
  }
  
  .selection-popover-token {
    background: #f1f5f9;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 10px;
    color: #475569;
  }
  
  .selection-popover-placeholder {
    color: #94a3b8;
    font-size: 11px;
    font-style: italic;
  }
  
  .selection-popover-arrow {
    display: flex;
    justify-content: center;
    color: #cbd5e1;
  }
  
  .selection-popover-success {
    margin: 0;
    font-size: 10px;
    color: #22C55E;
    font-weight: 500;
    text-align: center;
  }
  
  .selection-popover-clear {
    width: 100%;
    padding: 6px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .selection-popover-clear:hover {
    background: #fef2f2;
    border-color: #fecaca;
    color: #dc2626;
  }
</style>
