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

    const { values, type, threshold, extent, absMax: absMaxGlobal, useAbsoluteValues = true } = options || {};
    const data = flattenNigValues(values, type);

    // Fixed dimensions to prevent layout shifts
    const width = 350;
    const height = 250;
    const margin = { top: 40, right: 20, bottom: 60, left: 50 };

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
    const n = absData.length;
    const sortedAsc = [...absData].sort((a, b) => a - b);

    const linthresh = 1e-4;
    const xAbsMax = (Number.isFinite(absMaxGlobal) && absMaxGlobal > 0)
      ? absMaxGlobal
      : (d3.max(absData) || 1);
    const xAbs = d3.scaleSymlog().constant(linthresh)
      .domain([0, xAbsMax])
      .range([0, width - margin.left - margin.right]);

    const panelWidth = xAbs.range()[1];
    const panelHeight = height - margin.top - margin.bottom;

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

    const buildAbsLogTicks = (max, lin) => {
      const eMax = Math.floor(Math.log10(Math.max(max, lin)));
      const eMin = Math.ceil(Math.log10(lin));
      const vals = [];
      for (let e = eMin; e <= eMax; e++) vals.push(Math.pow(10, e));
      return vals.slice(0, Math.min(4, vals.length));
    };

    const fmtCutoff = (v) => {
      if (!Number.isFinite(v)) return 'n/a';
      const a = Math.abs(v);
      if (a >= 0.1) return v.toFixed(3);
      if (a >= 1e-3) return v.toFixed(4);
      return d3.format('.2e')(v);
    };

    let xAbsTickVals = buildAbsLogTicks(xAbsMax, linthresh);

    if (extent && Array.isArray(extent) && extent.length === 2) {
      const absExtentMax = Math.max(Math.abs(extent[0]), Math.abs(extent[1]));
      if (isFinite(absExtentMax) && !xAbsTickVals.includes(absExtentMax)) {
        xAbsTickVals = [...xAbsTickVals, absExtentMax];
      }
    }

    g.append('g')
      .attr('transform', `translate(0,${panelHeight})`)
      .call(d3.axisBottom(xAbs).tickValues(xAbsTickVals).tickFormat((d) => fmtPlain(d)))
      .call((g) => g.selectAll('text').style('font-size', '10px').attr('dy', '0.9em'));
    g.append('g').call(d3.axisLeft(yCdf).ticks(5));

    g.append('text')
      .attr('x', panelWidth / 2)
      .attr('y', panelHeight + 36)
      .attr('fill', '#333')
      .style('text-anchor', 'middle')
      .style('font-size', '11px')
      .text(useAbsoluteValues ? '|NIG| value' : 'Positive NIG values');

    const titleStyle = { fill: '#333', 'font-size': '12px', 'font-weight': '600' };
    g.append('text')
      .attr('x', 0)
      .attr('y', -22)
      .attr('fill', titleStyle.fill)
      .style('font-size', titleStyle['font-size'])
      .style('font-weight', titleStyle['font-weight'])
      .text(useAbsoluteValues ? 'ECDF + Mass-weighted ECDF of |NIG|' : 'ECDF + Mass-weighted ECDF of positive NIG');

    // ECDF computation
    let ecdfData, ecdfN, ecdfTotalMass;
    if (useAbsoluteValues) {
      ecdfData = sortedAsc;
      ecdfN = n;
      ecdfTotalMass = d3.sum(sortedAsc);
    } else {
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

    g.append('path')
      .datum(ecdfCount)
      .attr('fill', 'none')
      .attr('stroke', 'purple')
      .attr('stroke-width', 1.5)
      .attr('d', lineCount);
    g.append('path')
      .datum(ecdfMass)
      .attr('fill', 'none')
      .attr('stroke', 'orange')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2,2')
      .attr('d', lineMass);

    // Legend
    const legend = g.append('g').attr('class','legend');
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

    // Threshold visualization
    if (typeof threshold === 'number' && threshold >= 0 && threshold <= 1 && Number.isFinite(globalCutoff)) {
      const thrPos = globalCutoff;
      const thrAbs = Math.abs(globalCutoff);
      
      const ecdfCutoffValue = useAbsoluteValues ? thrAbs : Math.max(0, thrPos);
      const ecdfCutoffX = xAbs(ecdfCutoffValue);
      
      g.append('text')
        .attr('x', panelWidth)
        .attr('y', -18)
        .attr('fill', titleStyle.fill)
        .style('text-anchor', 'end')
        .style('font-size', '11px')
        .text(useAbsoluteValues 
          ? `Top ${(threshold * 100).toFixed(1)}% by |NIG|`
          : `Top ${(threshold * 100).toFixed(1)}% of NIG`);
      g.append('line')
        .attr('x1', ecdfCutoffX)
        .attr('x2', ecdfCutoffX)
        .attr('y1', 0)
        .attr('y2', panelHeight)
        .attr('stroke', 'crimson')
        .attr('stroke-dasharray', '4,2')
        .attr('stroke-width', 2);
      g.append('rect')
        .attr('x', ecdfCutoffX)
        .attr('y', 0)
        .attr('width', Math.max(0, panelWidth - ecdfCutoffX))
        .attr('height', panelHeight)
        .attr('fill', 'crimson')
        .attr('opacity', 0.15)
        .lower();
      g.append('text')
        .attr('x', panelWidth)
        .attr('y', panelHeight + 54)
        .attr('fill', 'crimson')
        .style('font-size', '11px')
        .style('font-weight', '600')
        .style('text-anchor', 'end')
        .text(useAbsoluteValues 
          ? `|cutoff| = ${fmtCutoff(thrAbs)}`
          : `cutoff = ${fmtCutoff(ecdfCutoffValue)}`);

      const totalMass = useAbsoluteValues ? d3.sum(absData) : d3.sum(ecdfData);
      const removedMass = totalMass > 0 
        ? (useAbsoluteValues 
            ? d3.sum(absData.filter((v) => v >= thrAbs)) / totalMass
            : d3.sum(ecdfData.filter((v) => v >= ecdfCutoffValue)) / totalMass)
        : 0;
      g.append('text')
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
