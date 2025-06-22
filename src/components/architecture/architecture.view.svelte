<script>
	import { onMount } from 'svelte';
	import * as d3 from 'd3';

	export const options = {};
	export let selection$;
	import { writable } from 'svelte/store';
	
	export let threshold$;
	let threshold = 0;
	let previousThreshold = null;
	let previousEdges = null;

	const unsubscribe = threshold$.subscribe(val => {
		if (val !== previousThreshold) {
			threshold = val;
			previousThreshold = val;
			redrawEdges();
		}
	});

	let svg;
	let edgesGroup;

	// Handle click events for FFN and ATTN layers
	function handleClick(layer, type, tokenType) {
		console.log(`Clicked - Layer: ${layer}, Type: ${type}, Token Type: ${tokenType}`);
		selection$.next({ layer, type, tokenType });
	}

	function filterEdgesByThreshold(edges, threshold) {
		if (!edges || edges.length === 0) {
			console.warn("Invalid edges data:", edges);
			return [];
		}
		// Sort edges by absolute NIG value (descending) and select top percentage based on threshold
		const sortedEdges = edges.sort((a, b) => Math.abs(b.nigValue) - Math.abs(a.nigValue));
		const cutoffIndex = Math.floor(sortedEdges.length * threshold);
		return sortedEdges.slice(0, cutoffIndex);
	}

	function drawEdges(edges) {
		if (!edgesGroup) {
			console.error("Edges group is not defined. Ensure onMount has initialized the SVG element.");
			return;
		}

		// Clear existing edges
		edgesGroup.selectAll(".edge-line").remove();

		const filteredEdges = filterEdgesByThreshold(edges, threshold);

		// Compute min/max for scaling
		const absVals = filteredEdges.map(e => Math.abs(e.nigValue));
		const min = absVals.length ? Math.min(...absVals) : 0;
		const max = absVals.length ? Math.max(...absVals) : 1;
		const scale = d3.scaleLinear()
			.domain([min, max])
			.range([1, 6]);

		// Draw filtered edges
		filteredEdges.forEach(({ x1, y1, x2, y2, nigValue }) => {
			// Calculate positions
			const x1Pos = margin.left + x1 * gridSize + gridSize / 2; // Center horizontally
			const y1Pos = margin.top + y1 * gridSize + gridSize / 2; // Top of the shape
			const x2Pos = margin.left + x2 * gridSize + gridSize / 2; // Center horizontally
			const y2Pos = margin.top + y2 * gridSize + gridSize / 2; // Bottom of the shape

			edgesGroup.append("line")
				.attr("x1", x1Pos)
				.attr("y1", y1Pos)
				.attr("x2", x2Pos)
				.attr("y2", y2Pos)
				.attr("stroke", "black")
				.attr("stroke-width", scale(Math.abs(nigValue)))
				.attr("stroke-opacity", 0.8)
				.attr("stroke-linecap", "round")
				.attr("class", "edge-line");
		});
	}

	function redrawEdges() {
		const selection = selection$.getValue();
		if (selection && selection.edges) {
			drawEdges(selection.edges);
		} else {
			// Clear edges if no edges are available
			if (edgesGroup) {
				edgesGroup.selectAll(".edge-line").remove();
			}
		}
	}

	const gridSize = 80; // Fixed grid size
	const margin = { top: 40, right: 20, bottom: 60, left: 100 }; // Adjust margins

	onMount(() => {
		// Set fixed grid size and margins

		const numLayers = 24; // Total number of layers (12 FFN + 12 ATTN)
		const svgWidth = 800; // Fixed width
		const svgHeight = margin.top + margin.bottom + numLayers * gridSize; // Dynamically calculate height

		svg = d3.select("#architecture-grid")
			.append("svg")
			.attr("width", "100%") // Make SVG responsive
			.attr("height", svgHeight)
			.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
			.style("max-width", "100%")
			.style("height", "auto");

		// Create a group for edges to ensure they are drawn behind
		edgesGroup = svg.append("g").attr("class", "edges-group");

		// Add text at the top of the grid
		svg.append("text")
			.attr("x", svgWidth / 2)
			.attr("y", margin.top / 2)
			.attr("text-anchor", "middle")
			.style("font-size", "16px")
			.style("font-weight", "bold")
			.text("Architecture Grid: Click on shapes to select layers and token types");

		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const layers = Array.from({ length: numLayers }, (_, i) => numLayers - 1 - i); // Reverse the layer order

		// Subscribe to selection$ for redraw events
		selection$.subscribe(({ redraw, edges }) => {
			if (redraw && edges && edges.length > 0) {
				drawEdges(edges); // Redraw edges when triggered
			} else {
				console.warn("No edges to draw or redraw flag not set:", { redraw, edges });
				if (edgesGroup) {
					edgesGroup.selectAll(".edge-line").remove(); // Clear edges if no edges are available
				}
			}
		});

		// Add circles for ATTN layers and squares for FFN layers
		layers.forEach((layer, layerIndex) => {
			tokenTypes.forEach((tokenType, tokenIndex) => {
				if (layer % 2 === 0) {
					// ATTN layers (circles)
					svg.append("circle")
						.attr("cx", margin.left + tokenIndex * gridSize + gridSize / 2) // Center circles horizontally
						.attr("cy", margin.top + layerIndex * gridSize + gridSize / 2) // Center circles vertically
						.attr("r", gridSize / 4) // Fixed circle radius
						.attr("fill", "gray")
						.attr("stroke", "white")
						.attr("stroke-opacity", 0.8)
						.attr("stroke-width", 3)
						.attr("class", "attn-circle")
						.style("cursor", "pointer") // Add hand cursor for clickable circles
						.on("mouseover", function () {
							d3.select(this)
								.transition()
								.duration(200)
								.attr("r", gridSize / 3); // Slightly increase radius
						})
						.on("mouseout", function () {
							d3.select(this)
								.transition()
								.duration(200)
								.attr("r", gridSize / 4); // Reset radius
						})
						.on("click", () => {
							handleClick(Math.floor(layer / 2), 'ATTN', tokenType);
							redrawEdges(); // Ensure edges persist after selection
						});
				} else {
					// FFN layers (squares)
					svg.append("rect")
						.attr("x", margin.left + tokenIndex * gridSize + (gridSize - gridSize / 2) / 2) // Center squares horizontally
						.attr("y", margin.top + layerIndex * gridSize + (gridSize - gridSize / 2) / 2) // Center squares vertically
						.attr("width", gridSize / 2) // Fixed square size
						.attr("height", gridSize / 2) // Fixed square size
						.attr("fill", "darkgray")
						.attr("stroke", "white")
						.attr("stroke-width", 3)
						.attr("class", "ffn-square")
						.style("cursor", "pointer") // Add hand cursor for clickable squares
						.each(function () {
							// Store the original position
							const rect = d3.select(this);
							rect.attr("data-original-x", rect.attr("x"));
							rect.attr("data-original-y", rect.attr("y"));
						})
						.on("mouseover", function () {
							const rect = d3.select(this);
							const originalX = parseFloat(rect.attr("data-original-x"));
							const originalY = parseFloat(rect.attr("data-original-y"));
							const increase = (gridSize / 1.5 - gridSize / 2) / 2; // Symmetrical adjustment
							rect.transition()
								.duration(200)
								.attr("width", gridSize / 1.5) // Slightly increase size
								.attr("height", gridSize / 1.5)
								.attr("x", originalX - increase) // Adjust position symmetrically
								.attr("y", originalY - increase);
						})
						.on("mouseout", function () {
							const rect = d3.select(this);
							const originalX = rect.attr("data-original-x");
							const originalY = rect.attr("data-original-y");
							rect.transition()
								.duration(200)
								.attr("width", gridSize / 2) // Reset size
								.attr("height", gridSize / 2)
								.attr("x", originalX) // Reset position
								.attr("y", originalY);
						})
						.on("click", () => {
							handleClick(Math.floor(layer / 2), 'FFN', tokenType);
							redrawEdges(); // Ensure edges persist after selection
						});
				}
			});
		});

		// Add token type labels at the bottom
		svg.selectAll(".token-label")
			.data(tokenTypes)
			.enter()
			.append("text")
			.attr("x", (_, i) => margin.left + i * gridSize + gridSize / 2)
			.attr("y", svgHeight - margin.bottom + 20) // Position labels at the bottom
			.attr("text-anchor", "middle")
			.text(d => d)
			.attr("class", "token-label");

		// Add layer labels centered on shapes
		svg.selectAll(".layer-label")
			.data(layers)
			.enter()
			.append("text")
			.attr("x", margin.left - 50) // Adjusted x position for better alignment
			.attr("y", (_, i) => margin.top + i * gridSize + gridSize / 2 + 5) // Centered vertically on shapes
			.attr("text-anchor", "middle")
			.text(d => `L${Math.floor(d / 2)} ${d % 2 === 0 ? 'ATTN' : 'FFN'}`) // Attention first, then FFN
			.attr("class", "layer-label");
	});
</script>

<div>
	<div id="architecture-grid" style="width: 100%; height: 100%;"></div>
</div>

<style>
</style>

