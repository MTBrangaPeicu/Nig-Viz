<script>
  export let value$; // BehaviorSubject s∈[0,1]
  export let options$; // BehaviorSubject with globalExtent
  let s = 0.5;
  let options = {};
  let el;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const label = (x) => {
    // Special case: x = 0 means show nothing (0%)
    if (x === 0) return '0%';
    
    // For x > 0, map logarithmically: x ∈ (0,1] → threshold ∈ [0.0001, 1]
    // This gives logarithmic spacing for 0.01% to 100%
    const threshold = Math.pow(10, -4 + 4 * x);
    const percentage = threshold * 100;
    // Format as percentage
    if (percentage >= 10) return percentage.toFixed(0) + '%';
    if (percentage >= 1) return percentage.toFixed(1) + '%';
    if (percentage >= 0.1) return percentage.toFixed(2) + '%';
    return percentage.toFixed(3) + '%';
  };

  const formatExtent = (val) => {
    if (!Number.isFinite(val)) return 'n/a';
    const a = Math.abs(val);
    if (a >= 0.1) return val.toFixed(3);
    if (a >= 0.001) return val.toFixed(4);
    if (a >= 0.0001) return val.toFixed(5);
    return val.toExponential(2);
  };

  const onInput = (evt) => {
    s = parseFloat(evt.target.value);
    value$.next(s);
  };

  const sub = value$ && value$.subscribe((v) => (s = v));
  const subOpt = options$ && options$.subscribe((v) => (options = v || {}));
</script>

<div class="log-slider">
  <input type="range" min="0" max="1" step="0.01" {s} on:input={onInput} />
  <div class="ticks">
    {#each ticks as t}
      <div class="tick" style={`left:${t*100}%`}>
        <div class="mark"></div>
        <div class="lbl">{label(t)}</div>
      </div>
    {/each}
    
    {#if options.globalExtent && Array.isArray(options.globalExtent) && options.globalExtent.length === 2}
      <!-- Max value at left edge (slider left = higher threshold = top % = max values) -->
      <div class="extent-tick" style="left:0%">
        <div class="extent-lbl">max: {formatExtent(options.globalExtent[1])}</div>
      </div>
      <!-- Min value at right edge (slider right = lower threshold = more values = min values) -->
      <div class="extent-tick" style="left:100%">
        <div class="extent-lbl">min: {formatExtent(options.globalExtent[0])}</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .log-slider { position: relative; padding: 22px 20px 8px; }
  input[type="range"] { width: 100%; }
  .ticks { position: relative; height: 40px; }
  .tick { position: absolute; transform: translateX(-50%); text-align: center; }
  .tick .mark { width: 1px; height: 8px; background: #888; margin: 0 auto; }
  .tick .lbl { font-size: 12px; color: #555; margin-top: 2px; }
  
  .extent-tick { position: absolute; text-align: center; transform: translateX(-50%); }
  .extent-tick .extent-lbl { 
    font-size: 10px; 
    color: #096286; 
    font-weight: 600; 
    margin-top: 26px;
    white-space: nowrap;
  }
</style>
