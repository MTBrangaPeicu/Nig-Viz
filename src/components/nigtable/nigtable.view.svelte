<svelte:options />

<script>
	import { onDestroy, afterUpdate } from 'svelte';
	import * as d3 from 'd3';

	let options = {};
	let unsubscribe;

	// Subscribe to the reactive options store
	export let options$;
	if (options$) {
		unsubscribe = options$.subscribe((value) => {
			options = value;
			if (options.values) {
				drawViolinPlot(options.values);
			}
		});
	}

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});

	// Helper function to calculate shape
	function getShape(values) {
		if (Array.isArray(values)) {
			if (Array.isArray(values[0])) {
				return [values[0].length, values.length]; // 2D array shape
			}
			return [values.length]; // 1D array shape
		}
		return "NA"; // Not an array
	}

	// Function to draw the violin plot
	function drawViolinPlot(data) {
		// Clear existing SVG
		d3.select("#violin-plot").selectAll("*").remove();

		// Set dimensions and margins
		const margin = { top: 10, right: 30, bottom: 30, left: 40 },
			width = 460 - margin.left - margin.right,
			height = 400 - margin.top - margin.bottom;

		// Append the SVG object
		const svg = d3
			.select("#violin-plot")
			.append("svg")
			.attr("width", width + margin.left + margin.right)
			.attr("height", height + margin.top + margin.bottom)
			.append("g")
			.attr("transform", `translate(${margin.left},${margin.top})`);

		// Prepare data for the violin plot
		const tokenTypes = Object.keys(data); // Assume data is an object with token types as keys
		const flattenedData = tokenTypes.flatMap((key) => data[key].flat());
		const y = d3.scaleLinear().domain(d3.extent(flattenedData)).range([height, 0]);
		svg.append("g").call(d3.axisLeft(y));

		const x = d3
			.scaleBand()
			.range([0, width])
			.domain(tokenTypes)
			.padding(0.05);
		svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));

		tokenTypes.forEach((token) => {
			const tokenData = data[token].flat();
			const histogram = d3
				.histogram()
				.domain(y.domain())
				.thresholds(y.ticks(20))
				.value((d) => d);

			const bins = histogram(tokenData);

			const maxNum = d3.max(bins, (d) => d.length);
			const xNum = d3.scaleLinear().range([0, x.bandwidth()]).domain([-maxNum, maxNum]);

			// Add the violin shape
			svg
				.append("path")
				.datum(bins)
				.style("stroke", "none")
				.style("fill", "grey")
				.attr(
					"d",
					d3
						.area()
						.x0(xNum(0))
						.x1((d) => xNum(d.length))
						.y((d) => y(d.x0))
						.curve(d3.curveCatmullRom)
				)
				.attr("transform", `translate(${x(token)},0)`);

			// Add the box plot
			const q1 = d3.quantile(tokenData.sort(d3.ascending), 0.25);
			const median = d3.quantile(tokenData.sort(d3.ascending), 0.5);
			const q3 = d3.quantile(tokenData.sort(d3.ascending), 0.75);
			const interQuantileRange = q3 - q1;
			const min = Math.max(d3.min(tokenData), q1 - 1.5 * interQuantileRange);
			const max = Math.min(d3.max(tokenData), q3 + 1.5 * interQuantileRange);

			svg
				.append("line")
				.attr("x1", x(token) + x.bandwidth() / 2)
				.attr("x2", x(token) + x.bandwidth() / 2)
				.attr("y1", y(min))
				.attr("y2", y(max))
				.attr("stroke", "black");

			svg
				.append("rect")
				.attr("x", x(token) + x.bandwidth() / 2 - 10)
				.attr("y", y(q3))
				.attr("height", y(q1) - y(q3))
				.attr("width", 20)
				.attr("stroke", "black")
				.style("fill", "#69b3a2");

			svg
				.append("line")
				.attr("x1", x(token) + x.bandwidth() / 2 - 10)
				.attr("x2", x(token) + x.bandwidth() / 2 + 10)
				.attr("y1", y(median))
				.attr("y2", y(median))
				.attr("stroke", "black");
		});
	}
</script>

<div>
	<h3 class="my-color">Layer: {options.layer || "None selected"} Shape: {JSON.stringify(getShape(options.values))}</h3>
	<p><strong>Values:</strong> {JSON.stringify(options.values || "No values available")}</p>
	<div id="violin-plot"></div>
</div>

<style>
	.my-color {
		color: seagreen;
	}
</style>