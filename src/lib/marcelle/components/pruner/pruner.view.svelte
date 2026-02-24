<script>
  import { toggle } from '@marcellejs/gui-widgets';
  import { onMount, onDestroy, tick } from 'svelte';

  // Props passed from the component
  export let enabled$;
  export let attentionThreshold$;
  export let ffnThreshold$;
  export let pruningRules$;
  export let pruningTargets$;

  let enabledWidget;
  let toggleContainer;

  // Actual threshold values (fractions)
  let ffnThreshold = 0.0;
  let attentionThreshold = 0.0;
  // Slider positions (0..1) for log scale mapping: value = 0 if s=0 else 10^(-4 + 4*s)
  let ffnSliderPos = 0.0;
  let attentionSliderPos = 0.0;

  // For simplicity, pruningRules as array of objects
  let pruningRules = [];

  // Available layers (0-11 for BERT-base)
  const availableLayers = Array.from({length: 12}, (_, i) => i);
  
  // Layer options in Architecture format - ATTN first, then FFN
  const layerOptions = [];
  for (let i = 0; i < 12; i++) {
    layerOptions.push({ value: `L${i}_ATTN`, label: `L${i} ATTN`, layer: i, type: 'attention' });
    layerOptions.push({ value: `L${i}_FFN`, label: `L${i} FFN`, layer: i, type: 'ffn' });
  }
  
  // Token types matching architecture format
  const tokenTypes = ['all', 'cls', 'qry', 'sep1', 'doc', 'sep2'];

  // Neuron targets
  let neuronTargets = [];

  // Available neurons per layer (example - this could be dynamic)
  const neuronsPerLayer = 1536; // FFN intermediate size for BERT-base

  // Sync from BehaviorSubject to local variable for toggle
  let enabled = false;

  // Reactive statement to ensure enabled stays in sync
  $: if (enabled$.getValue() !== enabled && initialized) {
    console.log('Reactive: enabled changed to:', enabled);
  }

  // Track initialization to prevent initial reactive updates
  let initialized = false;

  onMount(async () => {
    // Initialize with the current value from the BehaviorSubject
    const initialEnabled = enabled$.getValue();
    enabledWidget = toggle('Enable Pruning'); // Set initial text
    enabledWidget.checked = initialEnabled;
    enabledWidget.mount(toggleContainer);

    // Subscribe toggle changes to BehaviorSubject and local variable
    const sub = enabledWidget.$checked.subscribe(value => {
      console.log('Toggle changed to:', value); // Debug log
      enabled$.next(value);
      enabled = value;
      // Update toggle text based on state
      enabledWidget.$text.next(value ? 'Pruning Enabled' : 'Pruning Disabled');
    });

    // Subscribe BehaviorSubject changes to update toggle (in case of external updates)
    const enabledSub = enabled$.subscribe(value => {
      console.log('BehaviorSubject enabled changed to:', value); // Debug log
      if (enabledWidget && enabledWidget.checked !== value) {
        enabledWidget.checked = value;
      }
      enabled = value;
      // Update toggle text based on state
      if (enabledWidget) {
        enabledWidget.$text.next(value ? 'Pruning Enabled' : 'Pruning Disabled');
      }
    });

    // Subscribe to individual threshold changes
    const attentionSub = attentionThreshold$.subscribe(value => {
      if (attentionThreshold !== value) {
        attentionThreshold = value;
        attentionSliderPos = valueToSliderPos(value);
      }
    });

    const ffnSub = ffnThreshold$.subscribe(value => {
      if (ffnThreshold !== value) {
        ffnThreshold = value;
        ffnSliderPos = valueToSliderPos(value);
      }
    });

    // Subscribe to pruning rules changes
    const rulesSub = pruningRules$.subscribe(value => {
      pruningRules = value;
    });

    // Subscribe to pruning targets changes  
    const targetsSub = pruningTargets$.subscribe(value => {
      neuronTargets = value;
    });

    // Mark as initialized after a tick to prevent initial reactive updates
    await tick();
    initialized = true;

    return () => {
      sub.unsubscribe();
      enabledSub.unsubscribe();
      attentionSub.unsubscribe();
      ffnSub.unsubscribe();
      rulesSub.unsubscribe();
      targetsSub.unsubscribe();
      enabledWidget.unmount();
    };
  });

  function valueToSliderPos(v){
    if (v <= 0) return 0;
    const pos = (Math.log10(v) + 4) / 4;
    return Math.min(1, Math.max(0, pos));
  }
  function sliderPosToValue(s){
    if (s <= 0) return 0;
    return Math.pow(10, -4 + 4 * s);
  }
  function formatThreshold(v){
    if (v === 0) return '0';
    if (v === 1) return '1.000';
    // For display we cap at 3 decimals as requested
    if (v >= 0.1) return v.toFixed(3);
    if (v >= 0.01) return v.toFixed(3);
    if (v >= 0.001) return v.toFixed(3);
    return v.toFixed(3); // very small values rounded to 3 decimals (may show 0.000)
  }
  function round3(x){
    return parseFloat((+x).toFixed(3));
  }
  // Handle threshold input changes with user interaction
  function handleAttentionThresholdChange(event) {
  let value = parseFloat(event.target.value) || 0.0;
  value = round3(value);
    attentionThreshold = value;
    attentionSliderPos = valueToSliderPos(value);
    if (initialized && attentionThreshold$.getValue() !== value) {
      attentionThreshold$.next(value);
    }
  // Force input value formatting to 3 decimals
  event.target.value = formatThreshold(value);
  }

  function handleFFNThresholdChange(event) {
  let value = parseFloat(event.target.value) || 0.0;
  value = round3(value);
    ffnThreshold = value;
    ffnSliderPos = valueToSliderPos(value);
    if (initialized && ffnThreshold$.getValue() !== value) {
      ffnThreshold$.next(value);
    }
  event.target.value = formatThreshold(value);
  }

  function handleFFNSliderInput(event){
    const s = parseFloat(event.target.value) || 0;
    ffnSliderPos = s;
    const v = sliderPosToValue(s);
    if (ffnThreshold !== v){
      ffnThreshold = v;
      if (initialized) ffnThreshold$.next(v);
    }
  }

  function handleAttentionSliderInput(event){
    const s = parseFloat(event.target.value) || 0;
    attentionSliderPos = s;
    const v = sliderPosToValue(s);
    if (attentionThreshold !== v){
      attentionThreshold = v;
      if (initialized) attentionThreshold$.next(v);
    }
  }

  function addRule() {
    const newRule = { layer: 'L0_ATTN', tokenType: 'all' };
    pruningRules = [...pruningRules, newRule];
    if (initialized) pruningRules$.next(pruningRules);
  }

  function removeRule(index) {
    pruningRules = pruningRules.filter((_, i) => i !== index);
    if (initialized) pruningRules$.next(pruningRules);
  }

  function updateRule(index, field, value) {
    pruningRules = pruningRules.map((rule, i) => 
      i === index ? { ...rule, [field]: value } : rule
    );
    if (initialized) pruningRules$.next(pruningRules);
  }

  function addNeuronTarget() {
    const newTarget = { layer: 'L0_ATTN', neuron: 0, tokenType: 'cls' };
    neuronTargets = [...neuronTargets, newTarget];
    if (initialized) pruningTargets$.next(neuronTargets);
  }

  function removeNeuronTarget(index) {
    neuronTargets = neuronTargets.filter((_, i) => i !== index);
    if (initialized) pruningTargets$.next(neuronTargets);
  }

  function updateNeuronTarget(index, field, value) {
    neuronTargets = neuronTargets.map((target, i) => 
      i === index ? { ...target, [field]: value } : target
    );
    if (initialized) pruningTargets$.next(neuronTargets);
  }

  // Get the appropriate label for neuron input based on layer type
  function getNeuronLabel(layerValue) {
    return layerValue && layerValue.includes('ATTN') ? 'Head' : 'Neuron';
  }

  // Get max value for neuron/head input
  function getMaxNeuronValue(layerValue) {
    if (layerValue && layerValue.includes('ATTN')) {
      return 11; // 12 attention heads (0-11)
    }
    return neuronsPerLayer - 1; // FFN neurons
  }

  // --- Snapshot system for pruner configuration ---
  const PRUNER_SNAPSHOT_KEY = 'prunerSnapshotsV1';
  let prunerSnapshots = [];
  let selectedSnapshotId = '';

  function loadPersistedPrunerSnapshots() {
    try {
      const raw = localStorage.getItem(PRUNER_SNAPSHOT_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
  if (Array.isArray(arr)) prunerSnapshots = arr;
      if (prunerSnapshots.length && !selectedSnapshotId) {
        selectedSnapshotId = prunerSnapshots[prunerSnapshots.length - 1].id;
      }
    } catch (e) {
      console.warn('[PRUNER SNAPSHOTS] Failed to load:', e);
    }
  }

  function persistPrunerSnapshots() {
    try {
  localStorage.setItem(PRUNER_SNAPSHOT_KEY, JSON.stringify(prunerSnapshots.slice(-20)));
    } catch (e) {
      console.warn('[PRUNER SNAPSHOTS] Persist failed:', e);
    }
  }

  function formatPrunerSnapshotLabel(s) {
    const ts = s.timestamp || '';
    const a = (s.attentionThreshold ?? 0).toFixed(3);
    const f = (s.ffnThreshold ?? 0).toFixed(3);
    const rc = (s.pruningRules || []).length;
    const tc = (s.pruningTargets || []).length;
  return `${ts} | attn=${a} ffn=${f} | rules:${rc} targets:${tc}`;
  }

  function savePrunerSnapshot() {
    const snap = {
      id: `pruner-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      attentionThreshold: attentionThreshold$.getValue(),
      ffnThreshold: ffnThreshold$.getValue(),
      pruningRules: pruningRules$.getValue(),
      pruningTargets: pruningTargets$.getValue(),
    };
    prunerSnapshots.push(snap);
    if (prunerSnapshots.length > 50) prunerSnapshots = prunerSnapshots.slice(-50);
    selectedSnapshotId = snap.id;
    persistPrunerSnapshots();
  }

  function loadSelectedPrunerSnapshot() {
    const snap = prunerSnapshots.find(s => s.id === selectedSnapshotId);
    if (!snap) return;
    // Push into BehaviorSubjects; UI will sync via existing subscriptions
    attentionThreshold$.next(snap.attentionThreshold ?? 0);
    ffnThreshold$.next(snap.ffnThreshold ?? 0);
    pruningRules$.next(Array.isArray(snap.pruningRules) ? snap.pruningRules : []);
    pruningTargets$.next(Array.isArray(snap.pruningTargets) ? snap.pruningTargets : []);
  }

  function deleteSelectedPrunerSnapshot() {
    if (!selectedSnapshotId) return;
    prunerSnapshots = prunerSnapshots.filter(s => s.id !== selectedSnapshotId);
    if (prunerSnapshots.length) {
      selectedSnapshotId = prunerSnapshots[prunerSnapshots.length - 1].id;
    } else {
      selectedSnapshotId = '';
    }
    persistPrunerSnapshots();
  }

  onMount(() => {
    loadPersistedPrunerSnapshots();
  });
</script>

<style>
  /* Style your layout to match the screenshot */
  label {
    display: inline-block;
    width: 80px;
    font-weight: 600;
  }
  input[type=number] {
    width: 60px;
    border-radius: 8px;
    border: 1px solid black;
    text-align: center;
    font-weight: 600;
  }
  select {
    width: 100%;
    border: none;
    padding: 6px;
    font-weight: 600;
    background: white;
    font-size: inherit;
  }
  table {
    width: 100%; /* Full width since delete buttons are outside */
    border-collapse: collapse;
    margin-top: 10px;
    table-layout: fixed; /* Fixed layout to prevent column resizing */
  }
  tr {
    height: 40px;
  }
  th, td {
    border: 1px solid black;
    padding: 8px;
    text-align: center;
    font-weight: 600;
    height: 40px;
    box-sizing: border-box;
    vertical-align: middle;
  }
  th:first-child, td:first-child {
    width: 40%; /* Layer column */
  }
  th:nth-child(2), td:nth-child(2) {
    width: 30%; /* Token Type column */
  }
  th:last-child, td:last-child {
    width: 30%; /* Head/Neuron column */
  }
  td input[type=number] {
    width: 100%;
    border: none;
    padding: 6px;
    text-align: center;
    font-weight: 600;
    background: white;
  }
  .table-container {
    position: relative;
    display: block;
    margin-right: 30px; /* Reserve space for delete buttons aligned with + button */
  }
  .table-wrapper {
    position: relative;
    overflow: visible;
  }
  .table-row {
    position: relative;
    height: 40px; /* Set consistent row height */
  }
  .remove-button {
    position: absolute;
    right: -30px; /* Same horizontal position as + button */
    cursor: pointer;
    font-size: 20px; /* Same size as add button */
    font-weight: 700;
    color: red;
    background: none;
    border: none;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    user-select: none;
  }
  .add-button {
    cursor: pointer;
    font-size: 20px;
    font-weight: 700;
    user-select: none;
    color: green;
  }
  .add-button:hover, .remove-button:hover {
    opacity: 0.7;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 10px 80px; /* indent to align with number input after label */
  }
  .slider-row input[type=range] {
    flex: 1;
  }
  .slider-value {
    font-size: var(--text-label);
    font-weight: 600;
    width: 60px;
    text-align: right;
  }
</style>

<div>
  <div id="enable-pruning-toggle" bind:this={toggleContainer} style="display: inline-block;"></div>
</div>

<hr style="margin: 20px 0;" />

<h3>Saved Prunes</h3>
<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
  <select bind:value={selectedSnapshotId} style="flex: 1;">
    {#if prunerSnapshots.length === 0}
      <option value="" disabled>No saved prunes</option>
    {:else}
      {#each prunerSnapshots as s}
        <option value={s.id}>{formatPrunerSnapshotLabel(s)}</option>
      {/each}
    {/if}
  </select>
  <button class="add-button" title="Save current pruning config" on:click={savePrunerSnapshot}>+</button>
  <button class="remove-button" title="Delete selected prune" on:click={deleteSelectedPrunerSnapshot}>×</button>
  <button title="Load selected prune" on:click={loadSelectedPrunerSnapshot}>Load</button>
  <button title="Clear all prunes" on:click={() => { prunerSnapshots = []; selectedSnapshotId=''; persistPrunerSnapshots(); }}>Clear</button>
  
</div>

<hr style="margin: 20px 0;" />

<h3>Strategy Thresholds</h3>

<div>
  <label for="ffn-threshold">FFN</label>
  <input id="ffn-threshold" type="number" value={formatThreshold(ffnThreshold)} on:input={handleFFNThresholdChange} min="0" max="1" step="0.001" pattern="^\\d*(\\.\\d{0,3})?$" />
  <div class="slider-row">
    <input type="range" min="0" max="1" step="0.001" value={ffnSliderPos} on:input={handleFFNSliderInput} aria-label="FFN pruning threshold slider (log-scale)" />
    <span class="slider-value">{formatThreshold(ffnThreshold)}</span>
  </div>
</div>
<div>
  <label for="attention-threshold">Attention</label>
  <input id="attention-threshold" type="number" value={formatThreshold(attentionThreshold)} on:input={handleAttentionThresholdChange} min="0" max="1" step="0.001" pattern="^\\d*(\\.\\d{0,3})?$" />
  <div class="slider-row">
    <input type="range" min="0" max="1" step="0.001" value={attentionSliderPos} on:input={handleAttentionSliderInput} aria-label="Attention pruning threshold slider (log-scale)" />
    <span class="slider-value">{formatThreshold(attentionThreshold)}</span>
  </div>
</div>

<hr style="margin: 20px 0;" />

<div class="table-container">
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Layer</th>
          <th>Token Type</th>
        </tr>
      </thead>
      <tbody>
        {#each pruningRules as rule, i}
          <tr class="table-row">
            <td>
              <select value={rule.layer} on:change={(e) => updateRule(i, 'layer', e.target.value)}>
                {#each layerOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </td>
            <td>
              <select value={rule.tokenType} on:change={(e) => updateRule(i, 'tokenType', e.target.value)}>
                {#each tokenTypes as tokenType}
                  <option value={tokenType}>{tokenType}</option>
                {/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    
    <!-- Delete buttons positioned outside the table -->
    {#each pruningRules as rule, i}
      <button type="button" class="remove-button" style="top: {50 + i * 40}px;" on:click={() => removeRule(i)} aria-label="Remove rule">×</button>
    {/each}
  </div>
</div>

<button type="button" class="add-button" on:click={addRule} style="float: right;" aria-label="Add pruning rule">+</button>

<hr style="margin: 20px 0;" />

<div class="table-container">
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Layer</th>
          <th>Type</th>
          <th>Neuron</th>
        </tr>
      </thead>
      <tbody>
        {#each neuronTargets as target, i}
          <tr class="table-row">
            <td>
              <select value={target.layer} on:change={(e) => updateNeuronTarget(i, 'layer', e.target.value)}>
                {#each layerOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </td>
            <td>
              <select value={target.tokenType} on:change={(e) => updateNeuronTarget(i, 'tokenType', e.target.value)}>
                {#each tokenTypes.filter(t => t !== 'all') as tokenType}
                  <option value={tokenType}>{tokenType}</option>
                {/each}
              </select>
            </td>
            <td>
              <input 
                type="number" 
                value={target.neuron} 
                on:input={(e) => updateNeuronTarget(i, 'neuron', e.target.value)}
                min="0" 
                max={getMaxNeuronValue(target.layer)}
                placeholder={`${getNeuronLabel(target.layer)} index`}
              />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    
    <!-- Delete buttons positioned outside the table -->
    {#each neuronTargets as target, i}
      <button type="button" class="remove-button" style="top: {50 + i * 40}px;" on:click={() => removeNeuronTarget(i)} aria-label="Remove neuron target">×</button>
    {/each}
  </div>
</div>

<button type="button" class="add-button" on:click={addNeuronTarget} style="float: right;" aria-label="Add neuron target">+</button>

<hr style="margin: 20px 0;" />


