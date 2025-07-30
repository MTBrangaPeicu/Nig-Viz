import { Component } from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';
import View from './architecture.view.svelte';
import { mount, unmount } from 'svelte';

export class Architecture extends Component {
	constructor(options = {}) {
		super();
		this.title = 'architecture [custom component 🤖]';
		this.options = options;
		this.$selection = new BehaviorSubject({ layer: null, tokenType: null, range: null });
		this.$threshold = new BehaviorSubject(0.05);
		this.subsetBData$ = new BehaviorSubject(null); // Store subset_b data for counting
		this.edges$ = new BehaviorSubject([]); // Store computed edges for visualization
		this.$error = new BehaviorSubject(null); // Store NIG error rate
	}

	updateEdges(subsetB, error = null) {
		// Store the subset_b data for real-time threshold calculations in frontend
		this.subsetBData$.next(subsetB);
		// Store the error rate - commented out for now, keeping as NA
		// this.$error.next(error);
		// Trigger edge computation with current threshold
		this.computeEdgesFromSubsetB();
	}

	updateThreshold(newThreshold) {
		this.$threshold.next(newThreshold);
		// Recompute edges with new threshold
		this.computeEdgesFromSubsetB();
	}

	computeEdgesFromSubsetB() {
		const subsetB = this.subsetBData$.getValue();
		const threshold = this.$threshold.getValue();
		
		if (!subsetB || threshold === null) {
			this.edges$.next([]);
			return;
		}

		// STEP 1: Collect ALL values across the entire model to determine global cutoff
		console.log(`---- COLLECTING ALL VALUES FOR GLOBAL THRESHOLD (${threshold * 100}%) ----`);
		const allModelValues = [];
		
		Object.entries(subsetB).forEach(([layerKey, layerData]) => {
			const match = layerKey.match(/encoder\.layer\.(\d+)\.(attention|intermediate)/);
			if (!match) return;
			
			const isAttention = match[2] === 'attention';
			
			if (isAttention && Array.isArray(layerData) && layerData[0] && Array.isArray(layerData[0]) && Array.isArray(layerData[0][0])) {
				// Attention layer: [12, 5, 5] - collect all attention head values
				for (let head = 0; head < layerData.length; head++) {
					for (let srcToken = 0; srcToken < 5; srcToken++) {
						for (let tgtToken = 0; tgtToken < 5; tgtToken++) {
							if (layerData[head] && layerData[head][tgtToken] && layerData[head][tgtToken][srcToken] !== undefined) {
								const value = Math.abs(layerData[head][tgtToken][srcToken]);
								allModelValues.push(value);
							}
						}
					}
				}
			} else if (!isAttention && Array.isArray(layerData)) {
				// FFN layer: [5, neurons] - collect all neuron values
				for (let tokenType = 0; tokenType < 5; tokenType++) {
					if (layerData[tokenType] && Array.isArray(layerData[tokenType])) {
						const values = layerData[tokenType].map(v => Math.abs(v));
						allModelValues.push(...values);
					}
				}
			}
		});
		
		// STEP 2: Sort all values and determine the global cutoff threshold
		allModelValues.sort((a, b) => b - a);
		
		let globalCutoff = 0;
		if (threshold > 0 && allModelValues.length > 0) {
			const cutoffIndex = Math.max(0, Math.floor(allModelValues.length * threshold) - 1);
			globalCutoff = allModelValues[cutoffIndex];
		}
		
		console.log(`GLOBAL THRESHOLD STATS:`);
		console.log(`  Total values in model: ${allModelValues.length}`);
		console.log(`  Value range: ${allModelValues[allModelValues.length-1].toFixed(6)} to ${allModelValues[0].toFixed(6)}`);
		console.log(`  Threshold: ${threshold * 100}% = ${Math.floor(allModelValues.length * threshold)} values`);
		console.log(`  Global cutoff value: ${globalCutoff.toFixed(6)}`);
		console.log(`  Values above cutoff: ${allModelValues.filter(v => v >= globalCutoff).length}`);
		
		// STEP 3: Now compute edges using the single global cutoff for all connections
		console.log(`---- COMPUTING EDGES USING GLOBAL CUTOFF ----`);
		const edges = [];
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const totalLayers = 12;

		Object.entries(subsetB).forEach(([layerKey, layerData]) => {
			const match = layerKey.match(/encoder\.layer\.(\d+)\.(attention|intermediate)/);
			if (!match) return;

			const layerIndex = parseInt(match[1]);
			const isAttention = match[2] === 'attention';

			// Compute vertical position to match the view's layout
			// The view uses: layers = [23, 22, 21, ..., 1, 0] where 23 is at top (layerIndex=0)
			// We want: L0 ATTN at bottom, L11 FFN at top
			// So: L0 ATTN = visual position 23, L0 FFN = 22, L1 ATTN = 21, etc.
			const totalVisualLayers = 24; // 12 layers * 2 (ATTN + FFN each)
			const visualPosition = totalVisualLayers - 1 - (layerIndex * 2 + (isAttention ? 0 : 1));

			if (isAttention && Array.isArray(layerData) && layerData[0] && Array.isArray(layerData[0]) && Array.isArray(layerData[0][0])) {
				// Attention layer: [12, 5, 5] - create edges from ATTN to FFN of same layer
				for (let srcToken = 0; srcToken < 5; srcToken++) {
					for (let tgtToken = 0; tgtToken < 5; tgtToken++) {
						// Get values for all 12 heads for this token-to-token connection
						const headValues = [];
						for (let head = 0; head < layerData.length; head++) {
							if (layerData[head] && layerData[head][tgtToken] && layerData[head][tgtToken][srcToken] !== undefined) {
								headValues.push(Math.abs(layerData[head][tgtToken][srcToken]));
							}
						}
						
						if (headValues.length > 0) {
							// Count how many heads exceed the GLOBAL cutoff (not local percentage)
							const count = threshold > 0 ? headValues.filter(v => v >= globalCutoff).length : 0;
							const proportion = count / headValues.length;
							
							// Debug logging 
							console.log(`${layerKey} (ATTN): ${tokenTypes[srcToken]} → ${tokenTypes[tgtToken]}`);
							console.log(`  Head values: [${headValues.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...] (${headValues.length} total)`);
							console.log(`  Global cutoff: ${globalCutoff.toFixed(6)}, Count above: ${count}/${headValues.length}, Proportion: ${proportion.toFixed(3)}`);
							
							// Only create edge if some heads exceed the global threshold
							if (proportion > 0) {
								edges.push({
									layer: layerKey,
									srcToken: tokenTypes[srcToken],
									tgtToken: tokenTypes[tgtToken],
									nigValue: proportion, // Use proportion for thickness
									count: count,
									total: headValues.length,
									globalCutoff: globalCutoff,
									x1: srcToken,
									y1: visualPosition,   // ATTN (circle)
									x2: tgtToken,
									y2: visualPosition - 1, // FFN (square) of same layer (above ATTN)
								});
							}
						}
					}
				}
			} else if (!isAttention && Array.isArray(layerData)) {
				// FFN layer: [5, neurons] - create edges from FFN to next layer's ATTN
				for (let tokenType = 0; tokenType < 5; tokenType++) {
					if (layerData[tokenType] && Array.isArray(layerData[tokenType])) {
						const neuronValues = layerData[tokenType].map(v => Math.abs(v));
						if (neuronValues.length > 0) {
							// Count how many neurons exceed the GLOBAL cutoff (not local percentage)
							const count = threshold > 0 ? neuronValues.filter(v => v >= globalCutoff).length : 0;
							const proportion = count / neuronValues.length;
							
							// Debug logging
							console.log(`${layerKey} (FFN): ${tokenTypes[tokenType]}`);
							console.log(`  Neuron values: [${neuronValues.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...] (${neuronValues.length} total)`);
							console.log(`  Global cutoff: ${globalCutoff.toFixed(6)}, Count above: ${count}/${neuronValues.length}, Proportion: ${proportion.toFixed(3)}`);
							
							// Only create edge if some neurons exceed the global threshold
							if (proportion > 0) {
								if (layerIndex < totalLayers - 1) {
									// Connect to next layer's ATTN
									edges.push({
										layer: layerKey,
										srcToken: tokenTypes[tokenType],
										tgtToken: tokenTypes[tokenType], // Same token type for FFN-to-ATTN
										nigValue: proportion, // Use proportion for thickness
										count: count,
										total: neuronValues.length,
										globalCutoff: globalCutoff,
										x1: tokenType,
										y1: visualPosition,     // FFN (square)
										x2: tokenType,
										y2: visualPosition - 1, // ATTN of next layer (above current FFN)
									});
								} else {
									// L11 FFN - connect to the bar (y2 = -1 will be handled in view)
									edges.push({
										layer: layerKey,
										srcToken: tokenTypes[tokenType],
										tgtToken: tokenTypes[tokenType], // Same token type
										nigValue: proportion, // Use proportion for thickness
										count: count,
										total: neuronValues.length,
										globalCutoff: globalCutoff,
										x1: tokenType,
										y1: visualPosition,     // L11 FFN (square)
										x2: tokenType,
										y2: -1, // Signal to connect to bar
									});
								}
							}
						}
					}
				}
			}
		});

		// Summary
		console.log(`\nFINAL EDGE SUMMARY:`);
		console.log(`  Total edges created: ${edges.length}`);
		console.log(`  Using global threshold: ${threshold * 100}% (cutoff: ${globalCutoff.toFixed(6)})`);

		this.edges$.next(edges);
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				title: this.title,
				options: this.options,
				selection$: this.$selection,
				threshold$: this.$threshold,
				subsetBData$: this.subsetBData$,
				edges$: this.edges$,
				error$: this.$error
			},
		});
		return () => unmount(app);
	}
}
