<script>
  // @ts-nocheck
  import * as d3 from 'd3';
  import { onMount, onDestroy } from 'svelte';
  export let options$;
  export let globalCutoff$;
  export let id; // keep API similar to other components

  let options = {};
  let globalCutoff = 0;
  let svgEl; // bound SVG element
  let showEmpty = false; // empty-state flag

  let subOptions;
  let subCutoff;
  
  onMount(() => {
    if (options$ && typeof options$.subscribe === 'function') {
      subOptions = options$.subscribe((v) => {
        options = v || {};
        draw();
      });
    }
    if (globalCutoff$ && typeof globalCutoff$.subscribe === 'function') {
      subCutoff = globalCutoff$.subscribe((v) => {
        globalCutoff = v;
        draw();
      });
    }
    return () => {
      if (subOptions && typeof subOptions.unsubscribe === 'function') subOptions.unsubscribe();
      if (subCutoff && typeof subCutoff.unsubscribe === 'function') subCutoff.unsubscribe();
    };
  });

  onDestroy(() => {
    if (subOptions && typeof subOptions.unsubscribe === 'function') subOptions.unsubscribe();
    if (subCutoff && typeof subCutoff.unsubscribe === 'function') subCutoff.unsubscribe();
  });

  function flattenNigValues(values, type) {
    if (!values) return [];
    // If it's a map of layers -> tensors, flatten all recursively
    if (typeof values === 'object' && !Array.isArray(values)) {
      const out = [];
      for (const key in values) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
        const v = values[key];
        // Recurse into arrays or nested objects
        if (Array.isArray(v) || (v && typeof v === 'object')) {
          out.push(...flattenNigValues(v, null));
        }
      }
      return out;
    }
    if (type === 'FFN') {
      // values: (5, neurons)
      return values.flatMap((row) => row.map((x) => x));
    }
    if (type === 'ATTN') {
      // values: (12, 5, 5)
      const out = [];
      for (let h = 0; h < values.length; h++) {
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const v = values[h][i][j];
            if (v != null) out.push(v);
          }
        }
      }
      return out;
    }
    // If full layer tensor passed for violin plot usage (type may be undefined)
  if (Array.isArray(values) && Array.isArray(values[0])) {
      // Try detect ATTN-like 3D
      if (Array.isArray(values[0][0])) {
        const out = [];
        for (const head of values) {
          for (const row of head) {
            for (const v of row) out.push(v);
          }
        }
        return out;
      }
      // 2D
      return values.flat().map((x) => x);
    }
    // 1D vector (e.g., FFN neuron values for a single token)
    if (Array.isArray(values)) {
      return values.filter((v) => Number.isFinite(v));
    }
    return [];
  }

  function draw() {
  if (!svgEl) return;

  // Use reactive globalCutoff from stream, not from options
  const { values, type, threshold, scale = 'symlog', bins: binsPref, extent, absMax: absMaxGlobal, useAbsoluteValues = true } = options || {};
    const data = flattenNigValues(values, type);

  if (!data.length) {
    // When empty, clear any existing SVG contents but keep the container mounted
    const svg = d3.select(svgEl);
    svg.attr('width', 0).attr('height', 0);
    svg.selectAll('*').remove();
    showEmpty = true;
    return;
  } else {
    showEmpty = false;
  }
  
  // Fixed width for histogram - container will scroll if needed
  const width = 800; 
  const height = 300; 
  const margin = { top: 48, right: 24, bottom: 72, left: 60 };
  const gutter = 100; // space between histogram and ECDF panels

  // Prepare signed and absolute arrays
  const signedData = data.filter((v) => isFinite(v));
  const absData = signedData.map((d) => Math.abs(d));
  const n = absData.length;
  const sortedAsc = [...absData].sort((a, b) => a - b);

  // Domain on signed values
  let xMin;
  let xMax;
  if (extent && Array.isArray(extent) && extent.length === 2 && isFinite(extent[0]) && isFinite(extent[1]) && extent[1] > extent[0]) {
    // Use global min/max exactly when provided
    xMin = extent[0];
    xMax = extent[1];
  } else {
    const xRawMin = d3.min(signedData);
    const xRawMax = d3.max(signedData);
    xMin = xRawMin; xMax = xRawMax;
    if (!(xMax > xMin)) {
      const pad = Math.max(1e-8, Math.abs(xMin) * 0.1 || 1e-6);
      xMin = (xRawMin || 0) - pad;
      xMax = (xRawMax || 0) + pad;
    } else {
      const span = xMax - xMin;
      const pad = span * 0.04;
      xMin -= pad;
      xMax += pad;
    }
  }

  // X scales
    // - Histogram: signed symlog
  const linthresh = 1e-4;
  const x = (scale === 'symlog' ? d3.scaleSymlog().constant(linthresh) : d3.scaleSymlog().constant(linthresh))
      .domain([xMin, xMax])
      .range([0, (width - margin.left - margin.right - gutter) / 2]);
    // - ECDF: absolute symlog from 0..max(|x|) to avoid negative ticks
    const xAbsMax = (Number.isFinite(absMaxGlobal) && absMaxGlobal > 0)
      ? absMaxGlobal
      : (d3.max(absData) || 1);
  const xAbs = d3.scaleSymlog().constant(linthresh)
      .domain([0, xAbsMax])
      .range([0, (width - margin.left - margin.right - gutter) / 2]);

    const panelWidth = x.range()[1];
    const panelHeight = height - margin.top - margin.bottom;

    // Helper function to compute adaptive bin count based on data distribution
    const computeAdaptiveBinCount = (values, linthresh, binsPerDecade = 10, linearBins = 10) => {
      // Filter non-zero absolute values
      const absVals = values.map(v => Math.abs(v)).filter(v => v !== 0 && isFinite(v));
      if (absVals.length === 0) return 100; // fallback
      
      const vmin = Math.min(...absVals);
      const vmax = Math.max(...absVals);
      
      // Number of decades in log region (above linthresh)
      const decades = Math.log10(vmax) - Math.log10(Math.max(vmin, linthresh));
      
      // Log bins on each side (positive and negative)
      const nLogBins = Math.max(0, Math.floor(decades * binsPerDecade));
      
      // Total: negative log bins + linear region bins + positive log bins
      const totalBins = nLogBins + linearBins + nLogBins;
      
      // Cap to reasonable range
      return Math.max(50, Math.min(150, totalBins));
    };

    // Helper function to create visually uniform bins using the x scale
    const makeSymlogBins = (values, min, max, linthresh, binsPerDecade = 30, linearBins = 30) => {
      // Calculate total number of bins based on domain coverage
      const absMin = Math.abs(min);
      const absMax = Math.abs(max);
      const domainAbsMax = Math.max(absMin, absMax);
      
      if (domainAbsMax <= linthresh) {
        // Entire domain is within linear region - use simple linear bins
        const totalBins = linearBins;
        return Array.from({ length: totalBins + 1 }, (_, i) => min + (max - min) * i / totalBins);
      }
      
      // Calculate total bins: log regions + linear region
      const decades = Math.log10(domainAbsMax) - Math.log10(linthresh);
      const nLogBins = Math.max(1, Math.floor(decades * binsPerDecade));
      const totalBins = nLogBins + linearBins + nLogBins;
      
      // Create bins evenly spaced in visual (pixel) space
      const thresholds = [];
      for (let i = 0; i <= totalBins; i++) {
        const pixel = (panelWidth * i) / totalBins;
        const dataValue = x.invert(pixel);
        thresholds.push(dataValue);
      }
      
      // Ensure the last threshold slightly exceeds max to catch boundary values
      // d3.bin() uses [x0, x1) intervals, so we need to extend beyond max
      if (thresholds.length > 0 && thresholds[thresholds.length - 1] <= max) {
        const epsilon = Math.abs(max) * 1e-10 + 1e-15;
        thresholds[thresholds.length - 1] = max + epsilon;
      }
      
      return thresholds;
    };

    // Configurable bin density parameters
    const binsPerDecade = 10;  // Adjust this to control bin density in log regions
    const linearBins = 10;     // Adjust this to control bins in linear region
    
    // Compute adaptive bin count or use provided preference
    const adaptiveBinCount = computeAdaptiveBinCount(signedData, linthresh, binsPerDecade, linearBins);
    const binCount = binsPref ? Math.max(1, Math.min(400, Math.round(binsPref))) : adaptiveBinCount;
    
    // Create symlog-friendly bins using the same parameters
    const thresholds = makeSymlogBins(signedData, xMin, xMax, linthresh, binsPerDecade, linearBins);
    const binnerSigned = d3.bin().domain([xMin, xMax]).thresholds(thresholds);
    const binsSigned = binnerSigned(signedData);
    const yMaxCount = d3.max(binsSigned, (d) => d.length) || 0;
    
    // Use symlog for y-axis to show bins with count >= 1
    // Use a larger linthresh to ensure count=1 bins are visible
    // linthresh of 2 means counts from 0-2 are in linear region, making count=1 clearly visible
    const yLinthresh = 2;
    const useSymlogY = yMaxCount > 1;
    const yHist = useSymlogY
      ? d3.scaleSymlog().constant(yLinthresh).domain([0, yMaxCount]).range([panelHeight, 0])
      : d3.scaleLinear().domain([0, yMaxCount]).range([panelHeight, 0]);

    // Y scale for ECDF
    const yCdf = d3.scaleLinear().domain([0, 1]).range([panelHeight, 0]);

    const svg = d3
      .select(svgEl)
      .attr('width', width)
      .attr('height', height)
      .style('background', '#fff')
      .style('border', '1px solid #ddd')
      .style('border-radius', '12px')
      .style('font-family', 'sans-serif')
      .style('font-size', '13px');
    // Clear previous render
    svg.selectAll('*').remove();

    // Histogram panel group
    const gHist = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    // ECDF panel group (to the right)
    const gCdf = svg.append('g').attr('transform', `translate(${margin.left + panelWidth + gutter},${margin.top})`);

    // Helper: symlog-friendly tick values to reduce label overlap
    const fmtPlain = (v) => {
      const a = Math.abs(v);
      if (a >= 0.1) return v.toFixed(1);
      if (a >= 0.01) return v.toFixed(2);
      if (a >= 0.001) return v.toFixed(3);
      if (a >= 0.0001) return v.toFixed(4);
      return v.toString();
    };
    const buildSignedLogTicks = (min, max, lin) => {
      const maxAbs = Math.max(Math.abs(min || 0), Math.abs(max || 0), lin);
      const eMax = Math.floor(Math.log10(maxAbs));
      const eMin = Math.ceil(Math.log10(lin));
      const pos = [];
      for (let e = eMin; e <= eMax; e++) pos.push(Math.pow(10, e));
      // limit to at most 3 ticks per side to avoid overlap
      const pick = pos.slice(0, Math.min(3, pos.length));
      const neg = pick.map((v) => -v).filter((v) => v >= min);
      const posIn = pick.filter((v) => v <= max);
      return [...neg, ...posIn];
    };
    const buildAbsLogTicks = (max, lin) => {
      const eMax = Math.floor(Math.log10(Math.max(max, lin)));
      const eMin = Math.ceil(Math.log10(lin));
      const vals = [];
      for (let e = eMin; e <= eMax; e++) vals.push(Math.pow(10, e));
      return vals.slice(0, Math.min(4, vals.length));
    };

    // Compact numeric formatter for cutoff labels
    const fmtCutoff = (v) => {
      if (!Number.isFinite(v)) return 'n/a';
      const a = Math.abs(v);
      if (a >= 0.1) return v.toFixed(3);
      if (a >= 1e-3) return v.toFixed(4);
      return d3.format('.2e')(v);
    };

    // Formatter for tooltip - never uses scientific notation
    const fmtTooltip = (v) => {
      if (!Number.isFinite(v)) return 'n/a';
      const a = Math.abs(v);
      if (a >= 0.1) return v.toFixed(3);
      if (a >= 0.01) return v.toFixed(4);
      if (a >= 0.001) return v.toFixed(5);
      if (a >= 0.0001) return v.toFixed(6);
      if (a >= 0.00001) return v.toFixed(7);
      return v.toFixed(8);
    };

    let xTickVals = buildSignedLogTicks(xMin, xMax, linthresh);
    let xAbsTickVals = buildAbsLogTicks(xAbsMax, linthresh);

    // Add extent values to tick arrays if they exist and are finite
    if (extent && Array.isArray(extent) && extent.length === 2) {
      if (isFinite(extent[0]) && !xTickVals.includes(extent[0])) {
        xTickVals = [extent[0], ...xTickVals];
      }
      if (isFinite(extent[1]) && !xTickVals.includes(extent[1])) {
        xTickVals = [...xTickVals, extent[1]];
      }
      // For absolute scale, add the absolute max
      const absExtentMax = Math.max(Math.abs(extent[0]), Math.abs(extent[1]));
      if (isFinite(absExtentMax) && !xAbsTickVals.includes(absExtentMax)) {
        xAbsTickVals = [...xAbsTickVals, absExtentMax];
      }
    }

    // Custom tick format that highlights extent values in blue
    const fmtTickWithExtent = (d) => {
      const isExtentValue = extent && Array.isArray(extent) && 
        (Math.abs(d - extent[0]) < 1e-10 || Math.abs(d - extent[1]) < 1e-10);
      return isExtentValue ? `${d === extent[0] ? 'min: ' : 'max: '}${fmtCutoff(d)}` : fmtPlain(d);
    };

    // Axes with custom ticks and compact formatting
    gHist.append('g')
      .attr('transform', `translate(0,${panelHeight})`)
      .call(d3.axisBottom(x).tickValues(xTickVals).tickFormat(fmtTickWithExtent))
      .call((g) => {
        g.selectAll('text').style('font-size', '10px').attr('dy', '0.9em');
        // Style extent ticks in blue
        if (extent && Array.isArray(extent)) {
          g.selectAll('text').each(function(d) {
            if (Math.abs(d - extent[0]) < 1e-10 || Math.abs(d - extent[1]) < 1e-10) {
              d3.select(this).style('fill', '#096286').style('font-weight', '600');
            }
          });
        }
      });
    
    // Y-axis with symlog scale - create custom tick values (excluding max)
    const yTickValues = [];
    if (yMaxCount > 0) {
      // Always include 0
      yTickValues.push(0);
      // Add 1, 10, 100, etc. up to yMaxCount (but don't include yMaxCount itself)
      for (let i = 1; i < yMaxCount; i *= 10) {
        yTickValues.push(i);
      }
    }
    
    gHist.append('g').call(
      d3.axisLeft(yHist).tickValues(yTickValues).tickFormat(d3.format('~s'))
    );
    gCdf.append('g')
      .attr('transform', `translate(0,${panelHeight})`)
      .call(d3.axisBottom(xAbs).tickValues(xAbsTickVals).tickFormat((d) => fmtPlain(d)))
      .call((g) => g.selectAll('text').style('font-size', '10px').attr('dy', '0.9em'));
    gCdf.append('g').call(d3.axisLeft(yCdf).ticks(5));

    // ECDF x-axis label (changes based on mode)
    gCdf.append('text')
      .attr('x', panelWidth / 2)
      .attr('y', panelHeight + 36)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', '11px')
      .text(useAbsoluteValues ? '|NIG| value' : 'Positive NIG values');

    // Titles (placed in header area to avoid overlap)
    const titleStyle = { fill: '#333', 'font-size': '12px', 'font-weight': '600' };
    gHist.append('text')
      .attr('x', 0)
      .attr('y', -22)
      .attr('fill', titleStyle.fill)
      .style('font-size', titleStyle['font-size'])
      .style('font-weight', titleStyle['font-weight'])
      .text('Signed distribution of IG values (log density)');
    
    const cdfTitle = gCdf.append('text')
      .attr('x', 0)
      .attr('y', -22)
      .attr('fill', titleStyle.fill)
      .style('font-size', titleStyle['font-size'])
      .style('font-weight', titleStyle['font-weight'])
      .text(useAbsoluteValues ? 'ECDF + Mass-weighted ECDF of |NIG|' : 'ECDF + Mass-weighted ECDF of positive NIG');

    // Create tooltip
    const tooltip = d3.select('body').selectAll('.histogram-tooltip').data([null])
      .join('div')
      .attr('class', 'histogram-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(0, 0, 0, 0.8)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .style('font-family', 'sans-serif')
      .style('line-height', '1.5');

    // Signed histogram bars with symlog y-axis
    const yBase = 0; // With symlog, we can start from 0
    gHist
      .append('g')
      .selectAll('rect')
      .data(binsSigned)
      .join('rect')
      .attr('x', (d) => x(d.x0) + 1)
      .attr('y', (d) => yHist(d.length))
      .attr('width', (d) => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr('height', (d) => Math.max(0, yHist(yBase) - yHist(d.length)))
      .attr('fill', '#096286')
      .attr('fill-opacity', 0.7)
      .attr('stroke', '#333')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('fill-opacity', 1)
          .attr('stroke-width', 1.5);
        
        const binStart = fmtTooltip(d.x0);
        const binEnd = fmtTooltip(d.x1);
        const count = d.length;
        
        tooltip
          .style('visibility', 'visible')
          .html(`<strong>Bin Range:</strong> [${binStart}, ${binEnd})<br/><strong>Count:</strong> ${count}`);
      })
      .on('mousemove', function(event) {
        tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this)
          .attr('fill-opacity', 0.7)
          .attr('stroke-width', 0.5);
        
        tooltip.style('visibility', 'hidden');
      });

    // Axis labels
    gHist.append('text')
      .attr('x', panelWidth / 2)
      .attr('y', panelHeight + 36)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', '11px')
      .text('Integrated Gradients value');
    gHist.append('text')
      .attr('transform', `rotate(-90) translate(${-panelHeight / 2},${-40})`)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', '11px')
      .text('Count (log scale)');

    // ECDF (count-based) and mass-weighted ECDF
    // In absolute mode: use all absolute values
    // In signed mode: use only positive values
    let ecdfData, ecdfN, ecdfTotalMass;
    if (useAbsoluteValues) {
      // Absolute mode: ECDF of all absolute values
      ecdfData = sortedAsc;
      ecdfN = n;
      ecdfTotalMass = d3.sum(sortedAsc);
    } else {
      // Signed mode: ECDF of only positive values
      const positiveValues = signedData.filter(v => v > 0).sort((a, b) => a - b);
      ecdfData = positiveValues;
      ecdfN = positiveValues.length;
      ecdfTotalMass = d3.sum(positiveValues);
    }
    
    const ecdfCount = ecdfData.map((v, i) => ({ x: v, p: (i + 1) / ecdfN }));
    let runningMass = 0;
    const ecdfMass = ecdfData.map((v) => {
      runningMass += v;
      return { x: v, p: ecdfTotalMass > 0 ? runningMass / ecdfTotalMass : 0 };
    });
    const lineCount = d3.line().x((d) => xAbs(d.x)).y((d) => yCdf(d.p));
    const lineMass = d3.line().x((d) => xAbs(d.x)).y((d) => yCdf(d.p));
    gCdf.append('path')
      .datum(ecdfCount)
      .attr('fill', 'none')
      .attr('stroke', 'purple')
      .attr('stroke-width', 1.5)
      .attr('d', lineCount);
    gCdf.append('path')
      .datum(ecdfMass)
      .attr('fill', 'none')
      .attr('stroke', 'orange')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2,2')
      .attr('d', lineMass);
    // Legend (lower right)
    const legend = gCdf.append('g').attr('class','legend');
    const legendItems = [
      { color: 'purple', text: 'ECDF (count)' },
      { color: 'orange', text: 'Mass-weighted ECDF' },
    ];
    const legendBaseY = panelHeight - 10;
    const legendX = panelWidth - 12;
    legendItems.forEach((item, i) => {
      const yRow = legendBaseY - i * 16;
      legend.append('line')
        .attr('x1', legendX - 110)
        .attr('x2', legendX - 80)
        .attr('y1', yRow - 4)
        .attr('y2', yRow - 4)
        .attr('stroke', item.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', item.color === 'orange' ? '2,2' : null);
      legend.append('text')
        .attr('x', legendX - 75)
        .attr('y', yRow - 2)
        .attr('fill', '#333')
        .style('font-size','11px')
        .text(item.text);
    });

    // Threshold visuals: use architecture's global cutoff (already computed)
    if (typeof threshold === 'number' && threshold >= 0 && threshold <= 1 && Number.isFinite(globalCutoff)) {
      // Don't recompute - use the globalCutoff directly from architecture component
      // In absolute mode: globalCutoff is an absolute value (positive)
      // In signed mode: globalCutoff is a signed value (can be negative)
      const thrPos = globalCutoff;
      
      // For ECDF (always uses absolute values), convert to absolute
      const thrAbs = Math.abs(globalCutoff);
      const xAbsThr = xAbs(thrAbs);

      // Histogram: draw shading based on absolute vs signed mode
      if (thrPos != null && (useAbsoluteValues ? thrPos <= xMax : (thrPos >= xMin && thrPos <= xMax))) {
        const xThrPos = x(thrPos);
        const xThrNeg = x(-thrPos);
        const xRightMax = x(xMax);
        const xLeftMin = x(xMin);

        if (useAbsoluteValues) {
          // ABSOLUTE VALUES MODE: Shade BOTH sides (extreme negative AND extreme positive)
          // Shade from xMin to -thrPos (left side)
          gHist.append('rect')
            .attr('x', xLeftMin)
            .attr('y', 0)
            .attr('width', Math.max(0, xThrNeg - xLeftMin))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();
          
          // Shade from +thrPos to xMax (right side)
          gHist.append('rect')
            .attr('x', xThrPos)
            .attr('y', 0)
            .attr('width', Math.max(0, xRightMax - xThrPos))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();

          // Draw vertical lines at +thrPos and -thrPos
          gHist.append('line')
            .attr('x1', xThrNeg)
            .attr('x2', xThrNeg)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();
          gHist.append('line')
            .attr('x1', xThrPos)
            .attr('x2', xThrPos)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();

          // Label: show ±cutoff
          gHist.append('text')
            .attr('x', panelWidth)
            .attr('y', panelHeight + 54)
            .attr('fill', '#d32f2f')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .style('text-anchor', 'end')
            .text(`cutoff = ±${fmtCutoff(thrPos)}`);
        } else {
          // SIGNED VALUES MODE: Shade from cutoff to max (one side only)
          // thrPos is a signed value (can be negative)
          // Shade everything >= thrPos (to the right of the threshold line)
          gHist.append('rect')
            .attr('x', xThrPos)
            .attr('y', 0)
            .attr('width', Math.max(0, xRightMax - xThrPos))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();

          // Draw vertical line at thrPos (signed position)
          gHist.append('line')
            .attr('x1', xThrPos)
            .attr('x2', xThrPos)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();

          // Label the histogram cutoff value
          gHist.append('text')
            .attr('x', panelWidth)
            .attr('y', panelHeight + 54)
            .attr('fill', '#d32f2f')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .style('text-anchor', 'end')
            .text(`cutoff = ${fmtCutoff(thrPos)}`);
        }
      }

      // ECDF: vertical line and shaded region
      // In signed mode: if cutoff <= 0, show line at 0; otherwise show at cutoff position
      const ecdfCutoffValue = useAbsoluteValues ? thrAbs : Math.max(0, thrPos);
      const ecdfCutoffX = xAbs(ecdfCutoffValue);
      
      gCdf.append('text')
        .attr('x', panelWidth)
        .attr('y', -18)
        .attr('fill', titleStyle.fill)
        .style('text-anchor', 'end')
        .style('font-size', '11px')
        .text(useAbsoluteValues 
          ? `Top ${(threshold * 100).toFixed(1)}% by |NIG|`
          : `Top ${(threshold * 100).toFixed(1)}% of NIG`);
      gCdf.append('line')
        .attr('x1', ecdfCutoffX)
        .attr('x2', ecdfCutoffX)
        .attr('y1', 0)
        .attr('y2', panelHeight)
        .attr('stroke', 'crimson')
        .attr('stroke-dasharray', '4,2')
        .attr('stroke-width', 2);
      gCdf.append('rect')
        .attr('x', ecdfCutoffX)
        .attr('y', 0)
        .attr('width', Math.max(0, panelWidth - ecdfCutoffX))
        .attr('height', panelHeight)
        .attr('fill', 'crimson')
        .attr('opacity', 0.15)
        .lower();
      // Label the ECDF cutoff value below the panel (right-aligned)
      gCdf.append('text')
        .attr('x', panelWidth)
        .attr('y', panelHeight + 54)
        .attr('fill', 'crimson')
        .style('font-size', '11px')
        .style('font-weight', '600')
        .style('text-anchor', 'end')
        .text(useAbsoluteValues 
          ? `|cutoff| = ${fmtCutoff(thrAbs)}`
          : `cutoff = ${fmtCutoff(ecdfCutoffValue)}`);
      // Removed mass calculation
      const totalMass = useAbsoluteValues ? d3.sum(absData) : d3.sum(ecdfData);
      const removedMass = totalMass > 0 
        ? (useAbsoluteValues 
            ? d3.sum(absData.filter((v) => v >= thrAbs)) / totalMass
            : d3.sum(ecdfData.filter((v) => v >= ecdfCutoffValue)) / totalMass)
        : 0;
      gCdf.append('text')
        .attr('x', panelWidth)
        .attr('y', -6)
        .attr('fill', titleStyle.fill)
        .style('text-anchor', 'end')
        .style('font-size', '11px')
        .text(useAbsoluteValues
          ? `Removes ~${(removedMass * 100).toFixed(1)}% of total |NIG| mass`
          : `Removes ~${(removedMass * 100).toFixed(1)}% of positive NIG mass`);
    }
  }
</script>

<svg bind:this={svgEl} {id}></svg>
