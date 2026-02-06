<script>
  import { onMount, onDestroy } from 'svelte';
  export let title = '';
  export let options$;
  export let value$;
  export let id; // keep API in sync with component

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
    return () => {
      if (unsub1 && typeof unsub1.unsubscribe === 'function') unsub1.unsubscribe();
      if (unsub2 && typeof unsub2.unsubscribe === 'function') unsub2.unsubscribe();
    };
  });

  onDestroy(() => {
    if (unsub1 && typeof unsub1.unsubscribe === 'function') unsub1.unsubscribe();
    if (unsub2 && typeof unsub2.unsubscribe === 'function') unsub2.unsubscribe();
  });

  function choose(opt) {
    if (value$ && typeof value$.next === 'function') value$.next(opt);
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
        class="btn btn-sm btn-outline"
        class:btn-active={opt === selected} 
        on:click={() => choose(opt)}
      >
        {opt}
      </button>
    {/each}
  </div>
</div>

<style>
.subset-buttons { display: flex; flex-wrap: wrap; gap: 0.25rem; }
</style>
