<script>
	// @ts-nocheck
	import { onMount, afterUpdate, onDestroy } from 'svelte';
	import * as d3 from 'd3';
	export let options$;
	export let pruningState$;
	export let absoluteValues$;
	export let selectionRequest$;
	export let globalCutoff$;
	export let pruningCursorEnabled$;
	export let conditionalCursorEnabled$ = null;
	export let conditionalNigTarget$ = null;
	let options = {};
	let pruningState = { enabled: false, rules: [], targets: [], thresholds: {} };
	let useAbsoluteValues = true;
	let globalCutoff = 0;
	let pruningCursorEnabled = false;
	let conditionalCursorEnabled = false;

	// Sorting state
	let ffnSort = { key: 'val', dir: 'desc' }; // keys: 'val' | 'index'
	let attnSort = { column: 0, dir: 'desc' }; // column: 0..4 (token columns)
	let lastAttnCtx = '';
	$: if (options && options.type === 'ATTN') {
		const ctx = `${options.layer}|${options.type}|${options.tokenType}|${options.orientation}|${options.sortTokenType}`;
		if (ctx !== lastAttnCtx) {
			lastAttnCtx = ctx;
			// Always sort by the column tied to the second selection (provided as sortTokenType)
			const key = options.sortTokenType || options.tokenType;
			const idx = TOKEN_TYPES.indexOf(key);
			if (idx !== -1) attnSort = { column: idx, dir: 'desc' };
		}
	}




	options$.subscribe(value => {
		options = value;
	});

	pruningState$.subscribe(value => {
		pruningState = value;
		if (value.targets && value.targets.length > 0) {
			console.log('Nigtable received pruning targets:', value.targets);
		}
		// Direct D3 update when pruning state changes (like architecture view)
		updateCircleColors();
	});

	absoluteValues$.subscribe(value => {
		useAbsoluteValues = value;
		console.log('[NIG Table] Absolute values mode:', useAbsoluteValues ? 'Enabled' : 'Disabled');
	});

	globalCutoff$.subscribe(value => {
		globalCutoff = value;
	});

	pruningCursorEnabled$.subscribe(value => {
		pruningCursorEnabled = value;
		console.log('[NIG Table] Pruning cursor mode:', pruningCursorEnabled ? 'Enabled' : 'Disabled');
	});

	// Subscribe to conditional NIG cursor state
	if (conditionalCursorEnabled$) {
		conditionalCursorEnabled$.subscribe(value => {
			conditionalCursorEnabled = value;
			console.log('[NIG Table] Conditional NIG cursor mode:', conditionalCursorEnabled ? 'Enabled' : 'Disabled');
		});
	}

	// Handle conditional NIG target selection from table clicks
	function handleConditionalNigTarget(neuronIdx, neuronType) {
		if (!conditionalCursorEnabled || !conditionalNigTarget$) return;
		
		// Get layer info from options
		const layerMatch = options.layer?.match(/layer\.(\d+)\./);
		if (!layerMatch) return;
		const layerNum = parseInt(layerMatch[1]);
		
		console.log(`[NIG Table] Conditional NIG target selected: layer=${layerNum}, type=${neuronType}, neuron=${neuronIdx}`);
		
		conditionalNigTarget$.next({
			layerIdx: layerNum,
			neuronType: neuronType === 'ATTN' ? 'attention' : 'ffn',
			neuronIdx: neuronIdx
		});
	}

	// Toggle pruning target for a specific head/neuron when clicking in pruning mode
	function togglePruningTarget(index, type) {
		if (!pruningCursorEnabled) return;
		
		// Get layer info from options
		const layerMatch = options.layer?.match(/layer\.(\d+)\./);
		if (!layerMatch) return;
		const layerNum = parseInt(layerMatch[1]);
		const layerKey = `L${layerNum}_${type}`;
		const tokenType = options.tokenType || 'cls';
		
		const currentState = pruningState;
		const targetIndex = currentState.targets.findIndex(
			t => t.layer === layerKey && t.index === index && t.tokenType === tokenType
		);
		
		let newTargets;
		if (targetIndex >= 0) {
			// Remove existing target
			newTargets = currentState.targets.filter((_, i) => i !== targetIndex);
			console.log(`[NIG Table] Removed pruning target: ${layerKey} ${type === 'ATTN' ? 'head' : 'neuron'}#${index}`);
		} else {
			// Add new target
			newTargets = [...currentState.targets, { layer: layerKey, index, tokenType, type }];
			console.log(`[NIG Table] Added pruning target: ${layerKey} ${type === 'ATTN' ? 'head' : 'neuron'}#${index}`);
		}
		
		// Update pruning state
		pruningState$.next({
			...currentState,
			targets: newTargets
		});
	}

	const TOKEN_TYPES = ['cls', 'qry', 'sep1', 'doc', 'sep2'];

	// Function to emit selection request to architecture when column header is clicked
	function requestArchitectureSelection(sortTokenType) {
		if (!options.layer || !options.type || !options.tokenType) return;
		
		// Extract layer number from options.layer
		const layerMatch = options.layer.match(/layer\.(\d+)\./);
		if (!layerMatch) return;
		const layerNum = parseInt(layerMatch[1]);
		
		// Determine the selection based on orientation
		// orientation: 'srcToTgts' means circle→square (e.g., cls circle → qry square)
		// orientation: 'tgtsToSrcs' means square→circle (e.g., qry square → cls circle)
		
		if (options.orientation === 'srcToTgts') {
			// Circle to Square: source is ATTN (circle), target is FFN (square)
			// options.tokenType is the source (circle), sortTokenType is the target (square)
			const selection = {
				source: { layer: layerNum, type: 'ATTN', tokenType: options.tokenType },
				target: { layer: layerNum, type: 'FFN', tokenType: sortTokenType }
			};
			console.log('[NIG Table] Requesting architecture selection (circle→square):', selection);
			selectionRequest$.next(selection);
		} else if (options.orientation === 'tgtsToSrcs') {
			// Square to Circle: source is FFN (square), target is ATTN (circle)
			// options.tokenType is the target (square), sortTokenType is the source (circle)
			const selection = {
				source: { layer: layerNum, type: 'FFN', tokenType: options.tokenType },
				target: { layer: layerNum, type: 'ATTN', tokenType: sortTokenType }
			};
			console.log('[NIG Table] Requesting architecture selection (square→circle):', selection);
			selectionRequest$.next(selection);
		}
	}

	// Function to check if a neuron/head should be red based on pruning targets OR threshold-based pruning
	function shouldCircleBeRed(index, layerType) {
		if (!options.layer) return false;
		
		// Extract layer number from options.layer (e.g., "bert.encoder.layer.0.attention" -> "L0_ATTN")
		const layerMatch = options.layer.match(/layer\.(\d+)\.(attention|intermediate)/);
		if (!layerMatch) return false;
		
		const layerNum = layerMatch[1];
		const type = layerMatch[2] === 'attention' ? 'ATTN' : 'FFN';
		const layerKey = `L${layerNum}_${type}`;
		
		// Check 1: Is this specific neuron/head explicitly selected in pruning targets?
		// Targets use 'index' key from frontend
		const isExplicitlyTargeted = pruningState.targets && pruningState.targets.some(target => 
			target.layer === layerKey && 
			parseInt(target.index) === parseInt(index) &&
			target.tokenType === options.tokenType
		);
		
		if (isExplicitlyTargeted) {
			console.log(`Neuron ${index} is explicitly targeted in layer ${layerKey} for token ${options.tokenType}`);
			return true;
		}
		
		// Check 2: Is there a pruning rule that applies to this neuron/head?
		const isRuleApplied = pruningState.rules && pruningState.rules.some(rule => {
			// Rule must match the layer
			if (rule.layer !== layerKey) return false;
			
			// If rule is for "all" token types, it applies regardless of current token selection
			if (rule.tokenType === 'all') return true;
			
			// If rule is for specific token type, it must match the current token selection
			return rule.tokenType === options.tokenType;
		});
		
		if (isRuleApplied) return true;
		
		// Check 3: Would this neuron/head be pruned based on threshold? (only if enabled)
		if (pruningState.enabled && options.pruningCutoffs) {
			if (layerType === 'FFN' && pruningState.thresholds?.ffn > 0 && Array.isArray(options.values)) {
				// For FFN: check if this neuron's value would be pruned based on threshold
				const neuronValue = Math.abs(options.values[index]);
				return neuronValue >= options.pruningCutoffs.ffn;
			}
			
			if (layerType === 'ATTN' && pruningState.thresholds?.attention > 0 && Array.isArray(options.values)) {
				// For ATTN: check if any of this head's values would be pruned based on threshold  
				const headValues = options.values[index];
				if (Array.isArray(headValues)) {
					return headValues.some(val => Math.abs(val) >= options.pruningCutoffs.attention);
				}
			}
		}
		
		return false;
	}

	// Function to update circle colors without re-rendering the entire heatmap
	// This is called when pruningState changes to update visual feedback
	function updateCircleColors() {
		if (!options.layer) return;
		
		const layerMatch = options.layer.match(/layer\.(\d+)\.(attention|intermediate)/);
		if (!layerMatch) return;
		
		const layerType = layerMatch[2] === 'attention' ? 'ATTN' : 'FFN';
		
		// Direct D3 update for ATTN circles
		if (attnHeatmapEl && layerType === 'ATTN') {
			const svg = d3.select(attnHeatmapEl).select('svg');
			if (!svg.empty()) {
				// Get the data values for computing grey scale
				const attnMatrix = heatmapMetric === 'activation' && Array.isArray(options.attnActivations)
					? options.attnActivations
					: options.values;
				if (!Array.isArray(attnMatrix)) return;
				
				// Compute score range for grey scale
				const headScores = attnMatrix.map((row, i) => ({
					index: i,
					score: (row || []).reduce((a, b) => a + (b || 0), 0)
				}));
				const minScore = d3.min(headScores, d => d.score) || 0;
				const maxScore = d3.max(headScores, d => d.score) || 1;
				const greyScale = d3.scaleSequential(d3.interpolateGreys).domain([minScore, maxScore]).clamp(true);
				
				svg.selectAll('circle.row-dot')
					.attr('fill', function(d) {
						const index = d?.index ?? d;
						if (shouldCircleBeRed(index, 'ATTN')) return 'darkred';
						// Restore grey color based on score
						const headData = headScores.find(h => h.index === index);
						return greyScale(headData?.score || 0);
					});
			}
		}
		
		// Direct D3 update for FFN circles
		if (ffnHeatmapEl && layerType === 'FFN') {
			const svg = d3.select(ffnHeatmapEl).select('svg');
			if (!svg.empty() && Array.isArray(options.values)) {
				// Compute NIG range for color scale
				const nigBase = options.values.map((v, i) => ({ index: i, val: v }));
				const nigMin = d3.min(nigBase, d => d.val) || 0;
				const nigMax = d3.max(nigBase, d => d.val) || 1;
				
				svg.selectAll('circle.row-dot')
					.attr('fill', function(d) {
						const index = d?.index ?? d;
						if (shouldCircleBeRed(index, 'FFN')) return 'darkred';
						// Restore original color based on NIG value
						const val = nigBase[index]?.val ?? 0;
						if (nigMin < 0 && nigMax > 0) {
							return getColorScale(val, nigMin, nigMax);
						}
						const gry = d3.scaleSequential(d3.interpolateInferno).domain([nigMin, nigMax]).clamp(true);
						return gry(val);
					});
			}
		}
	}

	// Function to check if a value should be highlighted as contributing to edges
	function isValueUsedInEdges(value) {
		// globalCutoff is computed from threshold: threshold=0 → cutoff=MAX, threshold=1 → cutoff=MIN/0
		// Use reactive globalCutoff from stream instead of options
		if (globalCutoff === undefined || globalCutoff === null) return false;
		// Compare using absolute values when that mode is enabled, otherwise use raw values
		const compareValue = useAbsoluteValues ? Math.abs(value) : value;
		return compareValue >= globalCutoff;
	}

	function getShape(values) {
		if (Array.isArray(values)) {
			if (Array.isArray(values[0])) {
				if (Array.isArray(values[0][0])) {
					return [values.length, values[0].length, values[0][0].length];
				}
				return [values.length, values[0].length];
			}
			return [values.length];
		}
		return "NA";
	}

	function getColorScale(val, min, max) {
		// Normalize value between min and max
		const norm = (val - min) / (max - min);
		const level = Math.round(255 * (1 - norm)); // Scale towards black
		return `rgb(${level}, ${level}, ${level})`;
	}

	// (widget title is set externally; no internal header helpers needed)

	function formatValue(value) {
		return Number.isFinite(value) ? Number(value).toFixed(5) : '--';
	}

	// FFN-specific calculations
	let sortedFFN = [];
	let minFFN = 0;
	let maxFFN = 1;

	$: if (options && options.type === 'FFN' && Array.isArray(options.values) && ffnSort) {
		// Sort by the active metric: activation when selected, otherwise NIG values
		const sourceValsForSort = (heatmapMetric === 'activation' && Array.isArray(options.activations))
			? options.activations
			: options.values;
		// Always use actual values for sorting, not absolute
		const base = sourceValsForSort.map((val, i) => ({ 
			index: i, 
			val: val
		}));
		const dir = ffnSort.dir === 'asc' ? 1 : -1;
		const cmpNum = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
		if (ffnSort.key === 'index') {
			sortedFFN = base.slice().sort((a, b) => dir * cmpNum(a.index, b.index));
		} else {
			sortedFFN = base.slice().sort((a, b) => dir * cmpNum(a.val, b.val));
		}
		minFFN = Math.min(...base.map(x => x.val));
		maxFFN = Math.max(...base.map(x => x.val));
	} else {
		sortedFFN = [];
		minFFN = 0;
		maxFFN = 1;
	}

	// ATTN-specific calculations
	let scoredHeads = [];
	let minHeadScore = 0;
	let maxHeadScore = 1;

	$: if (options && options.type === 'ATTN' && Array.isArray(options.values) && attnSort) {
		// Sort by the active metric: activation when selected, otherwise NIG values
		const sourceValsForSort = (heatmapMetric === 'activation' && Array.isArray(options.attnActivations))
			? options.attnActivations
			: options.values;
		// Always use actual values for sorting, not absolute
		const base = sourceValsForSort.map((row, i) => ({ 
			index: i, 
			row: row,
			score: row.reduce((a, b) => a + b, 0) 
		}));
		const dir = attnSort.dir === 'asc' ? 1 : -1;
		const cmpNum = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
		if (typeof attnSort.column === 'number') {
			const col = attnSort.column;
			scoredHeads = base.slice().sort((a, b) => dir * cmpNum((a.row[col] ?? 0), (b.row[col] ?? 0)));
		} else {
			scoredHeads = base.slice(); // no sort when column unspecified
		}
		minHeadScore = Math.min(...scoredHeads.map(x => x.score));
		maxHeadScore = Math.max(...scoredHeads.map(x => x.score));
	} else {
		scoredHeads = [];
		minHeadScore = 0;
		maxHeadScore = 1;
	}

	// Heatmap toggles
	let displayMode = 'values'; // 'values' | 'heatmap'
	let heatmapMetric = 'nig'; // 'nig' | 'activation'
	let attnHeatmapEl;
	let ffnHeatmapEl;
	let attnTooltipEl; // created on mount and appended to document.body
	let colorScaleTooltipEl; // tooltip for color scale legend

	onMount(() => {
		attnTooltipEl = document.createElement('div');
		attnTooltipEl.className = 'heatmap-tooltip';
		attnTooltipEl.style.opacity = '0';
		document.body.appendChild(attnTooltipEl);

		colorScaleTooltipEl = document.createElement('div');
		colorScaleTooltipEl.className = 'heatmap-tooltip';
		colorScaleTooltipEl.style.opacity = '0';
		document.body.appendChild(colorScaleTooltipEl);
	});

	onDestroy(() => {
		if (attnTooltipEl && attnTooltipEl.parentNode) attnTooltipEl.parentNode.removeChild(attnTooltipEl);
		attnTooltipEl = null;
		if (colorScaleTooltipEl && colorScaleTooltipEl.parentNode) colorScaleTooltipEl.parentNode.removeChild(colorScaleTooltipEl);
		colorScaleTooltipEl = null;
	});

	function renderATTNHeatmap() {
		if (!attnHeatmapEl || options?.type !== 'ATTN' || !Array.isArray(options.values)) return;
		// Choose matrix based on metric
		const attnMatrix = heatmapMetric === 'activation' && Array.isArray(options.attnActivations)
			? options.attnActivations
			: options.values;
		// Preserve current head ordering (from scoredHeads) but always read row data from attnMatrix
		const heads = (scoredHeads.length
			? scoredHeads.map(h => ({ index: h.index, row: (attnMatrix?.[h.index] || []) }))
			: (attnMatrix || []).map((row, i) => ({ index: i, row }))
		);
		const rows = heads.map(h => h.row);
		const yLabels = heads.map(h => `head#${h.index}`);
		const xBase = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const xLabels = (options.orientation === 'tgtsToSrcs')
			? xBase.map(t => `${t} →`)
			: xBase.map(t => `→ ${t}`);

		// Use global extent for color scale if available, otherwise compute local
		const flat = rows.flat().filter(v => typeof v === 'number' && isFinite(v));
		// For ATTN, use appropriate global extent based on metric
		let minV, maxV;
		if (heatmapMetric === 'activation') {
			minV = (options.globalAttnActivationExtent && options.globalAttnActivationExtent[0] != null) ? options.globalAttnActivationExtent[0] : (flat.length ? d3.min(flat) : 0);
			maxV = (options.globalAttnActivationExtent && options.globalAttnActivationExtent[1] != null) ? options.globalAttnActivationExtent[1] : (flat.length ? d3.max(flat) : 1);
		} else {
			minV = (options.globalNigExtent && options.globalNigExtent[0] != null) ? options.globalNigExtent[0] : (flat.length ? d3.min(flat) : 0);
			maxV = (options.globalNigExtent && options.globalNigExtent[1] != null) ? options.globalNigExtent[1] : (flat.length ? d3.max(flat) : 1);
		}
		const maxAbs = Math.max(Math.abs(minV || 0), Math.abs(maxV || 1));
		
		// Helper function for symmetric log scale (handles negative values)
		// Using log10 for stronger compression and better color distribution
		const symlog = (x) => {
			if (x === 0) return 0;
			const absX = Math.abs(x);
			// Use log10 for stronger effect than log1p, with power adjustment for more vibrant colors
			const logVal = Math.log10(absX + 1);
			// Apply power transform (exponent 0.7) to spread out colors more
			return Math.sign(x) * Math.pow(logVal, 0.7);
		};
		
		// Color scale: LINEAR for activations, LOGARITHMIC for NIG
		let color;
		if (heatmapMetric === 'activation') {
			if (minV < 0 && maxV > 0) {
				// Diverging scale with LINEAR mapping for activations
				color = d3.scaleDiverging(d3.interpolateRdBu).domain([maxAbs, 0, -maxAbs]).clamp(true);
			} else {
				// Sequential scale with LINEAR mapping for activations
				color = d3.scaleSequential(d3.interpolateReds).domain([minV, maxV]).clamp(true);
			}
		} else {
			const useDiverging = (minV < 0 && maxV > 0);
			if (useDiverging) {
				// Diverging scale with enhanced symlog for NIG values - domain is in LOG SPACE
				const logMaxAbs = symlog(maxAbs);
				color = (val) => {
					const logVal = symlog(val);
					// Use stronger color interpolator with gamma correction for more vibrant colors
					const baseColor = d3.scaleDiverging(d3.interpolateRdBu).domain([logMaxAbs, 0, -logMaxAbs]).clamp(true)(logVal);
					// Apply gamma correction to make colors more saturated (gamma = 0.8)
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				};
			} else {
				// Sequential scale with log for same-sign NIG values - domain is in LOG SPACE
				const logMin = symlog(minV);
				const logMax = symlog(maxV);
				color = (val) => {
					const logVal = symlog(val);
					// Use Inferno with gamma correction for more vibrant colors
					const baseColor = d3.scaleSequential(d3.interpolateInferno).domain([logMin, logMax]).clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				};
			}
		}

		// Dimensions (align with table-like columns)
		const containerW = attnHeatmapEl.clientWidth || 600;
		const circleColW = 28; // similar to first table column
		const headColW = 100; // width for "Head" text column
		const margin = { top: 28, right: 12, bottom: 20, left: 8 };
		const tokenCols = xLabels.length;
		const tokenAreaW = Math.max(200, containerW - (circleColW + headColW) - margin.left - margin.right);
		const cellW = tokenAreaW / tokenCols;
		const cellH = 36; // approximate table row height (padding + font)
		const innerH = yLabels.length * cellH;
		const totalH = innerH + margin.top + margin.bottom;

		// Clear and build SVG
		const root = d3.select(attnHeatmapEl);
		root.selectAll('*').remove();
		const svgRoot = root.append('svg')
			.attr('width', containerW)
			.attr('height', totalH);
		const gLeft = svgRoot.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`);
		const gGrid = svgRoot.append('g')
			.attr('transform', `translate(${margin.left + circleColW + headColW},${margin.top})`);

		// Scales and axes
		const x = d3.scaleBand().domain(xLabels).range([0, tokenAreaW]).padding(0.05);
		const y = d3.scaleBand().domain(yLabels).range([0, innerH]).padding(0.05);

		const xAxis = gGrid.append('g')
			.attr('class', 'axis-x')
			.attr('transform', `translate(0, 0)`) // top-aligned to mirror table header
			.call(d3.axisTop(x).tickSize(0))
			.call(g => g.selectAll('.domain').remove());
		// Clickable ticks to sort like table headers
			xAxis.selectAll('text')
			.style('cursor', 'pointer')
				.each(function (d) {
				// Mark active column
				const label = d;
				const idx = xLabels.indexOf(label);
					const tick = d3.select(this.parentNode).classed('active', idx === attnSort.column);
				// Base label (directional arrow already included in label string)
				const textSel = d3.select(this);
				textSel.text(label);
					// Remove previous icons, then append small arrow like table's .sort-icon
					textSel.selectAll('tspan.sort-icon').remove();
				if (idx === attnSort.column) {
					textSel.append('tspan')
							.attr('class', 'sort-icon')
							.attr('dx', '6')
						.text(attnSort.dir === 'asc' ? '▲' : '▼');
				}
			})
			.on('click', function (event, label) {
				const idx = xLabels.indexOf(label);
				if (idx === -1) return;
				attnSort = { column: idx, dir: (attnSort.column === idx ? (attnSort.dir === 'desc' ? 'asc' : 'desc') : 'desc') };
				// Trigger architecture selection like in the values table
				const tokenType = TOKEN_TYPES[idx];
				if (tokenType) {
					requestArchitectureSelection(tokenType);
				}
			});

		gGrid.append('g')
			.attr('class', 'axis-y')
			.call(d3.axisLeft(y).tickSize(0).tickFormat(() => ''))
			.call(g => g.selectAll('.domain').remove());

		// Tooltip is a global element under document.body (not clipped by container)
		const tooltip = d3.select(attnTooltipEl).style('opacity', 0);

		const data = [];
		for (let i = 0; i < yLabels.length; i++) {
			for (let j = 0; j < xLabels.length; j++) {
				data.push({ row: yLabels[i], col: xLabels[j], value: rows[i]?.[j] ?? 0 });
			}
		}

		gGrid.selectAll('rect.cell')
			.data(data)
			.join('rect')
			.attr('class', 'cell')
			.attr('x', d => x(d.col) ?? 0)
			.attr('y', d => y(d.row) ?? 0)
			.attr('rx', 3)
			.attr('ry', 3)
			.attr('width', x.bandwidth())
			.attr('height', y.bandwidth())
			.style('stroke', 'none')
			.style('opacity', 0.95)
			.attr('fill', d => color(d.value))
			.on('mouseover', function (event, d) {
				d3.select(this).style('stroke', '#333').style('stroke-width', 1);
				tooltip.style('opacity', 1)
					.html(`<b>${d.row}</b><br>${d.col}<br>${heatmapMetric === 'activation' ? 'activation' : 'value'}: ${formatValue(Number(d.value))}`);
			})
			.on('mousemove', function (event) {
				const px = Math.min(window.innerWidth - 160, (event.pageX || 0) + 12);
				const py = Math.min(window.innerHeight - 80, (event.pageY || 0) + 12);
				tooltip.style('left', `${px}px`).style('top', `${py}px`);
			})
			.on('mouseleave', function () {
				d3.select(this).style('stroke', 'none');
				tooltip.style('opacity', 0);
			});

		// Left columns: circle and head label (to mirror table's first two columns)
		// Circles column (always grey scale based on aggregated score)
		gLeft.selectAll('circle.row-dot')
			.data(heads)
			.join('circle')
			.attr('class', 'row-dot')
			.attr('cx', circleColW / 2)
			.attr('cy', (_h, i) => y(yLabels[i]) + y.bandwidth() / 2)
			.attr('r', 8)
			.attr('stroke', '#ccc')
			.attr('fill', (h) => {
				if (shouldCircleBeRed(h.index, 'ATTN')) return 'darkred';
				const score = (h.row || []).reduce((a, b) => a + (b || 0), 0);
				// Use grey scale (independent of heatmap color scheme)
				const greyScale = d3.scaleSequential(d3.interpolateGreys).domain([minHeadScore, maxHeadScore]).clamp(true);
				return greyScale(score);
			});

		// Head text column
		gLeft.selectAll('text.row-head')
			.data(yLabels)
			.join('text')
			.attr('class', 'row-head')
			.attr('x', circleColW + 8)
			.attr('y', (d) => (y(d) ?? 0) + y.bandwidth() / 2)
			.attr('dominant-baseline', 'middle')
			.text(d => d);
	}

	// Re-render heatmap on mode/layer/sort changes
	// Re-render also when attnSort changes (include it as a reactive dependency)
	$: if (displayMode === 'heatmap' && options?.type === 'ATTN' && attnHeatmapEl && attnSort && heatmapMetric) {
		renderATTNHeatmap();
	}

	// FFN heatmap renderer
	function renderFFNHeatmap() {
		if (!ffnHeatmapEl || options?.type !== 'FFN' || !Array.isArray(options.values)) return;

		// Determine row order from existing sortedFFN (based on current heatmapMetric) or natural order
		const n = options.values.length;
		const order = (sortedFFN.length ? sortedFFN.map(d => d.index) : d3.range(n));

		// Build NIG and Activation datasets aligned by order
		const nigBase = (options.values || []).map((v, i) => ({ index: i, val: v }));
		const actBase = (Array.isArray(options.activations) ? options.activations : []).map((v, i) => ({ index: i, val: v }));
		const nigData = order.map(i => ({ index: i, val: nigBase[i]?.val }));
		const actData = order.map(i => ({ index: i, val: actBase[i]?.val }));
		const hasAct = Array.isArray(options.activations) && options.activations.length === n;

		// Stats for color scales - use global extent for both NIG and activations if available
		const nigVals = nigData.map(d => d.val).filter(v => typeof v === 'number' && isFinite(v));
		const actVals = actData.map(d => d.val).filter(v => typeof v === 'number' && isFinite(v));
		const nigMin = (options.globalNigExtent && options.globalNigExtent[0] != null) ? options.globalNigExtent[0] : (nigVals.length ? d3.min(nigVals) : 0);
		const nigMax = (options.globalNigExtent && options.globalNigExtent[1] != null) ? options.globalNigExtent[1] : (nigVals.length ? d3.max(nigVals) : 1);
		const nigMaxAbs = Math.max(Math.abs(nigMin || 0), Math.abs(nigMax || 1));
		const actMin = (options.globalFFNActivationExtent && options.globalFFNActivationExtent[0] != null) ? options.globalFFNActivationExtent[0] : (actVals.length ? d3.min(actVals) : 0);
		const actMax = (options.globalFFNActivationExtent && options.globalFFNActivationExtent[1] != null) ? options.globalFFNActivationExtent[1] : (actVals.length ? d3.max(actVals) : 1);
		const actMaxAbs = Math.max(Math.abs(actMin || 0), Math.abs(actMax || 1));

		// Helper function for symmetric log scale (handles negative values)
		// Using log10 for stronger compression and better color distribution
		const symlog = (x) => {
			if (x === 0) return 0;
			const absX = Math.abs(x);
			// Use log10 for stronger effect than log1p, with power adjustment for more vibrant colors
			const logVal = Math.log10(absX + 1);
			// Apply power transform (exponent 0.7) to spread out colors more
			return Math.sign(x) * Math.pow(logVal, 0.7);
		};
		
		// Logarithmic color scales with enhanced vibrancy - domains are in LOG SPACE
		const nigColor = (() => {
			if (nigMin < 0 && nigMax > 0) {
				// Diverging with enhanced symlog - domain is in LOG SPACE
				const logMaxAbs = symlog(nigMaxAbs);
				return (val) => {
					const logVal = symlog(val);
					// Use stronger color interpolator with gamma correction for more vibrant colors
					const baseColor = d3.scaleDiverging(d3.interpolateRdBu).domain([logMaxAbs, 0, -logMaxAbs]).clamp(true)(logVal);
					// Apply gamma correction to make colors more saturated (gamma = 0.8)
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				};
			} else {
				// Sequential with log - domain is in LOG SPACE
				const logMin = symlog(nigMin);
				const logMax = symlog(nigMax);
				return (val) => {
					const logVal = symlog(val);
					// Use Inferno with gamma correction for more vibrant colors
					const baseColor = d3.scaleSequential(d3.interpolateInferno).domain([logMin, logMax]).clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				};
			}
		})();
		
		const actColor = (() => {
			if (actMin < 0 && actMax > 0) {
				// Diverging with LINEAR mapping for activations
				return d3.scaleDiverging(d3.interpolateRdBu).domain([actMaxAbs, 0, -actMaxAbs]).clamp(true);
			} else {
				// Sequential with LINEAR mapping for activations
				return d3.scaleSequential(d3.interpolateReds).domain([actMin, actMax]).clamp(true);
			}
		})();

		// Layout
		const containerW = ffnHeatmapEl.clientWidth || 600;
		const circleColW = 28;
		const neuronColW = 120;
		const margin = { top: 28, right: 12, bottom: 20, left: 8 };
		const colGap = 16;
		const perColW = 200; // fixed width per metric column for clear visuals
		const rowH = 36;
		const innerH = n * rowH;
		const totalHeatW = hasAct ? perColW * 2 + colGap : perColW;
		const totalW = margin.left + circleColW + neuronColW + totalHeatW + margin.right;
		const totalH = innerH + margin.top + margin.bottom;

		// Build SVG wider than container if needed (container scrolls)
		const root = d3.select(ffnHeatmapEl);
		root.selectAll('*').remove();
		const svg = root.append('svg')
			.attr('width', totalW)
			.attr('height', totalH);
		const gLeft = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
		const gGrid = svg.append('g').attr('transform', `translate(${margin.left + circleColW + neuronColW},${margin.top})`);

		// Headers for two columns
		const header = gGrid.append('g').attr('class', 'axis-x');
		// NIG header
		const hNig = header.append('text')
			.attr('x', 0)
			.attr('y', -8)
			.text('NIG')
			.style('font-weight', '600')
			.style('cursor', 'pointer')
			.on('click', () => {
				// Switch sort metric to NIG
				heatmapMetric = 'nig';
				ffnSort = { key: 'val', dir: ffnSort.key === 'val' && ffnSort.dir === 'desc' ? 'asc' : 'desc' };
			});
		if (heatmapMetric !== 'activation' && ffnSort.key === 'val') {
			header.append('text')
				.attr('x', 36)
				.attr('y', -8)
				.attr('class', 'sort-icon')
				.text(ffnSort.dir === 'asc' ? '▲' : '▼');
		}
		// Activation header
		if (hasAct) {
			const xAct = perColW + colGap;
			const hAct = header.append('text')
				.attr('x', xAct)
				.attr('y', -8)
				.text('Activation')
				.style('font-weight', '600')
				.style('cursor', 'pointer')
				.on('click', () => {
					heatmapMetric = 'activation';
					ffnSort = { key: 'val', dir: ffnSort.key === 'val' && ffnSort.dir === 'desc' ? 'asc' : 'desc' };
				});
			if (heatmapMetric === 'activation' && ffnSort.key === 'val') {
				header.append('text')
					.attr('x', xAct + 92)
					.attr('y', -8)
					.attr('class', 'sort-icon')
					.text(ffnSort.dir === 'asc' ? '▲' : '▼');
			}
		}

		// Rows y-scale
		const y = d3.scaleBand().domain(order).range([0, innerH]).padding(0.05);

		// Circles (always colored by NIG values, regardless of heatmap metric)
		gLeft.selectAll('circle.row-dot')
			.data(order)
			.join('circle')
			.attr('class', 'row-dot')
			.attr('cx', circleColW / 2)
			.attr('cy', i => (y(i) ?? 0) + y.bandwidth() / 2)
			.attr('r', 8)
			.attr('stroke', '#ccc')
			.attr('fill', i => {
				if (shouldCircleBeRed(i, 'FFN')) return 'darkred';
				// Always use NIG scale for dots, regardless of heatmapMetric
				if (nigMin < 0 && nigMax > 0) return getColorScale(nigBase[i]?.val ?? 0, nigMin, nigMax);
				const gry = d3.scaleSequential(d3.interpolateInferno).domain([nigMin, nigMax]).clamp(true);
				return gry(nigBase[i]?.val ?? 0);
			});
		// Neuron labels
		gLeft.selectAll('text.row-neuron')
			.data(order)
			.join('text')
			.attr('class', 'row-neuron')
			.attr('x', circleColW + 8)
			.attr('y', i => (y(i) ?? 0) + y.bandwidth() / 2)
			.attr('dominant-baseline', 'middle')
			.text(i => `neuron#${i}`);

		// Heat cells: NIG column
		gGrid.selectAll('rect.cell-nig')
			.data(nigData)
			.join('rect')
			.attr('class', 'cell cell-nig')
			.attr('x', 0)
			.attr('y', d => y(d.index) ?? 0)
			.attr('rx', 3)
			.attr('ry', 3)
			.attr('width', perColW)
			.attr('height', y.bandwidth())
			.style('stroke', 'none')
			.style('opacity', 0.95)
			.attr('fill', d => nigColor(d.val))
			.on('mouseover', function (event, d) {
				d3.select(this).style('stroke', '#333').style('stroke-width', 1);
				d3.select(attnTooltipEl).style('opacity', 1)
					.html(`<b>neuron#${d.index}</b><br>NIG: ${formatValue(Number(d.val))}`);
			})
			.on('mousemove', function (event) {
				const px = Math.min(window.innerWidth - 160, (event.pageX || 0) + 12);
				const py = Math.min(window.innerHeight - 80, (event.pageY || 0) + 12);
				d3.select(attnTooltipEl).style('left', `${px}px`).style('top', `${py}px`);
			})
			.on('mouseleave', function () {
				d3.select(this).style('stroke', 'none');
				d3.select(attnTooltipEl).style('opacity', 0);
			});

		// Heat cells: Activation column (optional)
		if (hasAct) {
			gGrid.selectAll('rect.cell-act')
				.data(actData)
				.join('rect')
				.attr('class', 'cell cell-act')
				.attr('x', perColW + colGap)
				.attr('y', d => y(d.index) ?? 0)
				.attr('rx', 3)
				.attr('ry', 3)
				.attr('width', perColW)
				.attr('height', y.bandwidth())
				.style('stroke', 'none')
				.style('opacity', 0.95)
				.attr('fill', d => actColor(d.val))
				.on('mouseover', function (event, d) {
					d3.select(this).style('stroke', '#333').style('stroke-width', 1);
					d3.select(attnTooltipEl).style('opacity', 1)
						.html(`<b>neuron#${d.index}</b><br>Activation: ${formatValue(Number(d.val))}`);
				})
				.on('mousemove', function (event) {
					const px = Math.min(window.innerWidth - 160, (event.pageX || 0) + 12);
					const py = Math.min(window.innerHeight - 80, (event.pageY || 0) + 12);
					d3.select(attnTooltipEl).style('left', `${px}px`).style('top', `${py}px`);
				})
				.on('mouseleave', function () {
					d3.select(this).style('stroke', 'none');
					d3.select(attnTooltipEl).style('opacity', 0);
				});
		}
	}

	// Re-render also when ffnSort changes (include it as a reactive dependency)
	$: if (displayMode === 'heatmap' && options?.type === 'FFN' && ffnHeatmapEl && ffnSort && heatmapMetric) {
		renderFFNHeatmap();
	}

	// Also render after DOM updates to catch initial bind of attnHeatmapEl
	afterUpdate(() => {
		if (displayMode === 'heatmap' && options?.type === 'ATTN' && attnHeatmapEl) {
			requestAnimationFrame(() => renderATTNHeatmap());
		}
	});

	// Force heatmap mode for the special token-by-token attention layer view
	$: if (options && options.type === 'ATTN_LAYER_HEATMAP') {
		displayMode = 'heatmap';
	}

	// New: render a 5x5 token-type heatmap for full ATTN layer label selection
	function renderTokenByTokenHeatmap() {
		if (!attnHeatmapEl || options?.type !== 'ATTN_LAYER_HEATMAP' || !Array.isArray(options.values)) return;
		// options.values expected either as [12,5,5] heads, or directly [5,5] aggregated matrix
		let matrix = options.values;
		if (Array.isArray(matrix) && Array.isArray(matrix[0]) && Array.isArray(matrix[0][0])) {
			// Aggregate across heads by SUM (no abs)
			const H = matrix.length;
			const T = 5;
			const agg = Array.from({length:T}, ()=>Array(T).fill(0));
			for (let h=0; h<H; h++) {
				for (let r=0; r<T; r++) { // r indexes tgt in original [tgt][src]
					for (let c=0; c<T; c++) { // c indexes src in original
						// Build aggregated matrix as [src][tgt]
						agg[c][r] += (matrix[h][r][c] ?? 0);
					}
				}
			}
			matrix = agg;
		}
	// Orientation: aggregated matrix is [src][tgt].
	// We want 'tgtsToSrcs' (incoming view) to show column=target (so column CLS holds incoming values).
	// Therefore for 'tgtsToSrcs' we DO NOT transpose (rows=src, cols=tgt).
	// For 'srcToTgts' (outgoing view) we transpose so rows=tgt, cols=src.
	const orientation = options.orientation || 'tgtsToSrcs';
	const rows = (orientation === 'srcToTgts' ? d3.transpose(matrix) : matrix);
	const yLabels = TOKEN_TYPES.map(t=>t);
	const xLabels = TOKEN_TYPES.map(t=>t);
		
		// Use GLOBAL NIG extent for consistent color scale across all views
		// Note: Aggregated values (sum across heads) may exceed global range and will be clipped
		const flat = rows.flat().filter(v => typeof v === 'number' && isFinite(v));
		const localMinV = flat.length ? d3.min(flat) : 0;
		const localMaxV = flat.length ? d3.max(flat) : 1;
		
		// Use global extent strictly (with clamp=true to handle values outside range)
		const minV = options.globalNigExtent && options.globalNigExtent[0] != null
			? options.globalNigExtent[0]
			: localMinV;
		const maxV = options.globalNigExtent && options.globalNigExtent[1] != null
			? options.globalNigExtent[1]
			: localMaxV;
		
		const maxAbs = Math.max(Math.abs(minV||0), Math.abs(maxV||1));
		
		// Helper function for symmetric log scale (same as ATTN heatmap)
		const symlog = (x) => {
			if (x === 0) return 0;
			const absX = Math.abs(x);
			const logVal = Math.log10(absX + 1);
			return Math.sign(x) * Math.pow(logVal, 0.7);
		};
		
		// Use logarithmic scale with gamma correction (same as individual head heatmaps)
		let color;
		if (minV < 0 && maxV > 0) {
			const logMaxAbs = symlog(maxAbs);
			color = (val) => {
				const logVal = symlog(val);
				const baseColor = d3.scaleDiverging(d3.interpolateRdBu).domain([logMaxAbs, 0, -logMaxAbs]).clamp(true)(logVal);
				const rgb = d3.color(baseColor).rgb();
				rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
				rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
				rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
				return rgb.toString();
			};
		} else {
			const logMin = symlog(minV);
			const logMax = symlog(maxV);
			color = (val) => {
				const logVal = symlog(val);
				const baseColor = d3.scaleSequential(d3.interpolateInferno).domain([logMin, logMax]).clamp(true)(logVal);
				const rgb = d3.color(baseColor).rgb();
				rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
				rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
				rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
				return rgb.toString();
			};
		}

		// Size similarly to ATTN heatmaps: fill container width and use generous row height
		const containerW = attnHeatmapEl.clientWidth || 600;
		const margin = { top: 32, right: 12, bottom: 24, left: 100 }; // a touch more space top & bottom
		const tokenAreaW = Math.max(300, containerW - margin.left - margin.right);
		const rowH = 48; // larger rows for legibility like ATTN heatmap
		const innerW = tokenAreaW;
		const innerH = rowH * yLabels.length;
		// Space above heatmap rows: label + axis headings; dynamic so headings pushed below label clearly
		const headingsYOffset = 32; // push token headings further down to clear the top label
		const headerOffset = headingsYOffset ; // start of first data row
		const totalW = margin.left + innerW + margin.right;
		const totalH = margin.top + innerH + headerOffset + margin.bottom;

		const root = d3.select(attnHeatmapEl);
		root.selectAll('*').remove();
		const svgRoot = root.append('svg')
			.attr('width', containerW)
			.attr('height', totalH);
		const g = svgRoot.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

		// Axes labels and scales
		const x = d3.scaleBand().domain(xLabels).range([0, innerW]).padding(0.05);
		const y = d3.scaleBand().domain(yLabels).range([headerOffset, innerH + headerOffset]).padding(0.05);
		// Token type headings moved further down so the top label does not overlap
		const xAxisTop = g.append('g')
			.attr('class', 'axis-x token-axis-x')
			.attr('transform', `translate(0,${headingsYOffset})`)
			.call(d3.axisTop(x).tickSize(0))
			.call(g=>g.selectAll('.domain').remove());
		// Force tick labels to render below the axis baseline so they sit under the top label
		xAxisTop.selectAll('text')
			.attr('y', 6)
			.attr('dy', '1.1em');
		g.append('g')
			.attr('class', 'axis-y')
			.call(d3.axisLeft(y).tickSize(0))
			.call(g=>g.selectAll('.domain').remove());

		// Axis semantic labels (sources vs targets) depend on orientation mapping
		const isIncoming = orientation === 'tgtsToSrcs'; // incoming view rows=src cols=tgt
		const colLabel = isIncoming ? 'Targets' : 'Sources';
		const rowLabel = isIncoming ? 'Sources' : 'Targets';
		// Top centered label above columns
		g.append('text')
			.attr('class','axis-label axis-label-top')
			.attr('x', innerW / 2)
			.attr('y', 0)
			.attr('text-anchor','middle')
			.text(colLabel);
		// Left vertical label beside rows
		g.append('text')
			.attr('class','axis-label axis-label-left')
			.attr('x', -64)
			.attr('y', (innerH + headerOffset) / 2)
			.attr('text-anchor','middle')
			.attr('transform', `rotate(-90 -64 ${(innerH + headerOffset)/2})`)
			.text(rowLabel);

		// Tooltip is a global element under document.body (not clipped by container)
		const tooltip = d3.select(attnTooltipEl).style('opacity', 0);

		const data = [];
		for (let i=0;i<yLabels.length;i++) {
			for (let j=0;j<xLabels.length;j++) {
				const incoming = orientation === 'tgtsToSrcs';
				const srcLabel = incoming ? yLabels[i] : xLabels[j];
				const tgtLabel = incoming ? xLabels[j] : yLabels[i];
				data.push({ row: yLabels[i], col: xLabels[j], value: rows[i]?.[j] ?? 0, srcLabel, tgtLabel });
			}
		}
		g.selectAll('rect.cell')
			.data(data)
			.join('rect')
			.attr('class','cell')
			.attr('x', d => x(d.col) ?? 0)
			.attr('y', d => y(d.row) ?? 0)
			.attr('rx',3).attr('ry',3)
			.attr('width', x.bandwidth())
			.attr('height', y.bandwidth())
			.style('stroke','none').style('opacity',0.95)
			.attr('fill', d => color(d.value))
			.on('mouseover', function (event, d) {
				d3.select(this).style('stroke', '#333').style('stroke-width', 1);
				tooltip.style('opacity', 1)
					.html(`<b>${d.srcLabel} → ${d.tgtLabel}</b><br>value: ${formatValue(Number(d.value))}`);
			})
			.on('mousemove', function (event) {
				const px = Math.min(window.innerWidth - 160, (event.pageX || 0) + 12);
				const py = Math.min(window.innerHeight - 80, (event.pageY || 0) + 12);
				tooltip.style('left', `${px}px`).style('top', `${py}px`);
			})
			.on('mouseleave', function () {
				d3.select(this).style('stroke', 'none');
				tooltip.style('opacity', 0);
			});
	}

	$: if (displayMode === 'heatmap' && options?.type === 'ATTN_LAYER_HEATMAP' && attnHeatmapEl) {
		renderTokenByTokenHeatmap();
	}

	// Reactive color scale data - compute based on current metric and data availability
	$: colorScaleData = (() => {
		let minV, maxV, hasData = false;
		
		// In heatmap mode, use the selected metric; otherwise default to NIG
		const useActivation = displayMode === 'heatmap' && heatmapMetric === 'activation';
		
		if (useActivation) {
			// Use activation extents
			if (options.type === 'ATTN' && options.globalAttnActivationExtent) {
				minV = options.globalAttnActivationExtent[0];
				maxV = options.globalAttnActivationExtent[1];
				hasData = true;
			} else if (options.type === 'FFN' && options.globalFFNActivationExtent) {
				minV = options.globalFFNActivationExtent[0];
				maxV = options.globalFFNActivationExtent[1];
				hasData = true;
			}
		} else {
			// Use NIG extents (works in all modes)
			if (options.globalNigExtent) {
				minV = options.globalNigExtent[0];
				maxV = options.globalNigExtent[1];
				hasData = true;
			}
		}

		if (!hasData || minV == null || maxV == null) {
			// Default grayscale when no data
			return { colors: [], values: [], hasData: false };
		}

		// Generate 8 color stops
		const steps = 8;
		const colors = [];
		const values = [];
		
		// Use same color logic as heatmaps
		const maxAbs = Math.max(Math.abs(minV), Math.abs(maxV));
		const symlog = (x) => {
			if (x === 0) return 0;
			const absX = Math.abs(x);
			const logVal = Math.log10(absX + 1);
			return Math.sign(x) * Math.pow(logVal, 0.7);
		};

		if (useActivation) {
			// LINEAR scale for activations
			if (minV < 0 && maxV > 0) {
				// Diverging - REVERSED: from -maxAbs to maxAbs (blue to red)
				const scale = d3.scaleDiverging(d3.interpolateRdBu).domain([maxAbs, 0, -maxAbs]).clamp(true);
				for (let i = 0; i < steps; i++) {
					const t = i / (steps - 1);
					const val = -maxAbs + (2 * maxAbs * t); // from -maxAbs to maxAbs
					values.push(val);
					colors.push(scale(val));
				}
			} else {
				// Sequential
				const scale = d3.scaleSequential(d3.interpolateReds).domain([minV, maxV]).clamp(true);
				for (let i = 0; i < steps; i++) {
					const t = i / (steps - 1);
					const val = minV + (maxV - minV) * t;
					values.push(val);
					colors.push(scale(val));
				}
			}
		} else {
			// LOGARITHMIC scale for NIG
			if (minV < 0 && maxV > 0) {
				// Diverging with symlog - REVERSED: from -maxAbs to maxAbs (blue to red)
				const logMaxAbs = symlog(maxAbs);
				for (let i = 0; i < steps; i++) {
					const t = i / (steps - 1);
					const val = -maxAbs + (2 * maxAbs * t); // from -maxAbs to maxAbs
					const logVal = symlog(val);
					const baseColor = d3.scaleDiverging(d3.interpolateRdBu).domain([logMaxAbs, 0, -logMaxAbs]).clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					values.push(val);
					colors.push(rgb.toString());
				}
			} else {
				// Sequential with log
				const logMin = symlog(minV);
				const logMax = symlog(maxV);
				for (let i = 0; i < steps; i++) {
					const t = i / (steps - 1);
					const val = minV + (maxV - minV) * t;
					const logVal = symlog(val);
					const baseColor = d3.scaleSequential(d3.interpolateInferno).domain([logMin, logMax]).clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					values.push(val);
					colors.push(rgb.toString());
				}
			}
		}

		return { colors, values, hasData: true };
	})();

	// Handler functions for color scale tooltips
	function handleColorScaleMouseover(event, value) {
		if (!colorScaleTooltipEl) return;
		const tooltip = d3.select(colorScaleTooltipEl);
		tooltip.style('opacity', 1)
			.html(`<b>${heatmapMetric === 'activation' ? 'Activation' : 'NIG Value'}</b><br>${formatValue(value)}`);
	}

	function handleColorScaleMousemove(event) {
		if (!colorScaleTooltipEl) return;
		const tooltip = d3.select(colorScaleTooltipEl);
		const px = Math.min(window.innerWidth - 160, (event.pageX || 0) + 12);
		const py = Math.min(window.innerHeight - 80, (event.pageY || 0) + 12);
		tooltip.style('left', `${px}px`).style('top', `${py}px`);
	}

	function handleColorScaleMouseleave() {
		if (!colorScaleTooltipEl) return;
		const tooltip = d3.select(colorScaleTooltipEl);
		tooltip.style('opacity', 0);
	}
</script>


<div style="max-width: 100%; overflow: hidden;">
	<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem; gap: 1rem;">
		<div style="flex: 1; min-width: 0;">
			{#if options.summary}
			<div style="color:#4b5563; font-size: 0.925rem; margin-bottom: 0.25rem;">
				Info: {options.summary}
			</div>
			{/if}
			<div style="color:#4b5563; font-size: 0.925rem;">
				Shape: {JSON.stringify(getShape(options.values))}
			</div>
		</div>
		
		<!-- Color Scale Legend - always visible -->
		<div class="color-scale-legend" style="flex-shrink: 0; padding-right: 0.5rem;">
			<div style="font-size: 0.75rem; color:#6b7280; margin-bottom: 0.25rem; text-align: right;">
				{displayMode === 'heatmap' ? (heatmapMetric === 'activation' ? 'Activation' : 'NIG') : 'NIG'} Scale
			</div>
			<div class="color-scale-boxes">
				{#if colorScaleData.hasData}
					{#each colorScaleData.colors as color, i}
						<div 
							class="color-box"
							role="button"
							tabindex="0"
							aria-label="Color scale value {formatValue(colorScaleData.values[i])}"
							style="background-color: {color};"
							on:mouseover={(e) => handleColorScaleMouseover(e, colorScaleData.values[i])}
							on:focus={(e) => handleColorScaleMouseover(e, colorScaleData.values[i])}
							on:mousemove={handleColorScaleMousemove}
							on:mouseleave={handleColorScaleMouseleave}
							on:blur={handleColorScaleMouseleave}
						></div>
					{/each}
				{:else}
					<!-- Default grayscale when no data -->
					{#each Array(8) as _, i}
						<div 
							class="color-box"
							role="button"
							tabindex="0"
							aria-label="Color scale grayscale level {i + 1}"
							style="background-color: rgb({255 - i * 30}, {255 - i * 30}, {255 - i * 30});"
						></div>
					{/each}
				{/if}
			</div>
		</div>
	</div>

	{#if options.type === 'ATTN_LAYER_HEATMAP'}
		<div class="attn-heatmap-container">
			<div class="attn-heatmap" bind:this={attnHeatmapEl}></div>
		</div>

	<!-- FFN table -->
	{:else if options.type === 'FFN' && Array.isArray(options.values)}
		<div class="mode-toggle">
			<button class:selected={displayMode === 'values'} on:click={() => displayMode = 'values'}>Values</button>
			<button class:selected={displayMode === 'heatmap'} on:click={() => displayMode = 'heatmap'}>Heatmap</button>
		</div>
		{#if displayMode === 'values'}
		<div class="ffn-table-container">
			<table class="nig-table">
				<thead>
					<tr>
						<th></th>
						<th>Neuron</th>
						<th class="sortable" class:active={heatmapMetric !== 'activation'} on:click={() => { heatmapMetric = 'nig'; ffnSort = { key: 'val', dir: ffnSort.key === 'val' && ffnSort.dir === 'desc' ? 'asc' : 'desc' }; }}>
							NIG Value {#if heatmapMetric !== 'activation' && ffnSort.key === 'val'}<span class="sort-icon">{ffnSort.dir === 'asc' ? '▲' : '▼'}</span>{/if}
						</th>
						<th class="sortable" class:active={heatmapMetric === 'activation'} on:click={() => { if (Array.isArray(options.activations)) { heatmapMetric = 'activation'; ffnSort = { key: 'val', dir: ffnSort.key === 'val' && ffnSort.dir === 'desc' ? 'asc' : 'desc' }; } }}>
							Activation {#if heatmapMetric === 'activation' && ffnSort.key === 'val'}<span class="sort-icon">{ffnSort.dir === 'asc' ? '▲' : '▼'}</span>{/if}
						</th>
					</tr>
				</thead>
				{#key pruningState}
				<tbody>
					{#each sortedFFN as { index, val }}
					<tr 
						class:edge-contributor={isValueUsedInEdges(val)}
						class:pruning-cursor={pruningCursorEnabled}
						class:conditional-cursor={conditionalCursorEnabled}
						on:click={() => {
							if (conditionalCursorEnabled) {
								handleConditionalNigTarget(index, 'FFN');
							} else {
								togglePruningTarget(index, 'FFN');
							}
						}}
					>
						<td><div class="circle" style="background-color: {shouldCircleBeRed(index, 'FFN') ? 'darkred' : getColorScale(val, minFFN, maxFFN)}"></div></td>
						<td>neuron#{index}</td>
						<td class:highlight-edge={isValueUsedInEdges(val)}>{formatValue(val)}</td>
						<td>{Array.isArray(options.activations) && options.activations[index] !== undefined ? formatValue(options.activations[index]) : '--'}</td>
					</tr>
					{/each}
				</tbody>
				{/key}
			</table>
		</div>
		{:else}
			<div class="ffn-heatmap-container">
				<div class="ffn-heatmap" bind:this={ffnHeatmapEl}></div>
			</div>
		{/if}

	<!-- ATTN table / heatmap -->
	{:else if options.type === 'ATTN' && Array.isArray(options.values)}
		<div class="mode-toggle">
			<button class:selected={displayMode === 'values'} on:click={() => displayMode = 'values'}>Values</button>
			<button class:selected={displayMode === 'heatmap'} on:click={() => displayMode = 'heatmap'}>Heatmap</button>
			{#if displayMode === 'heatmap'}
				<div class="metric-toggle">
					<label><input type="radio" name="metric-attn" value="nig" bind:group={heatmapMetric}> NIG</label>
					<label><input type="radio" name="metric-attn" value="activation" bind:group={heatmapMetric}> Activation</label>
				</div>
			{/if}
		</div>

		{#if displayMode === 'values'}
			<table class="nig-table">
				<thead>
					<tr>
						<th></th>
						<th>Head</th>
						{#if options.orientation === 'tgtsToSrcs'}
							{#each TOKEN_TYPES as src, colIdx}
								<th class="sortable" class:active={attnSort.column === colIdx} on:click={() => { 
									attnSort = { column: colIdx, dir: (attnSort.column === colIdx ? (attnSort.dir === 'desc' ? 'asc' : 'desc') : 'desc') }; 
									requestArchitectureSelection(src);
								}}>
									{src} → {#if attnSort.column === colIdx}<span class="sort-icon">{attnSort.dir === 'asc' ? '▲' : '▼'}</span>{/if}
								</th>
							{/each}
						{:else}
							{#each TOKEN_TYPES as tgt, colIdx}
								<th class="sortable" class:active={attnSort.column === colIdx} on:click={() => { 
									attnSort = { column: colIdx, dir: (attnSort.column === colIdx ? (attnSort.dir === 'desc' ? 'asc' : 'desc') : 'desc') }; 
									requestArchitectureSelection(tgt);
								}}>
									→ {tgt} {#if attnSort.column === colIdx}<span class="sort-icon">{attnSort.dir === 'asc' ? '▲' : '▼'}</span>{/if}
								</th>
							{/each}
						{/if}
					</tr>
				</thead>
				{#key pruningState}
				<tbody>
					{#each scoredHeads as head}
					<tr
						class:pruning-cursor={pruningCursorEnabled}
						class:conditional-cursor={conditionalCursorEnabled}
						on:click={() => {
							if (conditionalCursorEnabled) {
								handleConditionalNigTarget(head.index, 'ATTN');
							} else {
								togglePruningTarget(head.index, 'ATTN');
							}
						}}
					>
						<td><div class="circle" style="background-color: {shouldCircleBeRed(head.index, 'ATTN') ? 'darkred' : d3.scaleSequential(d3.interpolateGreys).domain([minHeadScore, maxHeadScore]).clamp(true)(head.score)}"></div></td>
						<td>head#{head.index}</td>
						{#each head.row as val}
						<td class:highlight-edge={isValueUsedInEdges(val)}>{formatValue(val)}</td>
						{/each}
					</tr>
					{/each}
				</tbody>
				{/key}
			</table>
		{:else}
			<div class="attn-heatmap-container">
				<div class="attn-heatmap" bind:this={attnHeatmapEl}></div>
			</div>
		{/if}

	<!-- Fallback: raw output -->
	{:else}
		{#if options.hasNigData && (options.values === undefined || options.values === null)}
			<p style="color: #666; font-style: italic; margin-top: 1rem;">
				Click on shapes to select layers and token types
			</p>
		{:else if !options.hasNigData}
			<pre>No values available</pre>
		{:else}
			<pre>{JSON.stringify(options.values, null, 2)}</pre>
		{/if}
	{/if}
</div>

<style>
	/* removed .my-color header style (title now comes from widget title) */
	.nig-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 1rem;
	}
	.nig-table th,
	.nig-table td {
		padding: 8px 6px;
		border: 1px solid #ccc;
		text-align: left;
	}
	.sortable { cursor: pointer; user-select: none; }
	.sort-icon { font-size: 0.8em; margin-left: 6px; opacity: 0.7; }
	th.active { color: #16a34a; } /* green-600 */
	.circle {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		display: inline-block;
		margin-right: 4px;
		border: 1px solid #ccc; /* Add border for blank circles */
	}
	pre {
		background-color: #f4f4f4;
		padding: 10px;
		border-radius: 5px;
		overflow-x: auto;
	}
	.ffn-table-container {
		max-width: 100%; /* Prevent horizontal overflow */
		overflow-y: auto; /* Enable vertical scrolling */
		overflow-x: auto; /* Allow horizontal scroll for wide content */
		margin-top: 1rem;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	.ffn-table-container table {
		width: 100%;
		border-collapse: collapse;
	}
	.ffn-table-container thead {
		position: sticky;
		top: 0;
		background-color: white;
		z-index: 1;
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
	}

	/* ATTN heatmap sizing */
	.attn-heatmap-container {
		max-width: 100%; /* Prevent horizontal overflow */
		overflow: auto;
		border: 1px solid #ddd;
		border-radius: 4px;
		margin-top: 0.5rem;
		position: relative;
	}
	.attn-heatmap {
		width: 100%;
		min-height: 120px;
	}

	/* FFN heatmap sizing */
	.ffn-heatmap-container {
		max-height: 500px;
		overflow: auto;
		border: 1px solid #ddd;
		border-radius: 4px;
		margin-top: 0.5rem;
		position: relative;
	}
	.ffn-heatmap {
		width: 100%;
		min-height: 120px;
	}
	:global(.heatmap-tooltip) {
		position: absolute;
		pointer-events: none;
		background: white;
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
		box-shadow: 0 2px 4px rgba(0,0,0,0.08);
		z-index: 9999;
		transition: opacity 0.2s ease;
	}

	/* Match table active column (green) */
	:global(.axis-x g.tick.active text) {
		fill: #16a34a;
		font-weight: 600;
	}

	/* Align axis fonts with table header */
	:global(.axis-x text),
	:global(.axis-y text) {
		font-size: 16px; /* match table header appearance */
		font-family: inherit;
		font-weight: 600; /* bold like table th */
	}
	/* axis uses same .sort-icon style as table */
	:global(.axis-x .sort-icon) {
		font-size: 10px;
		opacity: 0.7;
	}
	/* Add small spacing above top axis like the table header row */
	:global(.axis-x) {
		transform: translateY(-4px);
	}
	/* Do not shift the token-by-token top axis upward; keep headings fully below the label */
	:global(.token-axis-x) {
		transform: none !important;
	}
	:global(.axis-label) { font-size: 14px; fill: #374151; font-weight: 600; }

	/* Highlight cells that contribute to edges in the architecture */
	.highlight-edge {
		background-color: #fef3c7 !important; /* amber-100 */
		border: 2px solid #f59e0b !important; /* amber-500 */
		font-weight: 700 !important;
		box-shadow: 0 0 0 1px #f59e0b inset;
	}

	/* Highlight FFN neuron rows that contribute to edges */
	.edge-contributor {
		background-color: #fef9e7; /* light amber tint */
	}

	.edge-contributor td {
		border-color: #fbbf24; /* amber-400 */
	}

	/* Color Scale Legend */
	.color-scale-legend {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		max-width: 100%;
	}

	.color-scale-boxes {
		display: flex;
		gap: 0;
		align-items: center;
		flex-wrap: nowrap;
		max-width: 100%;
	}

	.color-box {
		width: 24px;
		height: 24px;
		border: 1px solid #d1d5db;
		border-radius: 3px;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.color-box:hover,
	.color-box:focus {
		transform: scale(1.15);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		border-color: #9ca3af;
		z-index: 10;
		outline: none;
	}

	.color-box:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: 2px;
	}

	/* Conditional NIG cursor styling */
	tr.conditional-cursor {
		cursor: crosshair;
	}
	tr.conditional-cursor:hover {
		background-color: #dbeafe !important; /* blue-100 */
		border-color: #3b82f6 !important; /* blue-500 */
	}
</style>
