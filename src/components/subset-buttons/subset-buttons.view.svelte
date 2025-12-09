<script>
  import { onMount, onDestroy } from 'svelte';
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

<div class="subset-buttons" {id}>
  {#each options as opt}
    <button class:selected={opt === selected} on:click={() => choose(opt)}>{opt}</button>
  {/each}
</div>

<style>
.subset-buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; }
button { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
button.selected { background: #1d4ed8; color: white; border-color: #1d4ed8; }
</style>
