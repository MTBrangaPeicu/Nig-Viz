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
  
  // Tooltip state
  let showTooltip = false;
  let tooltipX = 0;
  
  const onMouseMove = (evt) => {
    if (evt.buttons === 1) { // Only show when dragging
      showTooltip = true;
      const rect = evt.target.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      tooltipX = x;
    }
  };
  
  const onMouseDown = () => {
    showTooltip = true;
  };
  
  const onMouseUp = () => {
    showTooltip = false;
  };
  
  const onMouseLeave = () => {
    showTooltip = false;
  };

  const sub = value$ && value$.subscribe((v) => (s = v));
  const subOpt = options$ && options$.subscribe((v) => (options = v || {}));
</script>

<div class="log-slider">
  <input 
    type="range" 
    min="0" 
    max="1" 
    step="0.01" 
    value={s} 
    on:input={onInput}
    on:mousemove={onMouseMove}
    on:mousedown={onMouseDown}
    on:mouseup={onMouseUp}
    on:mouseleave={onMouseLeave}
    class="range range-xs" 
  />
  
  {#if showTooltip}
    <div class="tooltip" style={`left: ${tooltipX}px`}>
      {label(s)}
    </div>
  {/if}
  
  <div class="ticks">
    {#each ticks as t}
      <div class="tick" style={`left:${t*100}%`}>
        <div class="mark"></div>
        <div class="lbl">{label(t)}</div>
      </div>
    {/each}
    
    {#if options.globalExtent && Array.isArray(options.globalExtent) && options.globalExtent.length === 2}
      <!-- Max value at left edge -->
      <div class="extent-tick extent-left">
        <div class="extent-lbl">max: {formatExtent(options.globalExtent[1])}</div>
      </div>
      <!-- Min value at right edge -->
      <div class="extent-tick extent-right">
        <div class="extent-lbl">min: {formatExtent(options.globalExtent[0])}</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .log-slider { 
    position: relative; 
    padding: 16px 12px 8px 12px;
    background: transparent;
  }
  
  input[type="range"] { 
    width: 100%;
  }
  
  .tooltip {
    position: absolute;
    top: -8px;
    transform: translateX(-50%);
    background: oklch(var(--b1));
    color: oklch(var(--bc));
    padding: 4px 8px;
    border-radius: 4px;
    font-size: var(--text-axis);
    font-weight: 600;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    border: 1px solid oklch(var(--bc) / 0.2);
    white-space: nowrap;
    z-index: 10;
  }
  
  .ticks { 
    position: relative; 
    height: 48px;
    margin-top: 4px;
  }
  
  .tick { 
    position: absolute; 
    transform: translateX(-50%); 
    text-align: center; 
  }
  
  .tick .mark { 
    width: 1px; 
    height: 6px; 
    background: oklch(var(--bc) / 0.4);
    margin: 0 auto; 
  }
  
  .tick .lbl { 
    font-size: var(--text-axis); 
    color: oklch(var(--bc) / 0.6);
    margin-top: 2px; 
  }
  
  .extent-tick { 
    position: absolute; 
    text-align: center;
  }
  
  .extent-tick.extent-left {
    left: 0;
    transform: none;
  }
  
  .extent-tick.extent-right {
    right: 0;
    left: auto;
    transform: none;
  }
  
  .extent-tick .extent-lbl { 
    font-size: var(--text-small); 
    color: oklch(var(--p));
    font-weight: 600; 
    margin-top: 28px;
    white-space: nowrap;
  }
</style>
