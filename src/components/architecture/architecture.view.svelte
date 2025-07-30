<script>
	import { combineLatest } from 'rxjs';
	import { onMount, onDestroy } from 'svelte';
	import * as d3 from 'd3';


	export const options = {};
	export let selection$;
	export let threshold$;
	export let edges$;
	//export let error$;


	// Adjustable vertical shift for everything below the text+bar
	const yShift = 48;
	const barHeight = 16; // Define barHeight here for use in drawEdges

	let svg;
	let edgesGroup;
	let errorSub; // Declare errorSub variable

	// Handle click events for FFN and ATTN layers
	function handleClick(layer, type, tokenType) {
		console.log(`Clicked - Layer: ${layer}, Type: ${type}, Token Type: ${tokenType}`);
		selection$.next({ layer, type, tokenType });
	}

	function drawEdges(edges, threshold) {
		if (!edgesGroup) {
			console.error("Edges group is not defined. Ensure onMount has initialized the SVG element.");
			return;
		}

		edgesGroup.selectAll(".edge-line").remove();

		// Create a scale for edge thickness based on proportion (0 to 1)
		const thicknessScale = d3.scaleLinear()
			.domain([0, 1]) // proportion range
			.range([0.5, 4]); // thickness range

		const numLayers = 24;
		const barY = margin.top + 24; // bar is now below the text

		edges.forEach(({ x1, y1, x2, y2, nigValue, layer, count, total, srcToken, tgtToken, globalCutoff }) => {
			const x1Pos = margin.left + x1 * gridSize + gridSize / 2;
			let y1Pos = margin.top + y1 * gridSize + gridSize / 2 + yShift;
			const x2Pos = margin.left + x2 * gridSize + gridSize / 2;
			let y2Pos = margin.top + y2 * gridSize + gridSize / 2 + yShift;

			// If y2 is negative (above the grid), connect to the top bar
			if (y2 < 0) {
				y2Pos = barY + barHeight / 2; // Connect to middle of the bar
			}

			// Only draw edge if proportion > 0
			if (nigValue > 0) {
				const line = edgesGroup.append("line")
					.attr("x1", x1Pos)
					.attr("y1", y1Pos)
					.attr("x2", x2Pos)
					.attr("y2", y2Pos)
					.attr("stroke", "black")
					.attr("stroke-width", thicknessScale(nigValue)) // Use proportion for thickness
					.attr("stroke-opacity", 0.8)
					.attr("stroke-linecap", "round")
					.attr("class", "edge-line");

				const layerNum = (() => {
					if (typeof layer === "string") {
						const m = layer.match(/layer\.(\d+)/);
						if (m) return m[1];
					}
					return layer ?? '';
				})();
				
				// Determine if this is ATTN or FFN
				const componentType = layer?.includes('attention') ? 'ATTN' : 'FFN';
				
				// Enhanced tooltip with count and layer information
				line.append("title").text(
					`Layer ${layerNum} ${componentType}\n` +
					`${srcToken} → ${tgtToken}\n` +
					`Count: ${count}/${total} (${(nigValue * 100).toFixed(1)}%)\n` +
					`Global threshold: ${(threshold * 100).toFixed(1)}%\n` +
					`Global cutoff: ${globalCutoff ? globalCutoff.toFixed(6) : 'N/A'}`
				);
			}
		});
	}

	const gridSize = 80;
	const margin = { top: 40, right: 20, bottom: 60, left: 100 };

	onMount(() => {
		// Set fixed grid size and margins

		const numLayers = 24;
		const svgWidth = 800;
		const svgHeight = margin.top + margin.bottom + numLayers * gridSize + yShift;

		svg = d3.select("#architecture-grid")
			.append("svg")
			.attr("width", "100%")
			.attr("height", svgHeight)
			.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
			.style("max-width", "100%")
			.style("height", "auto");

		// Add text at the top of the grid
		const textY = margin.top / 2 + 8;
		const errorText = svg.append("text")
			.attr("x", svgWidth- svgWidth / 4)
			.attr("y", textY)
			.attr("text-anchor", "right")
			.style("font-size", "16px")
			.style("font-weight", "bold")
			.text("NIG Error Rate: NA");

		// Subscribe to error$ to update the text - commented out for now
		// errorSub = error$.subscribe(error => {
		// 	if (error !== null && error !== undefined) {
		// 		errorText.text(`NIG Error Rate: ${error.toFixed(6)}`);
		// 	} else {
		// 		errorText.text("NIG Error Rate: NA");
		// 	}
		// });

		// Add hollow bar for final edges to connect into, aligned with token positions, below the text
		const barY = margin.top + 24;
		const barStroke = 2;
		const barX = margin.left ; // Center the bar with respect to the first token
		const barWidth = gridSize * 5 ;

		edgesGroup = svg.append("g").attr("class", "edges-group");

		svg.append("rect")
			.attr("x", barX)
			.attr("y", barY)
			.attr("width", barWidth)
			.attr("height", barHeight)
			.attr("fill", "none")
			.attr("stroke", "#888")
			.attr("stroke-width", barStroke)
			.attr("rx", 6)
			.attr("ry", 6)
			.attr("class", "top-bar");


		const sub = combineLatest([edges$, threshold$]).subscribe(
		([edges, threshold]) => {
			if (edges && edges.length > 0) {
				drawEdges(edges, threshold);
			} else {
				// Clear edges if no data
				if (edgesGroup) {
					edgesGroup.selectAll(".edge-line").remove();
				}
			}
		}
		);

  		onDestroy(() => {
			sub.unsubscribe();
			if (errorSub) errorSub.unsubscribe();
		});
		
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const layers = Array.from({ length: numLayers }, (_, i) => numLayers - 1 - i);


		// Add circles for ATTN layers and squares for FFN layers
		layers.forEach((layer, layerIndex) => {
			tokenTypes.forEach((tokenType, tokenIndex) => {
				if (layer % 2 === 0) {
					svg.append("circle")
						.attr("cx", margin.left + tokenIndex * gridSize + gridSize / 2)
						.attr("cy", margin.top + layerIndex * gridSize + gridSize / 2 + yShift)
						.attr("r", gridSize / 4)
						.attr("fill", "gray")
						.attr("stroke", "white")
						.attr("stroke-opacity", 0.8)
						.attr("stroke-width", 3)
						.attr("class", "attn-circle")
						.style("cursor", "pointer")
						.on("mouseover", function () {
							d3.select(this)
								.transition()
								.duration(200)
								.attr("r", gridSize / 3);
						})
						.on("mouseout", function () {
							d3.select(this)
								.transition()
								.duration(200)
								.attr("r", gridSize / 4);
						})
						.on("click", () => {
							handleClick(Math.floor(layer / 2), 'ATTN', tokenType);
						});
				} else {
					svg.append("rect")
						.attr("x", margin.left + tokenIndex * gridSize + (gridSize - gridSize / 2) / 2)
						.attr("y", margin.top + layerIndex * gridSize + (gridSize - gridSize / 2) / 2 + yShift)
						.attr("width", gridSize / 2)
						.attr("height", gridSize / 2)
						.attr("fill", "darkgray")
						.attr("stroke", "white")
						.attr("stroke-width", 3)
						.attr("class", "ffn-square")
						.style("cursor", "pointer")
						.each(function () {
							const rect = d3.select(this);
							rect.attr("data-original-x", rect.attr("x"));
							rect.attr("data-original-y", rect.attr("y"));
						})
						.on("mouseover", function () {
							const rect = d3.select(this);
							const originalX = parseFloat(rect.attr("data-original-x"));
							const originalY = parseFloat(rect.attr("data-original-y"));
							const increase = (gridSize / 1.5 - gridSize / 2) / 2;
							rect.transition()
								.duration(200)
								.attr("width", gridSize / 1.5)
								.attr("height", gridSize / 1.5)
								.attr("x", originalX - increase)
								.attr("y", originalY - increase);
						})
						.on("mouseout", function () {
							const rect = d3.select(this);
							const originalX = rect.attr("data-original-x");
							const originalY = rect.attr("data-original-y");
							rect.transition()
								.duration(200)
								.attr("width", gridSize / 2)
								.attr("height", gridSize / 2)
								.attr("x", originalX)
								.attr("y", originalY);
						})
						.on("click", () => {
							handleClick(Math.floor(layer / 2), 'FFN', tokenType);
						});
				}
			});
		});

		// Add token labels at the bottom
		svg.selectAll(".token-label-bottom")
			.data(tokenTypes)
			.enter()
			.append("text")
			.attr("x", (_, i) => margin.left + i * gridSize + gridSize / 2)
			.attr("y", svgHeight - margin.bottom + 20)
			.attr("text-anchor", "middle")
			.text(d => d)
			.attr("class", "token-label-bottom");

		// Add token labels at the top
		svg.selectAll(".token-label-top")
			.data(tokenTypes)
			.enter()
			.append("text")
			.attr("x", (_, i) => margin.left + i * gridSize + gridSize / 2)
			.attr("y", barY - 5) // Position above the top bar
			.attr("text-anchor", "middle")
			.text(d => d)
			.attr("class", "token-label-top");

		svg.selectAll(".layer-label")
			.data(layers)
			.enter()
			.append("text")
			.attr("x", margin.left - 50)
			.attr("y", (_, i) => margin.top + i * gridSize + gridSize / 2 + 5 + yShift)
			.attr("text-anchor", "middle")
			.text(d => `L${Math.floor(d / 2)} ${d % 2 === 0 ? 'ATTN' : 'FFN'}`)
			.attr("class", "layer-label");
	});
</script>

<div>
	<div id="architecture-grid" style="width: 100%; height: 100%;"></div>
</div>

<style>
</style>

