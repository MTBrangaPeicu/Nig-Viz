import { Component } from '@marcellejs/core';
import { BehaviorSubject, skip } from 'rxjs';
import View from './architecture.view.svelte';
import { mount, unmount } from 'svelte';

export class Architecture extends Component {
	constructor(options = {}) {
		super();
		this.title = 'architecture [custom component 🤖]';
		this.options = options;
		// Two-step selection model: { source: {layer,type,tokenType}, target: {layer/type/tokenType|TOP}|null }
		this.$selection = new BehaviorSubject({ source: null, target: null });
		this.$threshold = new BehaviorSubject(0.05);
		this.subsetBData$ = new BehaviorSubject(null); // Store subset_b data for counting
		this.edges$ = new BehaviorSubject([]); // Store computed edges for visualization
		this.$error = new BehaviorSubject(null); // Store NIG error rate
		this.pruningState$ = new BehaviorSubject({ enabled: false, rules: [], targets: [], edges: [], thresholds: {} }); // Store pruning state
		this.pruningCutoffs$ = new BehaviorSubject({ attention: 0, ffn: 0 }); // Store computed pruning cutoffs
		// Expose the global cutoff used to draw edges (computed from global absolute values pool)
		this.globalCutoff$ = new BehaviorSubject(0);
		// New: emit clicks on ATTN layer labels for token-by-token heatmap requests
		this.labelClick$ = new BehaviorSubject(null);
		// Stream to control whether to use absolute values or signed values
		this.absoluteValues$ = new BehaviorSubject(true);
		// Stream to control whether to color nodes by their max values
		this.colorNodesEnabled$ = new BehaviorSubject(false);
		// Store node color data (max values per node for coloring)
		this.nodeColorData$ = new BehaviorSubject(null);
		// Store manually pruned edges/nodes for interactive pruning
		this.prunedEdges$ = new BehaviorSubject(new Set());
		this.prunedNodes$ = new BehaviorSubject(new Set());
		// Stream to enable/disable pruning cursor mode
		this.pruningCursorEnabled$ = new BehaviorSubject(false);
		// Stream to enable/disable conditional NIG cursor mode
		this.conditionalCursorEnabled$ = new BehaviorSubject(false);
		// Stream to emit neuron clicks for conditional NIG target selection
		// Emits: { layerIdx: number, neuronType: 'attention' | 'ffn', neuronIdx: number }
		this.conditionalNigTarget$ = new BehaviorSubject(null);
		// Stream to track conditional mode and target layer for greying out
		// Emits: { isConditional: boolean, targetLayerIdx: number | null, targetNeuronType: 'attention' | 'ffn' | null }
		this.conditionalModeState$ = new BehaviorSubject({ isConditional: false, targetLayerIdx: null, targetNeuronType: null });
		// Stream for previewing a pruning configuration on hover (from saved prunes list)
		// Emits: { rules: [], targets: [], edges: [], thresholds: {} } | null
		this.prunePreview$ = new BehaviorSubject(null);
		// Stream for hover preview (node currently being hovered)
		// Emits: { layer: number, type: 'ATTN'|'FFN'|'TOP', tokenType: string } | null
		this.hover$ = new BehaviorSubject(null);
		
		// Subscribe to pruning state changes to recompute edges when thresholds change
		// Skip the first value (initial state) to avoid unnecessary computation on startup
		this.pruningState$.pipe(skip(1)).subscribe((state) => {
			console.log('[Architecture] Pruning state changed, recomputing edges:', state);
			// Only recompute if we have data
			if (this.subsetBData$.getValue()) {
				this.computeEdgesFromSubsetB();
			}
		});
	}

	updateEdges(subsetB, error = null) {
		// Store the subset_b data for real-time threshold calculations in frontend
		this.subsetBData$.next(subsetB);
		// Store the error rate
		//this.$error.next(error);
		// Trigger edge computation with current threshold
		this.computeEdgesFromSubsetB();
		// Update node colors with new data
		this.updateNodeColors(subsetB);
	}

	updateNodeColors(subsetB) {
		if (!subsetB) {
			this.nodeColorData$.next(null);
			return;
		}

		const useAbsoluteValues = this.absoluteValues$.getValue();
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		
		// Collect ALL values first to compute proper extent, then find max per node
		// This ensures we capture the true range including negative values
		const allValues = [];
		const nodeMaxValues = {};
		
		Object.entries(subsetB).forEach(([layerKey, layerData]) => {
			const match = layerKey.match(/encoder\.layer\.(\d+)\.(attention|intermediate)/);
			if (!match) return;
			
			const layerIndex = parseInt(match[1]);
			const isAttention = match[2] === 'attention';
			const layerType = isAttention ? 'ATTN' : 'FFN';
			
			if (isAttention && Array.isArray(layerData) && layerData[0] && Array.isArray(layerData[0]) && Array.isArray(layerData[0][0])) {
				// Attention layer: [12 heads, 5 target tokens, 5 source tokens]
				for (let srcToken = 0; srcToken < 5; srcToken++) {
					const tokenType = tokenTypes[srcToken];
					const nodeKey = `L${layerIndex}_${layerType}_${tokenType}`;
					let maxVal = -Infinity;
					
					// Collect all values and find the maximum (skip NaN values from conditional NIG)
					for (let head = 0; head < layerData.length; head++) {
						for (let tgtToken = 0; tgtToken < 5; tgtToken++) {
							if (layerData[head] && layerData[head][tgtToken] && layerData[head][tgtToken][srcToken] !== undefined) {
								const rawValue = layerData[head][tgtToken][srcToken];
								// Skip NaN values (used by conditional NIG to mask non-target neurons)
								if (!Number.isFinite(rawValue)) continue;
								allValues.push(rawValue); // Keep original signed value for extent
								
								// Find max value (absolute if mode enabled, otherwise signed)
								if (useAbsoluteValues) {
									maxVal = Math.max(maxVal, Math.abs(rawValue));
								} else {
									maxVal = Math.max(maxVal, rawValue);
								}
							}
						}
					}
					
					if (maxVal !== -Infinity) {
						nodeMaxValues[nodeKey] = maxVal;
					}
				}
			} else if (!isAttention && Array.isArray(layerData)) {
				// FFN layer: [5 token types, N neurons each]
				for (let tokenIdx = 0; tokenIdx < 5; tokenIdx++) {
					const tokenType = tokenTypes[tokenIdx];
					const nodeKey = `L${layerIndex}_${layerType}_${tokenType}`;
					
					if (layerData[tokenIdx] && Array.isArray(layerData[tokenIdx])) {
						let maxVal = -Infinity;
						
						// Collect all neuron values and find the maximum (skip NaN values from conditional NIG)
						layerData[tokenIdx].forEach(rawValue => {
							// Skip NaN values (used by conditional NIG to mask non-target neurons)
							if (!Number.isFinite(rawValue)) return;
							allValues.push(rawValue);
							
							// Find max value (absolute if mode enabled, otherwise signed)
							if (useAbsoluteValues) {
								maxVal = Math.max(maxVal, Math.abs(rawValue));
							} else {
								maxVal = Math.max(maxVal, rawValue);
							}
						});
						
						if (maxVal !== -Infinity) {
							nodeMaxValues[nodeKey] = maxVal;
						}
					}
				}
			}
		});
		
		// Compute extent from ALL raw values (not just node maxes) to match heatmap behavior
		if (allValues.length > 0) {
			let globalMin, globalMax;
			
			if (useAbsoluteValues) {
				// When using absolute values, extent is [0, max]
				globalMin = 0;
				globalMax = Math.max(...allValues.map(Math.abs));
			} else {
				// When using signed values, extent includes negative values
				globalMin = Math.min(...allValues);
				globalMax = Math.max(...allValues);
			}
			
			this.nodeColorData$.next({
				nodeMaxValues,
				extent: [globalMin, globalMax]
			});
			
			console.log('[Architecture Colors] Updated node color data:', {
				nodeCount: Object.keys(nodeMaxValues).length,
				extent: [globalMin, globalMax],
				useAbsoluteValues,
				sampleValues: Object.entries(nodeMaxValues).slice(0, 3)
			});
		} else {
			this.nodeColorData$.next(null);
		}
	}

	updatePruningState(pruningOptions) {
		// Update pruning state to affect visualization
		this.pruningState$.next({
			enabled: pruningOptions.enabled,
			rules: pruningOptions.pruningRules || [],
			targets: pruningOptions.pruningTargets || [],
			edges: pruningOptions.pruningEdges || [],
			thresholds: {
				attention: pruningOptions.attentionThreshold || 0.0,
				ffn: pruningOptions.ffnThreshold || 0.0
			}
		});
		// Recompute edges with new pruning state
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
		const pruningState = this.pruningState$.getValue();
		const useAbsoluteValues = this.absoluteValues$.getValue();
		
		if (!subsetB || threshold === null) {
			this.edges$.next([]);
			return;
		}

		// STEP 1: Collect ALL values across the entire model to determine global cutoff
		console.log(`---- COLLECTING ALL VALUES FOR GLOBAL THRESHOLD (${threshold * 100}%) ----`);
		console.log(`Using ${useAbsoluteValues ? 'ABSOLUTE' : 'SIGNED'} values for edge computation`);
		const allModelValues = [];
		const allAttentionValues = [];
		const allFFNValues = [];
		
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
								const rawValue = layerData[head][tgtToken][srcToken];
								// Skip NaN values (used by conditional NIG to mask non-target neurons)
								if (!Number.isFinite(rawValue)) continue;
								const value = useAbsoluteValues ? Math.abs(rawValue) : rawValue;
								allModelValues.push(value);
								allAttentionValues.push(value);
							}
						}
					}
				}
			} else if (!isAttention && Array.isArray(layerData)) {
				// FFN layer: [5, neurons] - collect all neuron values
				for (let tokenType = 0; tokenType < 5; tokenType++) {
					if (layerData[tokenType] && Array.isArray(layerData[tokenType])) {
						// Filter out NaN values (used by conditional NIG to mask non-target neurons)
						const values = layerData[tokenType]
							.filter(v => Number.isFinite(v))
							.map(v => useAbsoluteValues ? Math.abs(v) : v);
						allModelValues.push(...values);
						allFFNValues.push(...values);
					}
				}
			}
		});
		
		// STEP 2: Sort all values and determine cutoff thresholds
		allModelValues.sort((a, b) => b - a);
		allAttentionValues.sort((a, b) => b - a);
		allFFNValues.sort((a, b) => b - a);
		
		let globalCutoff = 0;
		if (allModelValues.length > 0) {
			if (threshold === 0) {
				// threshold = 0 means show top 0% of values → cutoff = max value (nothing passes)
				globalCutoff = allModelValues[0];
			} else {
				// threshold > 0: logarithmically mapped (0.0001 to 1), calculate cutoff for top threshold% of values
				const cutoffIndex = Math.max(0, Math.floor(allModelValues.length * threshold) - 1);
				// Ensure we have a valid cutoff value; if index calculation results in no values, use the max
				globalCutoff = allModelValues[cutoffIndex] !== undefined ? allModelValues[cutoffIndex] : allModelValues[0];
			}
		}

		// Calculate pruning cutoffs for ATTN and FFN
		// Both should be based on the same global values, just like the global cutoff
		let attentionPruningCutoff = 0;
		let ffnPruningCutoff = 0;
		
		if (pruningState.enabled && allModelValues.length > 0) {
			if (pruningState.thresholds.attention === 0) {
				attentionPruningCutoff = allModelValues[0]; // Max value
			} else if (pruningState.thresholds.attention > 0) {
				const attentionCutoffIndex = Math.max(0, Math.floor(allModelValues.length * pruningState.thresholds.attention) - 1);
				attentionPruningCutoff = allModelValues[attentionCutoffIndex] !== undefined ? allModelValues[attentionCutoffIndex] : allModelValues[0];
			}
			
			if (pruningState.thresholds.ffn === 0) {
				ffnPruningCutoff = allModelValues[0]; // Max value
			} else if (pruningState.thresholds.ffn > 0) {
				const ffnCutoffIndex = Math.max(0, Math.floor(allModelValues.length * pruningState.thresholds.ffn) - 1);
				ffnPruningCutoff = allModelValues[ffnCutoffIndex] !== undefined ? allModelValues[ffnCutoffIndex] : allModelValues[0];
			}
		}
		
		console.log(`GLOBAL THRESHOLD STATS:`);
		console.log(`  Total values in model: ${allModelValues.length}`);
		console.log(`  Value range: ${allModelValues[allModelValues.length-1].toFixed(6)} to ${allModelValues[0].toFixed(6)}`);
		console.log(`  Threshold: ${(threshold * 100).toFixed(4)}% = ${Math.floor(allModelValues.length * threshold)} values`);
		console.log(`  Global cutoff value: ${globalCutoff.toFixed(6)}`);
		console.log(`  Values above cutoff: ${allModelValues.filter(v => v >= globalCutoff).length}`);
		
		console.log(`PRUNING THRESHOLD STATS:`);
		console.log(`  Attention pruning cutoff (from global values): ${attentionPruningCutoff.toFixed(6)}`);
		console.log(`  FFN pruning cutoff (from global values): ${ffnPruningCutoff.toFixed(6)}`);
		console.log(`  Note: Both pruning cutoffs use the same global value pool as the global threshold`);
		
		// STEP 3: Now compute edges using the cutoffs
		console.log(`---- COMPUTING EDGES USING CUTOFFS ----`);
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
								const rawValue = layerData[head][tgtToken][srcToken];
								// Skip NaN values (used by conditional NIG to mask non-target neurons)
								if (!Number.isFinite(rawValue)) continue;
								headValues.push(useAbsoluteValues ? Math.abs(rawValue) : rawValue);
							}
						}
						
					if (headValues.length > 0) {
						// Count how many heads exceed the GLOBAL cutoff
						// If threshold is 0, show no edges (count = 0)
						const count = threshold > 0 ? headValues.filter(v => v >= globalCutoff).length : 0;
						const proportion = count / headValues.length;							
						// Debug logging 
							//console.log(`${layerKey} (ATTN): ${tokenTypes[srcToken]} → ${tokenTypes[tgtToken]}`);
							//console.log(`  Head values: [${headValues.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...] (${headValues.length} total)`);
							//console.log(`  Global cutoff: ${globalCutoff.toFixed(6)}, Count above: ${count}/${headValues.length}, Proportion: ${proportion.toFixed(3)}`);
							
							// Only create edge if some heads exceed the global threshold
							if (proportion > 0) {
								// Determine if edge should be red based on pruning cutoff
								const shouldBeRed = pruningState.enabled && attentionPruningCutoff > 0 && 
									headValues.some(v => v >= attentionPruningCutoff);
								
								edges.push({
									layer: layerKey,
									srcToken: tokenTypes[srcToken],
									tgtToken: tokenTypes[tgtToken],
									nigValue: proportion, // Use proportion for thickness
									count: count,
									total: headValues.length,
									globalCutoff: globalCutoff,
									shouldBeRed: shouldBeRed, // Precomputed red status
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
					// Filter out NaN values (used by conditional NIG to mask non-target neurons)
					const neuronValues = layerData[tokenType]
						.filter(v => Number.isFinite(v))
						.map(v => useAbsoluteValues ? Math.abs(v) : v);
					if (neuronValues.length > 0) {
						// Count how many neurons exceed the GLOBAL cutoff
						// If threshold is 0, show no edges (count = 0)
						const count = threshold > 0 ? neuronValues.filter(v => v >= globalCutoff).length : 0;
						const proportion = count / neuronValues.length;							
						// Debug logging
							//console.log(`${layerKey} (FFN): ${tokenTypes[tokenType]}`);
							//console.log(`  Neuron values: [${neuronValues.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...] (${neuronValues.length} total)`);
							//console.log(`  Global cutoff: ${globalCutoff.toFixed(6)}, Count above: ${count}/${neuronValues.length}, Proportion: ${proportion.toFixed(3)}`);
							
							// Only create edge if some neurons exceed the global threshold
							if (proportion > 0) {
								if (layerIndex < totalLayers - 1) {
									// Connect to next layer's ATTN
									// Determine if edge should be red based on pruning cutoff
									const shouldBeRed = pruningState.enabled && ffnPruningCutoff > 0 && 
										neuronValues.some(v => v >= ffnPruningCutoff);
									
									edges.push({
										layer: layerKey,
										srcToken: tokenTypes[tokenType],
										tgtToken: tokenTypes[tokenType], // Same token type for FFN-to-ATTN
										nigValue: proportion, // Use proportion for thickness
										count: count,
										total: neuronValues.length,
										globalCutoff: globalCutoff,
										shouldBeRed: shouldBeRed, // Precomputed red status
										x1: tokenType,
										y1: visualPosition,     // FFN (square)
										x2: tokenType,
										y2: visualPosition - 1, // ATTN of next layer (above current FFN)
									});
								} else {
									// L11 FFN - connect to the bar (y2 = -1 will be handled in view)
									// Determine if edge should be red based on pruning cutoff
									const shouldBeRed = pruningState.enabled && ffnPruningCutoff > 0 && 
										neuronValues.some(v => v >= ffnPruningCutoff);
									
									edges.push({
										layer: layerKey,
										srcToken: tokenTypes[tokenType],
										tgtToken: tokenTypes[tokenType], // Same token type
										nigValue: proportion, // Use proportion for thickness
										count: count,
										total: neuronValues.length,
										globalCutoff: globalCutoff,
										shouldBeRed: shouldBeRed, // Precomputed red status
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
		console.log(`  Pruning enabled: ${pruningState.enabled}`);
		console.log(`  Sample edges:`, edges.slice(0, 3).map(e => ({ 
			layer: e.layer, 
			srcToken: e.srcToken, 
			tgtToken: e.tgtToken, 
			shouldBeRed: e.shouldBeRed,
			nigValue: e.nigValue
		})));

		this.edges$.next(edges);
		// Also emit the global cutoff so other components (e.g., histogram/ECDF) can render consistent shading
		this.globalCutoff$.next(globalCutoff);
		
		// Also emit the computed pruning cutoffs for other components to use
		this.pruningCutoffs$.next({
			attention: attentionPruningCutoff,
			ffn: ffnPruningCutoff
		});
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
				error$: this.$error,
				pruningState$: this.pruningState$,
				labelClick$: this.labelClick$,
				colorNodesEnabled$: this.colorNodesEnabled$,
				nodeColorData$: this.nodeColorData$,
				prunedEdges$: this.prunedEdges$,
				prunedNodes$: this.prunedNodes$,
				pruningCursorEnabled$: this.pruningCursorEnabled$,
				conditionalCursorEnabled$: this.conditionalCursorEnabled$,
				conditionalNigTarget$: this.conditionalNigTarget$,
				conditionalModeState$: this.conditionalModeState$,
				prunePreview$: this.prunePreview$,
				hover$: this.hover$
			},
		});
		return () => unmount(app);
	}
}
