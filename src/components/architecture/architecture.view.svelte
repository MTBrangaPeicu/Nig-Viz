<script>
	import { createEventDispatcher } from 'svelte';
	let { options, selection$ } = $props();

	// Handle button click to select layer and token type
	function handleButtonClick(layer, tokenType) {
		console.log("Button Clicked - Layer:", layer, "Token Type:", tokenType);
		selection$.next({ layer, tokenType }); // Update the reactive store
	}
</script>

<div>
	<h3 class="my-color">Architecture Grid</h3>
	<p><strong>Selected Layer:</strong> {selection$.getValue().layer || "None"} | <strong>Selected Token Type:</strong> {selection$.getValue().tokenType || "None"}</p>

	<!-- Grid of buttons -->
	<div class="grid">
		<!-- Header row for token types -->
		<div class="header">
			<div></div>
			{#each ['cls', 'qry', 'sep1', 'doc', 'sep2'] as tokenType}
				<div class="header-label">{tokenType}</div>
			{/each}
		</div>

		<!-- Rows for layers -->
		{#each Array(12).fill(0).map((_, i) => i) as layer}
			<div class="row">
				<div class="layer-label">L{layer}</div>
				{#each ['cls', 'qry', 'sep1', 'doc', 'sep2'] as tokenType}
					<div class="cell">
						<button onclick={() => handleButtonClick(layer, tokenType)} aria-label={`Select layer ${layer} and token type ${tokenType}`}></button>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.my-color {
		color: seagreen;
	}
	.grid {
		display: grid;
		grid-template-columns: 100px repeat(5, 30px); /* First column for layer labels, remaining for buttons */
		gap: 5px; /* Space between rows and columns */
		width: auto; /* Dynamic width based on content */
		margin-left: 0; /* Align grid to the left */
		margin-right: auto; /* Leave empty space on the right */
	}
	.header {
		display: contents; /* Ensure header aligns with grid columns */
	}
	.header-label {
		text-align: center;
		font-weight: bold;
		font-size: 12px; /* Shorten label size */
	}
	.row {
		display: contents; /* Ensure rows align with grid columns */
	}
	.layer-label {
		text-align: left;
		font-weight: bold;
		font-size: 12px; /* Shorten label size */
	}
	.cell {
		display: flex;
		justify-content: center;
		align-items: center;
	}
	button {
		width: 30px; /* Button size */
		height: 30px;
		background-color: white;
		border: 1px solid lightgray;
		border-radius: 3px;
		cursor: pointer;
	}
	button:hover {
		border-color: gray;
	}
</style>
