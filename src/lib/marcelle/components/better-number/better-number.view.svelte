<script>
  export let title = '';
  export let value;
  export let step;
  export let id = 'better-number-default'; // Unique id passed from component
</script>

<div class="form-control w-full flex flex-col">
  {#if title}
    <label class="label" for="{id}-input">
      <span class="label-text font-semibold">{title}</span>
    </label>
  {/if}
  <div class="join" style="width: fit-content;">
    <button
      class="btn btn-sm join-item"
      style="width: 2rem;"
      onclick={() => value.next(Math.max($value - step, 10))} 
    >−</button>

    <input
      id="{id}-input"
      class="input input-sm input-bordered join-item text-center"
      style="width: 4rem;"
      type="number"
      inputmode="decimal"
      bind:value={$value} 
      onchange={(e) => {
        const x = parseFloat(e.target.value);
        if (!isNaN(x)) value.next(Math.max(x, 10)); 
        else e.target.value = $value.toString();
      }}
    />

    <button
      class="btn btn-sm join-item"
      style="width: 2rem;"
      onclick={() => value.next($value + step)} 
    >+</button>
  </div>
</div>

<style>
  /* Remove spinner arrows */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type='number'] {
    -moz-appearance: textfield;
  }
</style>
