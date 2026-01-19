<script lang="ts">
  interface Props {
    visible?: boolean;
  }

  let { visible = false }: Props = $props();
  
  let snapshots = $state<string[]>(['No snapshots']);
  let selectedSnapshot = $state('');
</script>

<div 
  class="h-full bg-base-100 overflow-hidden flex flex-col"
>
  {#if visible}
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div class="space-y-2">
        <label class="label">
          <span class="label-text font-semibold">📸 Saved NIG Runs</span>
        </label>
        
        <select
          class="select select-bordered select-sm w-full text-xs"
          bind:value={selectedSnapshot}
        >
          {#each snapshots as snapshot}
            <option value={snapshot}>{snapshot}</option>
          {/each}
        </select>
      </div>

      <div class="flex gap-2">
        <button class="btn btn-sm btn-outline flex-1">
          Load Previous
        </button>
        <button class="btn btn-sm btn-outline flex-1">
          Clear
        </button>
      </div>

      <div class="divider"></div>

      <div class="alert text-xs">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        <span>No snapshots available yet</span>
      </div>
    </div>
  {/if}
</div>
