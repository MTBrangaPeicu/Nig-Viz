<script>
  import * as d3 from 'd3';
  export let options$;

  let options = {};
  let svgContainer;

  const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
  const tokenLabels = ['CLS', 'QRY', 'SEP1', 'DOC', 'SEP2'];
  
  // Colors from seaborn code
  const colors = ['blue', 'green', 'orange', 'orangered', 'darkred'];
  
  // Hatching patterns for ATTN (repeated 5 times each)
  const hatchPatterns = ['', '//', '-', 'o', 'X'];

  options$.subscribe(value => {
    options = value;
    drawViolinPlot();
  });

  function getGroupStyle(group, type) {
    if (type === 'FFN') {
      const index = tokenLabels.findIndex(label => group === label);
      return {
        color: colors[index] || '#999',
        pattern: 'none'
      };
    } else if (type === 'ATTN') {
      // Parse group like "CLS→QRY" to get destination and source
      const [dest, src] = group.split('→');
      const destIndex = tokenLabels.findIndex(label => label === dest);
      const srcIndex = tokenLabels.findIndex(label => label === src);
      
      return {
        color: colors[destIndex] || '#999',
        pattern: hatchPatterns[srcIndex] || ''
      };
    }
    return { color: '#999', pattern: 'none' };
  }

  function drawViolinPlot() {
    if (!svgContainer) return;
    svgContainer.innerHTML = '';

    if (!options?.values || options.values.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = '🧠 Select a node in the architecture to visualize neuron activations';
      msg.style.cssText = 'font-family: sans-serif; font-size: 1rem; color: #777; padding: 2rem; text-align: center; border: 1px dashed #bbb; border-radius: 0.5rem;';
      svgContainer.appendChild(msg);
      return;
    }

    const width = 1000;
    const height = 500;
    const margin = { top: 40, right: 30, bottom: 90, left: 60 };

    const svg = d3.select(svgContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', 'sans-serif')
      .style('font-size', '13px');

    const data = prepareData(options);
    const groups = [...new Set(data.map(d => d.group))];

    const y = d3.scaleSymlog()
      .domain([-0.2, 0.2])  // Extended domain for more space
      .range([height - margin.bottom, margin.top])
      .constant(0.0001);

    const yTicks = [-0.06, -0.01, -0.005, 0, 0.005, 0.01, 0.06];  // Keep original ticks
    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d3.format(".3f")));

    // Add horizontal reference line at y=0
    svg.append('line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', y(0))
      .attr('y2', y(0))
      .attr('stroke', '#999')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2')
      .style('opacity', 0.7);

    const x = d3.scaleBand()
      .domain(groups)
      .range([margin.left, width - margin.right])
      .padding(0.3);

    const xAxis = svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x));

    xAxis.selectAll("text")
      .attr("transform", "rotate(45)")
      .style("text-anchor", "start");

    // Dotted separators every 5 (ATTN mode)
    if (options.type === 'ATTN') {
      for (let i = 5; i < groups.length; i += 5) {
        const xPos = x(groups[i]);
        if (xPos !== undefined) {
          svg.append('line')
            .attr('x1', xPos - x.bandwidth() * 0.15)
            .attr('x2', xPos - x.bandwidth() * 0.15)
            .attr('y1', margin.top)
            .attr('y2', height - margin.bottom)
            .attr('stroke', '#ccc')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,2');
        }
      }
    }

    // Highlight logic
    const selected = tokenTypes.indexOf(options.tokenType);
    const highlightPrefix = options.type === 'FFN'
      ? tokenLabels[selected]
      : `${tokenLabels[selected]}→`;

    // Gradient and patterns
    const defs = svg.append('defs');
    
    // Original gradient (keep as fallback)
    defs.append('linearGradient')
      .attr('id', 'linearGradient')
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 200).attr('x2', 0)
      .attr('y1', height).attr('y2', 0)
      .selectAll('stop')
      .data([
        { offset: '0%', color: '#ff6138' },
        { offset: '50%', color: '#ffcc00' },
        { offset: '100%', color: '#096286' }
      ])
      .join('stop')
      .attr('offset', d => d.offset)
      .attr('stop-color', d => d.color);

    // Create hatching patterns
    const patterns = [
      { id: 'hatch-none', path: '' },
      { id: 'hatch-diagonal', path: 'M 0,4 l 4,4 M -1,1 l 2,2 M 3,7 l 2,2' },
      { id: 'hatch-horizontal', path: 'M 0,2 l 8,0 M 0,6 l 8,0' },
      { id: 'hatch-dots', path: 'M 2,2 l 0,0 M 6,2 l 0,0 M 2,6 l 0,0 M 6,6 l 0,0' },
      { id: 'hatch-cross', path: 'M 0,4 l 8,0 M 4,0 l 0,8 M 1,1 l 6,6 M 1,7 l 6,-6' }
    ];

    patterns.forEach(pattern => {
      const p = defs.append('pattern')
        .attr('id', pattern.id)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 8)
        .attr('height', 8);
      
      if (pattern.path) {
        p.append('path')
          .attr('d', pattern.path)
          .attr('stroke', '#333')
          .attr('stroke-width', 1)
          .attr('fill', 'none');
      }
    });

    const kde = (kernel, thresholds) => V => thresholds.map(t => [t, d3.mean(V, d => kernel(t - d))]);
    const epanechnikov = bw => x => Math.abs(x /= bw) <= 1 ? 0.75 * (1 - x * x) / bw : 0;
    
    // Much more conservative approach - only create thresholds around actual data
    const allValues = data.map(d => d.value);
    const dataMin = d3.min(allValues);
    const dataMax = d3.max(allValues);
    const dataRange = dataMax - dataMin;
    
    // Less sensitive threshold for showing violins - avoid over-interpretation
    const showViolins = dataRange > 0.001;  // Less sensitive than before
    
    // Conservative bandwidth - balance between smoothing and real patterns
    const bandwidth = Math.max(0.001, Math.min(0.005, dataRange / 10));
    
    const numPoints = 50; // Reduced points for less artificial smoothing
    const thresholds = Array.from({length: numPoints}, (_, i) => 
      dataMin - bandwidth * 2 + (dataMax - dataMin + bandwidth * 4) * i / (numPoints - 1)
    );

    groups.forEach(group => {
      const values = data.filter(d => d.group === group).map(d => d.value).sort(d3.ascending);
      if (!values.length) return;

      const centerX = x(group) + x.bandwidth() / 2;
      const groupStyle = getGroupStyle(group, options.type);
      const highlight = group.startsWith(highlightPrefix);
      
      // Only show violin if there's meaningful data spread AND we decided to show violins
      const isFlat = d3.deviation(values) < 1e-6;  // Less sensitive flat detection
      const valueRange = d3.max(values) - d3.min(values);
      // Less sensitive detection - avoid over-interpretation of small variations
      const shouldShowViolin = showViolins && !isFlat && valueRange > 0.001;

      if (shouldShowViolin) {
        const bins = kde(epanechnikov(bandwidth), thresholds)(values);
        const maxDensity = d3.max(bins, d => d[1]) || 1;

        // Only show violin if there's actually meaningful density
        if (maxDensity > 1e-6) {  // Less sensitive density threshold
          // Scale violin width - use a portion of available bandwidth
          const violinWidth = x.bandwidth() * 0.6;
          const xScale = d3.scaleLinear()
            .domain([0, maxDensity])
            .range([0, violinWidth / 2]);

          const area = d3.area()
            .x0(d => centerX - xScale(d[1]))
            .x1(d => centerX + xScale(d[1]))
            .y(d => y(d[0]))
            .curve(d3.curveBasis); // Less aggressive smoothing

          // Create fill pattern URL
          const patternId = groupStyle.pattern ? `hatch-${groupStyle.pattern === '//' ? 'diagonal' : 
                                                  groupStyle.pattern === '-' ? 'horizontal' :
                                                  groupStyle.pattern === 'o' ? 'dots' :
                                                  groupStyle.pattern === 'X' ? 'cross' : 'none'}` : 'hatch-none';

          svg.append('path')
            .datum(bins)
            .attr('d', area)
            .style('fill', groupStyle.color)
            .style('stroke', highlight ? '#000' : '#333')
            .style('stroke-width', highlight ? 2 : 1)
            .style('opacity', highlight ? 1.0 : 0.7);

          // Add highlight outline for selected violin
          if (highlight) {
            svg.append('path')
              .datum(bins)
              .attr('d', area)
              .style('fill', 'none')
              .style('stroke', '#00bcd4')
              .style('stroke-width', 3)
              .style('opacity', 0.8);
          }

          // Add hatching pattern for ATTN if needed
          if (options.type === 'ATTN' && groupStyle.pattern && groupStyle.pattern !== '') {
            svg.append('path')
              .datum(bins)
              .attr('d', area)
              .style('fill', `url(#${patternId})`)
              .style('opacity', 0.5);
          }
        }
      } else if (isFlat || !shouldShowViolin) {
        // For flat distributions or when we shouldn't show violin, just show a line
        svg.append('line')
          .attr('x1', centerX - x.bandwidth()/6)
          .attr('x2', centerX + x.bandwidth()/6)
          .attr('y1', y(values[0]))
          .attr('y2', y(values[0]))
          .attr('stroke', groupStyle.color)
          .attr('stroke-width', highlight ? 3 : 2)
          .style('opacity', highlight ? 1.0 : 0.8);

        // Add highlight outline for selected line
        if (highlight) {
          svg.append('line')
            .attr('x1', centerX - x.bandwidth()/5)
            .attr('x2', centerX + x.bandwidth()/5)
            .attr('y1', y(values[0]))
            .attr('y2', y(values[0]))
            .attr('stroke', '#00bcd4')
            .attr('stroke-width', 5)
            .style('opacity', 0.6);
        }
      }

      const q1 = d3.quantileSorted(values, 0.25);
      const median = d3.quantileSorted(values, 0.5);
      const q3 = d3.quantileSorted(values, 0.75);
      const iqr = q3 - q1;
      
      // For very small values near zero, use a more conservative whisker calculation
      const minValue = d3.min(values);
      const maxValue = d3.max(values);
      const dataRange = maxValue - minValue;
      
      // If the data range is very small (close to zero), use actual min/max for whiskers
      // Otherwise use traditional 1.5*IQR rule but constrain to y-axis domain
      let min, max;
      if (dataRange < 0.01 || iqr < 0.001) {
        min = Math.max(minValue, y.domain()[0]);
        max = Math.min(maxValue, y.domain()[1]);
      } else {
        min = Math.max(Math.max(minValue, q1 - 1.5 * iqr), y.domain()[0]);
        max = Math.min(Math.min(maxValue, q3 + 1.5 * iqr), y.domain()[1]);
      }
      
      const boxWidth = 16; // Slightly smaller boxes
      const boxColor = highlight ? '#00bcd4' : groupStyle.color;

      // Whiskers (vertical line connecting min to max)
      svg.append('line')
        .attr('x1', centerX).attr('x2', centerX)
        .attr('y1', y(min)).attr('y2', y(max))
        .attr('stroke', '#333').attr('stroke-width', 1);

      // Box (interquartile range)
      svg.append('rect')
        .attr('x', centerX - boxWidth / 2)
        .attr('y', y(q3))
        .attr('height', Math.abs(y(q1) - y(q3)))
        .attr('width', boxWidth)
        .attr('stroke', '#000')
        .attr('stroke-width', 1)
        .style('fill', 'white')
        .style('opacity', 0.9);

      // Median line
      svg.append('line')
        .attr('x1', centerX - boxWidth / 2)
        .attr('x2', centerX + boxWidth / 2)
        .attr('y1', y(median))
        .attr('y2', y(median))
        .attr('stroke', 'firebrick')
        .attr('stroke-width', 2);

      // Min and max whisker caps
      svg.append('line')
        .attr('x1', centerX - boxWidth / 4)
        .attr('x2', centerX + boxWidth / 4)
        .attr('y1', y(min))
        .attr('y2', y(min))
        .attr('stroke', '#333')
        .attr('stroke-width', 1);

      svg.append('line')
        .attr('x1', centerX - boxWidth / 4)
        .attr('x2', centerX + boxWidth / 4)
        .attr('y1', y(max))
        .attr('y2', y(max))
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
    });
  }

  function prepareData(opts) {
    const values = opts.values;
    const type = opts.type;

    if (type === 'FFN') {
      return values.flatMap((arr, i) =>
        arr.map(v => ({
          group: tokenLabels[i],
          value: v
        }))
      );
    }

    if (type === 'ATTN') {
      const data = [];
      for (let head = 0; head < values.length; head++) {
        const headMatrix = values[head]; // shape: (5, 5)
        for (let to = 0; to < 5; to++) {
          for (let from = 0; from < 5; from++) {
            data.push({
              group: `${tokenLabels[to]}→${tokenLabels[from]}`,
              value: headMatrix[from][to]
            });
          }
        }
      }
      return data;
    }

    return [];
  }
</script>

<div bind:this={svgContainer}></div>

<style>
  :global(svg) {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
</style>
