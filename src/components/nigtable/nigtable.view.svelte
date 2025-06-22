<script>
	export let options$;
	let options = {};

	options$.subscribe(value => {
		options = value;
	});

	const TOKEN_TYPES = ['cls', 'qry', 'sep1', 'doc', 'sep2'];

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

<div>
	<h3 class="my-color">
		Layer: {options.layer || "None selected"} |
		LayerType: {options.type || "None selected"} |
		Token Type: {options.tokenType || "None selected"} |
		Shape: {JSON.stringify(getShape(options.values))}
	</h3>

	<!-- FFN table -->
	{#if options.type === 'FFN' && Array.isArray(options.values)}
		<table class="nig-table">
			<thead>
				<tr>
					<th></th>
					<th>Neuron</th>
					<th>NIG Value</th>
					<th>Attention</th>
				</tr>
			</thead>
			<tbody>
				{#each sortedFFN as { index, val }}
				<tr>
					<td><div class="circle" style="background-color: {getColorScale(val, minFFN, maxFFN)}"></div></td>
					<td>neuron#{index}</td>
					<td>{formatValue(val)}</td>
					<td>--</td>
				</tr>
				{/each}
			</tbody>
		</table>

	<!-- ATTN table -->
	{:else if options.type === 'ATTN' && Array.isArray(options.values)}
		<table class="nig-table">
			<thead>
				<tr>
					<th></th>
					<th>Head</th>
					{#each TOKEN_TYPES as tgt}
						<th>{tgt}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each scoredHeads as head}
				<tr>
					<td><div class="circle" style="background-color: {getColorScale(head.score, minHeadScore, maxHeadScore)}"></div></td>
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
		<pre>{JSON.stringify(options.values || "No values available", null, 2)}</pre>
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
</style>
