<script>
  // @ts-nocheck
  import * as d3 from 'd3';
  import { onMount, onDestroy } from 'svelte';
  export let options$;
  export let globalCutoff$;
  export let id;

  let options = {};
  let globalCutoff = 0;
  let svgEl;
  let showEmpty = false;

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
    if (typeof values === 'object' && !Array.isArray(values)) {
      const out = [];
      for (const key in values) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
        const v = values[key];
        if (Array.isArray(v) || (v && typeof v === 'object')) {
          out.push(...flattenNigValues(v, null));
        }
      }
      return out;
    }
    if (type === 'FFN') {
      return values.flatMap((row) => row.map((x) => x));
    }
    if (type === 'ATTN') {
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
    if (Array.isArray(values) && Array.isArray(values[0])) {
      if (Array.isArray(values[0][0])) {
        const out = [];
        for (const head of values) {
          for (const row of head) {
            for (const v of row) out.push(v);
          }
        }
        return out;
      }
      return values.flat().map((x) => x);
    }
    if (Array.isArray(values)) {
      return values.filter((v) => Number.isFinite(v));
    }
    return [];
  }

  function draw() {
    if (!svgEl) return;

    const { values, type, threshold, scale = 'symlog', bins: binsPref, extent, absMax: absMaxGlobal, useAbsoluteValues = true } = options || {};
    const data = flattenNigValues(values, type);

    // Fixed dimensions to prevent layout shifts
    const width = 380;
    const height = 280;
    const margin = { top: 50, right: 25, bottom: 90, left: 60 };

    if (!data.length) {
      const svg = d3.select(svgEl);
      svg.attr('width', width).attr('height', height);
      svg.selectAll('*').remove();
      showEmpty = true;
      return;
    } else {
      showEmpty = false;
    }

    const signedData = data.filter((v) => isFinite(v));
    const absData = signedData.map((d) => Math.abs(d));

    // Domain on signed values
    let xMin;
    let xMax;
    if (extent && Array.isArray(extent) && extent.length === 2 && isFinite(extent[0]) && isFinite(extent[1]) && extent[1] > extent[0]) {
      xMin = extent[0];
      xMax = extent[1];
    } else {
      const xRawMin = d3.min(signedData);
      const xRawMax = d3.max(signedData);
      xMin = xRawMin;
      xMax = xRawMax;
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

    const linthresh = 1e-4;
    const x = d3.scaleSymlog().constant(linthresh)
      .domain([xMin, xMax])
      .range([0, width - margin.left - margin.right]);

    const panelWidth = x.range()[1];
    const panelHeight = height - margin.top - margin.bottom;

    const computeAdaptiveBinCount = (values, linthresh, binsPerDecade = 10, linearBins = 10) => {
      const absVals = values.map(v => Math.abs(v)).filter(v => v !== 0 && isFinite(v));
      if (absVals.length === 0) return 100;
      
      const vmin = Math.min(...absVals);
      const vmax = Math.max(...absVals);
      const decades = Math.log10(vmax) - Math.log10(Math.max(vmin, linthresh));
      const nLogBins = Math.max(0, Math.floor(decades * binsPerDecade));
      const totalBins = nLogBins + linearBins + nLogBins;
      return Math.max(50, Math.min(150, totalBins));
    };

    const makeSymlogBins = (values, min, max, linthresh, binsPerDecade = 30, linearBins = 30) => {
      const absMin = Math.abs(min);
      const absMax = Math.abs(max);
      const domainAbsMax = Math.max(absMin, absMax);
      
      if (domainAbsMax <= linthresh) {
        const totalBins = linearBins;
        return Array.from({ length: totalBins + 1 }, (_, i) => min + (max - min) * i / totalBins);
      }
      
      const decades = Math.log10(domainAbsMax) - Math.log10(linthresh);
      const nLogBins = Math.max(1, Math.floor(decades * binsPerDecade));
      const totalBins = nLogBins + linearBins + nLogBins;
      
      const thresholds = [];
      for (let i = 0; i <= totalBins; i++) {
        const pixel = (panelWidth * i) / totalBins;
        const dataValue = x.invert(pixel);
        thresholds.push(dataValue);
      }
      
      if (thresholds.length > 0 && thresholds[thresholds.length - 1] <= max) {
        const epsilon = Math.abs(max) * 1e-10 + 1e-15;
        thresholds[thresholds.length - 1] = max + epsilon;
      }
      
      return thresholds;
    };

    const binsPerDecade = 10;
    const linearBins = 10;
    
    const adaptiveBinCount = computeAdaptiveBinCount(signedData, linthresh, binsPerDecade, linearBins);
    const binCount = binsPref ? Math.max(1, Math.min(400, Math.round(binsPref))) : adaptiveBinCount;
    
    const thresholds = makeSymlogBins(signedData, xMin, xMax, linthresh, binsPerDecade, linearBins);
    const binnerSigned = d3.bin().domain([xMin, xMax]).thresholds(thresholds);
    const binsSigned = binnerSigned(signedData);
    const yMaxCount = d3.max(binsSigned, (d) => d.length) || 0;
    
    const yLinthresh = 2;
    const useSymlogY = yMaxCount > 1;
    const yHist = useSymlogY
      ? d3.scaleSymlog().constant(yLinthresh).domain([0, yMaxCount]).range([panelHeight, 0])
      : d3.scaleLinear().domain([0, yMaxCount]).range([panelHeight, 0]);

    const svg = d3
      .select(svgEl)
      .attr('width', width)
      .attr('height', height)
      .style('background', '#fff')
      .style('border', '1px solid #ddd')
      .style('border-radius', '12px')
      .style('font-family', 'inherit')
      .style('font-size', 'var(--text-chart-title)');
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

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
      const pick = pos.slice(0, Math.min(3, pos.length));
      const neg = pick.map((v) => -v).filter((v) => v >= min);
      const posIn = pick.filter((v) => v <= max);
      return [...neg, ...posIn];
    };

    const fmtCutoff = (v) => {
      if (!Number.isFinite(v)) return 'n/a';
      const a = Math.abs(v);
      if (a >= 0.1) return v.toFixed(3);
      if (a >= 1e-3) return v.toFixed(4);
      return d3.format('.2e')(v);
    };

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

    if (extent && Array.isArray(extent) && extent.length === 2) {
      if (isFinite(extent[0]) && !xTickVals.includes(extent[0])) {
        xTickVals = [extent[0], ...xTickVals];
      }
      if (isFinite(extent[1]) && !xTickVals.includes(extent[1])) {
        xTickVals = [...xTickVals, extent[1]];
      }
    }

    const fmtTickWithExtent = (d) => {
      const isExtentValue = extent && Array.isArray(extent) && 
        (Math.abs(d - extent[0]) < 1e-10 || Math.abs(d - extent[1]) < 1e-10);
      return isExtentValue ? `${d === extent[0] ? 'min: ' : 'max: '}${fmtCutoff(d)}` : fmtPlain(d);
    };

    g.append('g')
      .attr('transform', `translate(0,${panelHeight})`)
      .call(d3.axisBottom(x).tickValues(xTickVals).tickFormat(fmtTickWithExtent))
      .call((g) => {
        g.selectAll('text')
          .style('font-size', 'var(--text-small)')
          .attr('dy', '0.5em')
          .attr('dx', '-0.5em')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');
        if (extent && Array.isArray(extent)) {
          g.selectAll('text').each(function(d) {
            if (Math.abs(d - extent[0]) < 1e-10 || Math.abs(d - extent[1]) < 1e-10) {
              d3.select(this).style('fill', '#096286').style('font-weight', '600');
            }
          });
        }
      });
    
    const yTickValues = [];
    if (yMaxCount > 0) {
      yTickValues.push(0);
      for (let i = 1; i < yMaxCount; i *= 10) {
        yTickValues.push(i);
      }
    }
    
    g.append('g').call(
      d3.axisLeft(yHist).tickValues(yTickValues).tickFormat(d3.format('~s'))
    );

    const tooltip = d3.select('body').selectAll('.distribution-tooltip').data([null])
      .join('div')
      .attr('class', 'distribution-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(0, 0, 0, 0.8)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', 'var(--text-label)')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .style('font-family', 'inherit')
      .style('line-height', '1.5');

    const yBase = 0;
    g.append('g')
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

    g.append('text')
      .attr('x', panelWidth / 2)
      .attr('y', panelHeight + 55)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', 'var(--text-axis)')
      .text('Integrated Gradients value');
    g.append('text')
      .attr('transform', `rotate(-90) translate(${-panelHeight / 2},${-40})`)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', 'var(--text-axis)')
      .text('Count (log scale)');

    if (typeof threshold === 'number' && threshold >= 0 && threshold <= 1 && Number.isFinite(globalCutoff)) {
      const thrPos = globalCutoff;

      if (thrPos != null && (useAbsoluteValues ? thrPos <= xMax : (thrPos >= xMin && thrPos <= xMax))) {
        const xThrPos = x(thrPos);
        const xThrNeg = x(-thrPos);
        const xRightMax = x(xMax);
        const xLeftMin = x(xMin);

        if (useAbsoluteValues) {
          g.append('rect')
            .attr('x', xLeftMin)
            .attr('y', 0)
            .attr('width', Math.max(0, xThrNeg - xLeftMin))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();
          
          g.append('rect')
            .attr('x', xThrPos)
            .attr('y', 0)
            .attr('width', Math.max(0, xRightMax - xThrPos))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();

          g.append('line')
            .attr('x1', xThrNeg)
            .attr('x2', xThrNeg)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();
          g.append('line')
            .attr('x1', xThrPos)
            .attr('x2', xThrPos)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();

          g.append('text')
            .attr('x', panelWidth)
            .attr('y', panelHeight + 73)
            .attr('fill', '#d32f2f')
            .style('font-size', 'var(--text-axis)')
            .style('font-weight', '600')
            .style('text-anchor', 'end')
            .text(`cutoff = ±${fmtCutoff(thrPos)}`);
        } else {
          g.append('rect')
            .attr('x', xThrPos)
            .attr('y', 0)
            .attr('width', Math.max(0, xRightMax - xThrPos))
            .attr('height', panelHeight)
            .attr('fill', '#d32f2f')
            .attr('opacity', 0.2)
            .lower();

          g.append('line')
            .attr('x1', xThrPos)
            .attr('x2', xThrPos)
            .attr('y1', 0)
            .attr('y2', panelHeight)
            .attr('stroke', '#d32f2f')
            .attr('stroke-dasharray', '4,2')
            .attr('stroke-width', 2)
            .raise();

          g.append('text')
            .attr('x', panelWidth)
            .attr('y', panelHeight + 73)
            .attr('fill', '#d32f2f')
            .style('font-size', 'var(--text-axis)')
            .style('font-weight', '600')
            .style('text-anchor', 'end')
            .text(`cutoff = ${fmtCutoff(thrPos)}`);
        }
      }
    }
  }
</script>

<svg bind:this={svgEl} {id}></svg>
