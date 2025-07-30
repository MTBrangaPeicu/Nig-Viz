<script>
  import { toggle } from '@marcellejs/gui-widgets';
  import { onMount, onDestroy } from 'svelte';
  import { BehaviorSubject } from 'rxjs';

  // BehaviorSubject to hold enabled state
  const enabled$ = new BehaviorSubject(false);

  let enabledWidget;
  let toggleContainer;

  // Inputs for thresholds
  let ffnThreshold = 0.0;
  let attentionThreshold = 0.0;

  // For simplicity, pruningRules as array of objects
  let pruningRules = [];

  // Sync from BehaviorSubject to local variable for toggle
  let enabled = false;

  onMount(() => {
    enabledWidget = toggle(false);
    enabledWidget.mount(toggleContainer);

    // Subscribe toggle changes to BehaviorSubject and local variable
    const sub = enabledWidget.$checked.subscribe(value => {
      enabled$.next(value);
      enabled = value;
    });

    // Subscribe BehaviorSubject changes to update toggle (in case of external updates)
    const enabledSub = enabled$.subscribe(value => {
      if (enabledWidget) {
        enabledWidget.checked = value;
      }
      enabled = value;
    });

    return () => {
      sub.unsubscribe();
      enabledSub.unsubscribe();
      enabledWidget.unmount();
    };
  });

  function addRule() {
    pruningRules = [...pruningRules, { layer: 0, tokenType: 'all' }];
  }
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
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  th, td {
    border: 1px solid black;
    padding: 6px;
    text-align: center;
    font-weight: 600;
  }
  .add-button {
    cursor: pointer;
    font-size: 20px;
    font-weight: 700;
    user-select: none;
  }
</style>

<div>
  <div id="enable-pruning-toggle" bind:this={toggleContainer} style="display: inline-block;"></div>
</div>

<hr style="margin: 20px 0;" />

<h3>Strategy Thresholds</h3>

<div>
  <label for="ffn-threshold">FFN</label>
  <input id="ffn-threshold" type="number" bind:value={ffnThreshold} min="0" max="1" step="0.01" />
</div>
<div>
  <label for="attention-threshold">Attention</label>
  <input id="attention-threshold" type="number" bind:value={attentionThreshold} min="0" max="1" step="0.01" />
</div>

<hr style="margin: 20px 0;" />

<table>
  <thead>
    <tr>
      <th>Layer</th>
      <th>Token Type</th>
    </tr>
  </thead>
  <tbody>
    {#each pruningRules as rule, i}
      <tr>
        <td>{rule.layer}</td>
        <td>{rule.tokenType}</td>
      </tr>
    {/each}
  </tbody>
</table>

<button type="button" class="add-button" on:click={addRule} style="float: right;" aria-label="Add pruning rule">+</button>

<hr style="margin: 20px 0;" />

<table>
  <thead>
    <tr>
      <th>Neurons</th>
      <th>NIG</th>
    </tr>
  </thead>
  <tbody>
    <!-- Add neuron rows here -->
  </tbody>
</table>

<div class="add-button" style="float: right;">+</div>

<hr style="margin: 20px 0;" />


