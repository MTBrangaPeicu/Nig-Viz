<script>
  import { onMount, onDestroy } from 'svelte';
  export let title = '';
  export let options$;
  export let value$;
  export let activeSubsets$ = null;
  export let id;

  let options = [];
  let selected = null;
  let unsub1, unsub2;

  onMount(() => {
    if (options$ && typeof options$.subscribe === 'function') {
      unsub1 = options$.subscribe((v) => {
        options = Array.isArray(v) ? v : [];
      });
    }
    if (value$ && typeof value$.subscribe === 'function') {
      unsub2 = value$.subscribe((v) => (selected = v));
    }
  });

  onDestroy(() => {
    if (unsub1 && typeof unsub1.unsubscribe === 'function') unsub1.unsubscribe();
    if (unsub2 && typeof unsub2.unsubscribe === 'function') unsub2.unsubscribe();
  });

  function select(opt) {
    if (value$ && typeof value$.next === 'function') {
      value$.next(opt);
    }
  }
</script>

<div class="form-control w-full flex flex-col">
  {#if title}
    <span id="{id}-label" class="label">
      <span class="label-text font-semibold">{title}</span>
    </span>
  {/if}
  <div class="subset-buttons" {id} role="group" aria-labelledby="{id}-label">
    {#each options as opt}
      <button 
        class="btn btn-sm subset-btn"
        class:active={opt === selected} 
        on:click={() => select(opt)}
      >
        {opt}
      </button>
    {/each}
  </div>
</div>

<style>
.subset-buttons { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 0.25rem; 
}

.subset-btn {
  background-color: hsl(var(--b2, 0 0% 93%));
  border: 1px solid hsl(var(--bc, 0 0% 20%) / 0.3);
  color: hsl(var(--bc, 0 0% 20%));
}

.subset-btn:hover {
  background-color: hsl(var(--b3, 0 0% 88%));
}

.subset-btn.active {
  background-color: hsl(var(--p, 262 80% 50%));
  border-color: hsl(var(--p, 262 80% 50%));
  color: hsl(var(--pc, 0 0% 100%));
  font-weight: 600;
}
</style>
