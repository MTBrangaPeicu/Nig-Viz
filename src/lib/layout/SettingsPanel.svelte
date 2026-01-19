<script lang="ts">
  interface Props {
    visible?: boolean;
  }

  let { visible = false }: Props = $props();
  
  let threshold = $state(0.5);
  let useAbsoluteValues = $state(true);
  let architectureNodeColors = $state(false);
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <!-- Threshold Slider -->
      <div class="space-y-2">
        <label class="label">
          <span class="label-text font-semibold">🎚️ Threshold for NIG Values</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          class="range range-sm"
          bind:value={threshold}
        />
        <div class="flex justify-between text-xs text-base-content/60">
          <span>0%</span>
          <span class="font-mono">{(threshold * 100).toFixed(1)}%</span>
          <span>100%</span>
        </div>
        <p class="text-xs text-base-content/70">
          Select the percentage of highest-magnitude NIG values to visualize.
        </p>
      </div>

      <div class="divider"></div>

      <!-- Visualization Settings -->
      <div class="space-y-3">
        <h3 class="font-semibold text-sm">Visualization Settings</h3>
        
        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text">Use Absolute Values</span>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={useAbsoluteValues}
            />
          </label>
          <p class="text-xs text-base-content/60 mt-1">
            {useAbsoluteValues ? 'Enabled' : 'Disabled'}
          </p>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text">Architecture Node Colors</span>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={architectureNodeColors}
            />
          </label>
          <p class="text-xs text-base-content/60 mt-1">
            {architectureNodeColors ? 'Enabled' : 'Disabled'}
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
