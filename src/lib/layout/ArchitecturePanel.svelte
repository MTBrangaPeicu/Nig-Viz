<script lang="ts">
  interface Props {
    visible?: boolean;
    absoluteValuesToggle?: any;
    architectureColorsToggle?: any;
  }

  let { 
    visible = false,
    absoluteValuesToggle,
    architectureColorsToggle
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
      <!-- Visualization Settings -->
      <div class="space-y-3">
        <h3 class="font-semibold text-sm">Visualization Settings</h3>
        
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
            <span class="label-text">Architecture Node Colors</span>
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
