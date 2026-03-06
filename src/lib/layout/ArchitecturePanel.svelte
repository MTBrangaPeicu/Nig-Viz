<script lang="ts">
  interface Props {
    visible?: boolean;
    absoluteValuesToggle?: any;
    architectureColorsToggle?: any;
    selectionAssistEnabled?: boolean;
  }

  let { 
    visible = false,
    absoluteValuesToggle,
    architectureColorsToggle,
    selectionAssistEnabled = $bindable(true)
  }: Props = $props();
  
  // Local state for UI binding - sync from toggles only
  let useAbsoluteValuesChecked = $state(true);
  let showNodeColorsChecked = $state(false);

  // One-way sync: toggle stream -> UI state (read only)
  $effect(() => {
    if (absoluteValuesToggle) {
      const sub = absoluteValuesToggle.$checked.subscribe((val: boolean) => {
        useAbsoluteValuesChecked = val;
      });
      return () => sub?.unsubscribe?.();
    }
  });
  
  $effect(() => {
    if (architectureColorsToggle) {
      const sub = architectureColorsToggle.$checked.subscribe((val: boolean) => {
        showNodeColorsChecked = val;
      });
      return () => sub?.unsubscribe?.();
    }
  });
  
  // When UI checkbox changes, update the toggle
  function handleAbsoluteValuesChange(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (absoluteValuesToggle) {
      absoluteValuesToggle.$checked.next(checked);
    }
  }
  
  function handleArchColorsChange(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (architectureColorsToggle) {
      architectureColorsToggle.$checked.next(checked);
    }
  }
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <!-- Section Header with Tooltip -->
      <div class="section-header">
        <span class="section-title">Architecture Settings</span>
        <span class="tooltip-wrapper">
          <span class="tooltip-icon">?</span>
          <span class="tooltip-text">Configure visualization thresholds and display options. Absolute values shows both large - and + values. Colour nodes displays the largest head/neuron values.</span>
        </span>
      </div>

      <div class="divider my-2"></div>

      <!-- Visualization Settings -->
      <div class="space-y-3">
        
        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text">Use Absolute Values</span>
            <input
              type="checkbox"
              class="toggle"
              checked={useAbsoluteValuesChecked}
              onchange={handleAbsoluteValuesChange}
            />
          </label>
          <p class="text-xs text-base-content/60 mt-1">
            {useAbsoluteValuesChecked ? 'Enabled' : 'Disabled'}
          </p>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text">Architecture Node Colours</span>
            <input
              type="checkbox"
              class="toggle"
              checked={showNodeColorsChecked}
              onchange={handleArchColorsChange}
            />
          </label>
          <p class="text-xs text-base-content/60 mt-1">
            {showNodeColorsChecked ? 'Enabled' : 'Disabled'}
          </p>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text">Selection Assist</span>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={selectionAssistEnabled}
            />
          </label>
          <p class="text-xs text-base-content/60 mt-1">
            {selectionAssistEnabled ? 'Enabled' : 'Disabled'}
          </p>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Info -->
      <div class="alert text-xs">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span>Settings affect all visualizations globally</span>
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
