<script>
	import { onMount, afterUpdate } from 'svelte';
	export let options$;
	export let pruningState$;
	let options = {};
	let pruningState = { enabled: false, rules: [], targets: [], thresholds: {} };

	// DOM refs for measuring full height (header + table) when ATTN is displayed
	let attnTableEl;
	let componentRootEl;

	function updateSharedHeightFromATTN() {
		if (componentRootEl && options.type === 'ATTN') {
			// Use the component's full content height (header + table)
			const h = Math.round(componentRootEl.scrollHeight || componentRootEl.getBoundingClientRect().height);
			if (h && Number.isFinite(h)) {
				document.documentElement.style.setProperty('--nig-table-height', `${h}px`);
			}
		}
	}

	onMount(() => {
		updateSharedHeightFromATTN();
	});

	afterUpdate(() => {
		updateSharedHeightFromATTN();
	});

	options$.subscribe(value => {
		options = value;
	});

	pruningState$.subscribe(value => {
		pruningState = value;
		if (value.targets && value.targets.length > 0) {
			console.log('Nigtable received pruning targets:', value.targets);
		}
	});

	const TOKEN_TYPES = ['cls', 'qry', 'sep1', 'doc', 'sep2'];

	// Function to check if a neuron/head should be red based on pruning targets OR threshold-based pruning
	function shouldCircleBeRed(index, layerType) {
		if (!pruningState.enabled || !options.layer) return false;
		
		// Extract layer number from options.layer (e.g., "bert.encoder.layer.0.attention" -> "L0_ATTN")
		const layerMatch = options.layer.match(/layer\.(\d+)\.(attention|intermediate)/);
		if (!layerMatch) return false;
		
		const layerNum = layerMatch[1];
		const type = layerMatch[2] === 'attention' ? 'ATTN' : 'FFN';
		const layerKey = `L${layerNum}_${type}`;
		
		// Check 1: Is this specific neuron/head explicitly selected in pruning targets?
		// Targets should be specific to layer, neuron/head, AND token type
		// Convert both to numbers to avoid string/number mismatch
		const isExplicitlyTargeted = pruningState.targets.some(target => 
			target.layer === layerKey && 
			parseInt(target.neuron) === parseInt(index) &&
			target.tokenType === options.tokenType
		);
		
		if (isExplicitlyTargeted) {
			console.log(`Neuron ${index} is explicitly targeted in layer ${layerKey} for token ${options.tokenType}`);
			return true;
		}
		
		// Check 2: Is there a pruning rule that applies to this neuron/head?
		const isRuleApplied = pruningState.rules.some(rule => {
			// Rule must match the layer
			if (rule.layer !== layerKey) return false;
			
			// If rule is for "all" token types, it applies regardless of current token selection
			if (rule.tokenType === 'all') return true;
			
			// If rule is for specific token type, it must match the current token selection
			return rule.tokenType === options.tokenType;
		});
		
		if (isRuleApplied) return true;
		
		// Check 3: Would this neuron/head be pruned based on threshold?
		if (options.pruningCutoffs) {
			if (layerType === 'FFN' && pruningState.thresholds.ffn > 0 && Array.isArray(options.values)) {
				// For FFN: check if this neuron's value would be pruned based on threshold
				const neuronValue = Math.abs(options.values[index]);
				return neuronValue >= options.pruningCutoffs.ffn;
			}
			
			if (layerType === 'ATTN' && pruningState.thresholds.attention > 0 && Array.isArray(options.values)) {
				// For ATTN: check if any of this head's values would be pruned based on threshold  
				const headValues = options.values[index];
				if (Array.isArray(headValues)) {
					return headValues.some(val => Math.abs(val) >= options.pruningCutoffs.attention);
				}
			}
		}
		
		return false;
	}	function getShape(values) {
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

	function formatValue(value) {
		return value.toExponential(2); // Format value in scientific notation with 3 decimal places
	}

	// FFN-specific calculations
	let sortedFFN = [];
	let minFFN = 0;
	let maxFFN = 1;

	$: if (options.type === 'FFN' && Array.isArray(options.values)) {
		sortedFFN = options.values
			.map((val, i) => ({ index: i, val }))
			.sort((a, b) => b.val - a.val);
		minFFN = Math.min(...sortedFFN.map(x => x.val));
		maxFFN = Math.max(...sortedFFN.map(x => x.val));
		console.log(`FFN table updated with ${sortedFFN.length} neurons`);
		console.log('Current pruning state:', pruningState);
	}

	// ATTN-specific calculations
	let scoredHeads = [];
	let minHeadScore = 0;
	let maxHeadScore = 1;

	$: if (options.type === 'ATTN' && Array.isArray(options.values)) {
		scoredHeads = options.values.map((row, i) => ({
			index: i,
			row,
			score: row.reduce((a, b) => a + b, 0),
		})).sort((a, b) => b.score - a.score);
		minHeadScore = Math.min(...scoredHeads.map(x => x.score));
		maxHeadScore = Math.max(...scoredHeads.map(x => x.score));
	}
</script>

<div bind:this={componentRootEl}>
	<h3 class="my-color">
		Layer: {options.layer || "None selected"} |
		LayerType: {options.type || "None selected"} |
		Token Type: {options.tokenType || "None selected"} |
		Shape: {JSON.stringify(getShape(options.values))}
	</h3>

	<!-- FFN table -->
	{#if options.type === 'FFN' && Array.isArray(options.values)}
		<div class="ffn-table-container">
			<table class="nig-table">
				<thead>
					<tr>
						<th></th>
						<th>Neuron</th>
						<th>NIG Value</th>
						<th>Activation</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedFFN as { index, val }}
					<tr>
						<td><div class="circle" style="background-color: {shouldCircleBeRed(index, 'FFN') ? 'darkred' : getColorScale(val, minFFN, maxFFN)}"></div></td>
						<td>neuron#{index}</td>
						<td>{formatValue(val)}</td>
						<td>--</td>
					</tr>
					{/each}
				</tbody>
			</table>
		</div>

	<!-- ATTN table -->
	{:else if options.type === 'ATTN' && Array.isArray(options.values)}
		<table class="nig-table" bind:this={attnTableEl}>
			<thead>
				<tr>
					<th></th>
					<th>Head</th>
					{#each TOKEN_TYPES as tgt}
						<th>→ {tgt}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each scoredHeads as head}
				<tr>
					<td><div class="circle" style="background-color: {shouldCircleBeRed(head.index, 'ATTN') ? 'darkred' : getColorScale(head.score, minHeadScore, maxHeadScore)}"></div></td>
					<td>head#{head.index}</td>
					{#each head.row as val}
					<td>{formatValue(val)}</td>
					{/each}
				</tr>
				{/each}
			</tbody>
		</table>

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
	.my-color {
		color: seagreen;
		margin-bottom: 0.5rem;
	}
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
		max-height: 500px; /* Set a fixed height for the container */
		overflow-y: auto; /* Enable vertical scrolling */
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
</style>
