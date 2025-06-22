<script>
  let { value, step } = $props(); 
</script>

<div class="mgui-w-full mgui-max-w-sm">
  <div class="md:mgui-flex md:mgui-items-center mgui-mb-2">
    <div class="mgui-join">
      <button
        class="mgui-btn mgui-btn-sm mgui-join-item"
        onclick={() => value.next(Math.max($value - step, 10))} 
      >-</button>

      <div>
        <input
          class="mgui-input mgui-input-sm mgui-input-bordered mgui-join-item mgui-w-20"
          type="number"
          inputmode="decimal"
          bind:value={$value} 
          onchange={(e) => {
            const x = parseFloat(e.target.value);
            if (!isNaN(x)) value.next(Math.max(x, 10)); 
            else e.target.value = $value.toString();
          }}
        />
      </div>

      <button
        class="mgui-btn mgui-btn-sm mgui-join-item"
        onclick={() => value.next($value + step)} 
      >+</button>
    </div>
  </div>
</div>

<style>
  /* Chrome, Safari, Edge, Opera */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Firefox */
  input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
</style>
