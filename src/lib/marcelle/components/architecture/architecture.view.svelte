<script>
	// @ts-nocheck
	import { combineLatest } from 'rxjs';
	import { onMount, onDestroy } from 'svelte';
	import * as d3 from 'd3';


	export const options = {};
	export let selection$;
	export let threshold$;
	export let edges$;
	export let pruningState$;
	export let labelClick$;
	export let colorNodesEnabled$;
	export let nodeColorData$;
	export let prunedEdges$;
	export let prunedNodes$;
	export let pruningCursorEnabled$;
	export let conditionalCursorEnabled$ = null;
	export let conditionalNigTarget$ = null;
	export let conditionalModeState$ = null;
	export let prunePreview$ = null; // For hover preview of saved prunes
	//export let error$;


	// Adjustable vertical shift for everything below the text+bar
	const yShift = 48;
	const barHeight = 16; // Define barHeight here for use in drawEdges
	const topBarOffset = 12;

	let svg;
	let edgesGroup;
	let topBarEl; // reference to the clickable top bar
	let errorSub; // Declare errorSub variable
	let nodePruningState = { enabled: false, rules: [], targets: [], thresholds: {} };
	let architectureTooltipEl; // Custom tooltip element
	let colorNodesEnabled = false;
	let nodeColorData = null;
	let prunedEdges = new Set();
	let prunedNodes = new Set();
	let pruningCursorEnabled = false;
	let conditionalCursorEnabled = false;
	let conditionalModeState = { isConditional: false, targetLayerIdx: null, targetNeuronType: null };
	let prunePreviewState = null; // Preview state for hover highlighting

	// Two-step selection: source node then target node
	let currentSelection = { source: null, target: null };

	// Scroll the scrollable container to the bottom
	function scrollToBottom() {
		const container = document.getElementById('architecture-grid');
		if (!container) return;
		requestAnimationFrame(() => {
			container.scrollTop = container.scrollHeight;
		});
	}

	// Subscribe to selection changes
	selection$.subscribe(sel => {
		currentSelection = sel || { source: null, target: null };
		if (svg) updateSelectionHighlight();
	});

	// Subscribe to pruning state changes for node coloring
	pruningState$.subscribe(state => {
		nodePruningState = state;
		// Redraw the grid when pruning state changes
		if (svg) {
			updateNodeColors();
			redrawEdges(); // Also redraw edges to update colors for pruned edges
		}
	});

	// Subscribe to color nodes toggle
	colorNodesEnabled$.subscribe(enabled => {
		colorNodesEnabled = enabled;
		console.log('[Architecture View] Color nodes enabled:', enabled);
		if (svg) {
			updateNodeColors();
		}
	});

	// Subscribe to node color data
	nodeColorData$.subscribe(data => {
		nodeColorData = data;
		console.log('[Architecture View] Node color data updated:', data ? 'available' : 'null');
		if (svg) {
			updateNodeColors();
		}
	});

	// Subscribe to pruned edges set
	prunedEdges$.subscribe(edges => {
		prunedEdges = edges;
		if (svg) redrawEdges();
	});

	// Subscribe to pruned nodes set
	prunedNodes$.subscribe(nodes => {
		prunedNodes = nodes;
		if (svg) updateNodeColors();
	});

	// Subscribe to pruning cursor state (handled globally via body class)
	pruningCursorEnabled$.subscribe(enabled => {
		pruningCursorEnabled = enabled;
		// Global cursor management is handled in +page.svelte
	});

	// Subscribe to conditional NIG cursor state
	if (conditionalCursorEnabled$) {
		conditionalCursorEnabled$.subscribe(enabled => {
			conditionalCursorEnabled = enabled;
			console.log('[Architecture] Conditional cursor enabled:', enabled);
		});
	}

	// Subscribe to conditional mode state for greying out layers
	if (conditionalModeState$) {
		conditionalModeState$.subscribe(state => {
			conditionalModeState = state;
			console.log('[Architecture] Conditional mode state:', state);
			if (svg) {
				applyConditionalGreyOut();
			}
		});
	}

	// Subscribe to prune preview state for hover highlighting
	if (prunePreview$) {
		console.log('[Architecture] Subscribing to prunePreview$');
		prunePreview$.subscribe(preview => {
			console.log('[Architecture] Received prune preview:', preview);
			prunePreviewState = preview;
			if (svg) {
				applyPrunePreview();
			} else {
				console.warn('[Architecture] SVG not ready for preview');
			}
		});
	} else {
		console.warn('[Architecture] prunePreview$ not provided');
	}

	// Apply preview highlighting for saved prunes on hover
	function applyPrunePreview() {
		if (!svg) return;
		
		// If no preview state, restore the actual current prune state
		if (!prunePreviewState) {
			console.log('[Architecture Preview] Cleared preview, restoring current state');
			updateNodeColors();
			redrawEdges();
			return;
		}
		
		const isSavedPrune = prunePreviewState?.isSavedPrune || false;
		
		if (isSavedPrune) {
			// For saved prune preview: temporarily override nodePruningState and redraw
			const originalState = nodePruningState;
			nodePruningState = {
				enabled: true,
				rules: prunePreviewState.rules || [],
				targets: prunePreviewState.targets || [],
				edges: prunePreviewState.edges || [],
				thresholds: prunePreviewState.thresholds || {}
			};
			updateNodeColors();
			redrawEdges();
			// Restore original state reference (will be used when preview clears)
			nodePruningState = originalState;
			console.log('[Architecture Preview] Applied saved prune preview');
		} else {
			// For current items: just add orange highlight glow
			const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
			const { rules, targets, edges } = prunePreviewState;
			
			// Highlight nodes from rules
			if (rules && rules.length > 0) {
				rules.forEach(rule => {
					const layerMatch = rule.layer.match(/L(\d+)_(ATTN|FFN)/);
					if (!layerMatch) return;
					
					const layerIdx = parseInt(layerMatch[1]);
					const nodeType = layerMatch[2];
					const tokenIdx = rule.tokenType === 'all' ? -1 : tokenTypes.indexOf(rule.tokenType);
					
					const selector = nodeType === 'ATTN' ? '.attn-circle' : '.ffn-square';
					svg.selectAll(selector)
						.filter(function() {
							const thisLayer = parseInt(this.getAttribute('data-layer'));
							const thisToken = parseInt(this.getAttribute('data-token'));
							if (thisLayer !== layerIdx) return false;
							if (rule.tokenType === 'all') return true;
							return thisToken === tokenIdx;
						})
						.attr('stroke', '#f59e0b')
						.attr('stroke-width', 4)
						.style('filter', 'drop-shadow(0 0 6px #f59e0b)');
				});
			}
			
			// Highlight nodes from targets
			if (targets && targets.length > 0) {
				targets.forEach(target => {
					const layerMatch = target.layer.match(/Layer (\d+)/);
					if (!layerMatch) return;
					
					const layerIdx = parseInt(layerMatch[1]);
					const nodeType = target.type;
					const tokenIdx = tokenTypes.indexOf(target.tokenType);
					if (tokenIdx === -1) return;
					
					const selector = nodeType === 'ATTN' ? '.attn-circle' : '.ffn-square';
					svg.selectAll(selector)
						.filter(function() {
							return parseInt(this.getAttribute('data-layer')) === layerIdx &&
								parseInt(this.getAttribute('data-token')) === tokenIdx;
						})
						.attr('stroke', '#f59e0b')
						.attr('stroke-width', 4)
						.style('filter', 'drop-shadow(0 0 6px #f59e0b)');
				});
			}
			
			// Highlight edges
			if (edges && edges.length > 0) {
				edges.forEach(edge => {
					const layerMatch = edge.layer.match(/Layer (\d+)/);
					if (!layerMatch) return;
					
					const layerIdx = parseInt(layerMatch[1]);
					const srcTokenIdx = tokenTypes.indexOf(edge.srcToken);
					const tgtTokenIdx = tokenTypes.indexOf(edge.tgtToken);
					
					svg.selectAll('.edge-line')
						.filter(function() {
							return parseInt(this.getAttribute('data-layer')) === layerIdx &&
								parseInt(this.getAttribute('data-src')) === srcTokenIdx &&
								parseInt(this.getAttribute('data-tgt')) === tgtTokenIdx;
						})
						.attr('stroke', '#f59e0b')
						.attr('stroke-width', 3)
						.attr('stroke-opacity', 1)
						.style('filter', 'drop-shadow(0 0 4px #f59e0b)');
				});
			}
			console.log('[Architecture Preview] Applied current item highlight');
		}
	}

	// Apply greyed-out styling to layers beyond the target in conditional mode
	function applyConditionalGreyOut() {
		if (!svg) return;
		
		const { isConditional, targetLayerIdx, targetNeuronType } = conditionalModeState;
		
		// Reset all nodes first
		svg.selectAll('.attn-circle, .ffn-square').classed('greyed-out', false);
		svg.selectAll('.layer-label').classed('greyed-out', false);
		
		if (!isConditional || targetLayerIdx === null) return;
		
		// Selection logic depends on target neuron type:
		// - If target is ATTENTION: source can be ATTN or FFN of same layer
		//   → grey out ATTN > targetLayerIdx, FFN > targetLayerIdx
		// - If target is FFN: source can be FFN of same layer OR ATTN of next layer
		//   → grey out FFN > targetLayerIdx, ATTN > targetLayerIdx + 1
		
		const isTargetFFN = targetNeuronType === 'ffn';
		
		svg.selectAll('.attn-circle').each(function() {
			const layer = parseInt(this.getAttribute('data-layer'));
			// For FFN target: ATTN can be at targetLayerIdx + 1 (next layer)
			// For ATTN target: ATTN can only be at targetLayerIdx (same layer)
			const attnLimit = isTargetFFN ? targetLayerIdx + 1 : targetLayerIdx;
			if (layer > attnLimit) {
				d3.select(this).classed('greyed-out', true);
			}
		});
		
		svg.selectAll('.ffn-square').each(function() {
			const layer = parseInt(this.getAttribute('data-layer'));
			// FFN always limited to targetLayerIdx (same layer) for both target types
			if (layer > targetLayerIdx) {
				d3.select(this).classed('greyed-out', true);
			}
		});
		
		// Grey out layer labels too
		svg.selectAll('.layer-label').each(function() {
			const text = d3.select(this).text();
			const match = text.match(/L(\d+)/);
			if (match) {
				const layer = parseInt(match[1]);
				if (layer > targetLayerIdx) {
					d3.select(this).classed('greyed-out', true);
				}
			}
		});
		
		console.log('[Architecture] Applied conditional grey-out for layers >', targetLayerIdx);
	}

	// Helper function to redraw edges with current values from streams
	function redrawEdges() {
		// Get current values from BehaviorSubjects
		const edges = edges$.getValue ? edges$.getValue() : [];
		const threshold = threshold$.getValue ? threshold$.getValue() : 0.05;
		if (edges && edges.length > 0 && edgesGroup) {
			drawEdges(edges, threshold, nodePruningState);
		}
	}

	// Handle pruning rule toggle when clicking nodes in pruning mode
	function togglePruningRule(layer, type, tokenType) {
		console.log(`[Architecture] togglePruningRule called: layer=${layer}, type=${type}, tokenType=${tokenType}`);
		const currentState = nodePruningState;
		const layerKey = `L${layer}_${type}`;
		const ruleIndex = currentState.rules.findIndex(
			r => r.layer === layerKey && r.tokenType === tokenType
		);
		
		let newRules;
		if (ruleIndex >= 0) {
			// Remove existing rule
			newRules = currentState.rules.filter((_, i) => i !== ruleIndex);
			console.log(`[Architecture] Removed pruning rule: ${layerKey} ${tokenType}`);
		} else {
			// Add new rule
			newRules = [...currentState.rules, { layer: layerKey, tokenType }];
			console.log(`[Architecture] Added pruning rule: ${layerKey} ${tokenType}`);
		}
		
		// Update pruning state
		pruningState$.next({
			...currentState,
			rules: newRules
		});
		console.log(`[Architecture] New pruning state:`, { ...currentState, rules: newRules });
	}

	// Handle pruning entire layer when clicking layer labels in pruning mode
	function toggleLayerPruningRule(layer, type) {
		console.log(`[Architecture] toggleLayerPruningRule called: layer=${layer}, type=${type}`);
		const currentState = nodePruningState;
		const layerKey = `L${layer}_${type}`;
		
		// Check if this layer already has an "all" rule
		const allRuleIndex = currentState.rules.findIndex(
			r => r.layer === layerKey && r.tokenType === 'all'
		);
		
		let newRules;
		if (allRuleIndex >= 0) {
			// Remove the "all" rule for this layer
			newRules = currentState.rules.filter((_, i) => i !== allRuleIndex);
			console.log(`[Architecture] Removed layer pruning rule: ${layerKey} all`);
		} else {
			// Add "all" rule for this layer (prune entire layer)
			// Also remove any individual token rules for this layer since "all" covers them
			newRules = currentState.rules.filter(r => r.layer !== layerKey);
			newRules.push({ layer: layerKey, tokenType: 'all' });
			console.log(`[Architecture] Added layer pruning rule: ${layerKey} all`);
		}
		
		// Update pruning state
		pruningState$.next({
			...currentState,
			rules: newRules
		});
		console.log(`[Architecture] New pruning state:`, { ...currentState, rules: newRules });
	}

	// Handle pruning edges when clicking on them in pruning mode
	function toggleEdgePruning(layer, srcToken, tgtToken) {
		console.log(`[Architecture] toggleEdgePruning called: layer=${layer}, srcToken=${srcToken}, tgtToken=${tgtToken}`);
		const currentState = nodePruningState;
		const currentEdges = currentState.edges || [];
		
		// Check if this edge is already pruned
		const existingIndex = currentEdges.findIndex(
			e => e.layer === layer && e.srcToken === srcToken && e.tgtToken === tgtToken
		);
		
		let newEdges;
		if (existingIndex >= 0) {
			// Remove existing edge
			newEdges = currentEdges.filter((_, i) => i !== existingIndex);
			console.log(`[Architecture] Removed pruned edge: ${layer} ${srcToken} → ${tgtToken}`);
		} else {
			// Add new edge
			newEdges = [...currentEdges, { layer, srcToken, tgtToken }];
			console.log(`[Architecture] Added pruned edge: ${layer} ${srcToken} → ${tgtToken}`);
		}
		
		// Update pruning state
		pruningState$.next({
			...currentState,
			edges: newEdges
		});
		console.log(`[Architecture] New pruning state:`, { ...currentState, edges: newEdges });
	}

	// Function to check if a node should be red based on pruning rules (interactive pruning)
	function shouldNodeBeRed(layer, type, tokenType) {
		const layerKey = `L${layer}_${type}`;
		
		// Check if "all" is selected for this specific layer
		if (nodePruningState.rules && nodePruningState.rules.some(rule => rule.layer === layerKey && rule.tokenType === 'all')) {
			return true; // Highlight all token types in this specific layer
		}

		// Check pruning rules for specific layer/token matches
		return nodePruningState.rules && nodePruningState.rules.some(rule => 
			rule.layer === layerKey && rule.tokenType === tokenType
		);
	}

	// Function to check if an edge should be red based on pruning state
	function shouldEdgeBeRed(layer, srcToken, tgtToken) {
		if (!nodePruningState.edges) return false;
		
		// Check pruning edges for specific matches
		return nodePruningState.edges.some(edge => 
			edge.layer === layer && edge.srcToken === srcToken && edge.tgtToken === tgtToken
		);
	}

	// Function to get color for a node based on its max value
	// Uses EXACT same color scale as heatmaps and color scale legend
	function getNodeColor(layerIndex, nodeType, tokenType) {
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const nodeId = `L${layerIndex}_${nodeType}_${tokenType}`;
		
		// Priority 1: Manually pruned nodes via prunedNodes Set
		if (prunedNodes.has(nodeId)) {
			return 'darkred';
		}
		
		// Priority 2: Interactive pruning rules (from pruningState$.rules)
		if (shouldNodeBeRed(layerIndex, nodeType, tokenType)) {
			return 'darkred';
		}
		
		// Priority 3: Color by value if enabled and data available
		if (colorNodesEnabled && nodeColorData && nodeColorData.nodeMaxValues) {
			const nodeKey = `L${layerIndex}_${nodeType}_${tokenType}`;
			const value = nodeColorData.nodeMaxValues[nodeKey];
			
			if (value !== undefined && nodeColorData.extent) {
				const [minV, maxV] = nodeColorData.extent;
				const maxAbs = Math.max(Math.abs(minV), Math.abs(maxV));
				
				// EXACT same symlog transformation as heatmaps
				const symlog = (x) => {
					if (x === 0) return 0;
					const absX = Math.abs(x);
					const logVal = Math.log10(absX + 1);
					return Math.sign(x) * Math.pow(logVal, 0.7);
				};
				
				// EXACT same color logic as heatmaps (LOGARITHMIC scale for NIG)
				if (minV < 0 && maxV > 0) {
					// Diverging with symlog - SAME as heatmap
					const logMaxAbs = symlog(maxAbs);
					const logVal = symlog(value);
					const baseColor = d3.scaleDiverging(d3.interpolateRdBu)
						.domain([logMaxAbs, 0, -logMaxAbs])
						.clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				} else {
					// Sequential with log - SAME as heatmap
					const logMin = symlog(minV);
					const logMax = symlog(maxV);
					const logVal = symlog(value);
					const baseColor = d3.scaleSequential(d3.interpolateInferno)
						.domain([logMin, logMax])
						.clamp(true)(logVal);
					const rgb = d3.color(baseColor).rgb();
					rgb.r = Math.pow(rgb.r / 255, 0.8) * 255;
					rgb.g = Math.pow(rgb.g / 255, 0.8) * 255;
					rgb.b = Math.pow(rgb.b / 255, 0.8) * 255;
					return rgb.toString();
				}
			}
		}
		
		// Default colors
		return nodeType === 'ATTN' ? 'gray' : 'darkgray';
	}

	// Function to update node colors based on pruning state and color mode
	function updateNodeColors() {
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		
		// Update circles (ATTN nodes)
		svg.selectAll(".attn-circle")
			.attr("fill", function(d, i) {
				const layerIndex = parseInt(this.getAttribute('data-layer'));
				const tokenIndex = parseInt(this.getAttribute('data-token'));
				const tokenType = tokenTypes[tokenIndex];
				return getNodeColor(layerIndex, 'ATTN', tokenType);
			})
			.attr("fill-opacity", function() {
				const nodeId = this.getAttribute('data-node-id');
				return prunedNodes.has(nodeId) ? 0.3 : 1.0;
			})
			// Reset stroke unless in selection highlight mode
			.each(function() {
				const el = d3.select(this);
				// Don't reset if it's part of selection highlight (green stroke)
				if (el.attr('stroke') !== '#22C55E' && !el.attr('data-preview')) {
					el.attr('stroke', 'white').attr('stroke-width', 3).style('filter', null);
				}
			});

		// Update squares (FFN nodes)
		svg.selectAll(".ffn-square")
			.attr("fill", function(d, i) {
				const layerIndex = parseInt(this.getAttribute('data-layer'));
				const tokenIndex = parseInt(this.getAttribute('data-token'));
				const tokenType = tokenTypes[tokenIndex];
				return getNodeColor(layerIndex, 'FFN', tokenType);
			})
			.attr("fill-opacity", function() {
				const nodeId = this.getAttribute('data-node-id');
				return prunedNodes.has(nodeId) ? 0.3 : 1.0;
			})
			// Reset stroke unless in selection highlight mode
			.each(function() {
				const el = d3.select(this);
				// Don't reset if it's part of selection highlight (green stroke)
				if (el.attr('stroke') !== '#22C55E' && !el.attr('data-preview')) {
					el.attr('stroke', 'white').attr('stroke-width', 3).style('filter', null);
				}
			});
	}

	// Utility to map tokenType label to index
	function tokenTypeToIndex(tt) {
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		return tokenTypes.indexOf(tt);
	}

	// Highlight the currently selected node (circle for ATTN, square for FFN)
	function updateSelectionHighlight() {
		// Reset styles
		svg.selectAll('.attn-circle')
			.attr('stroke', 'white')
			.attr('stroke-width', 3)
			.style('filter', null);
		svg.selectAll('.ffn-square')
			.attr('stroke', 'white')
			.attr('stroke-width', 3)
			.style('filter', null);
		// Remove previous top-bar markers
		svg.selectAll('.top-bar-marker').remove();
		// Reset top bar default appearance
		if (topBarEl) {
			topBarEl.attr('stroke', '#888').classed('pulse', false).style('filter', null);
		}
		// Reset any previously highlighted edges
		svg.selectAll('.edge-line')
			.attr('stroke', function() { return d3.select(this).attr('data-stroke') || '#000'; })
			.attr('stroke-dasharray', null)
			.attr('stroke-dashoffset', null)
			.attr('marker-end', null)
			.attr('stroke-opacity', 0.8)
			.style('filter', null);

		const { source, target } = currentSelection || {};
		const highlight = (nodeType, layer, tokenType) => {
			const tokenIdx = tokenTypeToIndex(tokenType);
			if (tokenIdx === -1) return;
			const sel = svg.selectAll(nodeType === 'ATTN' ? '.attn-circle' : '.ffn-square')
				.filter(function() {
					return parseInt(this.getAttribute('data-layer')) === layer &&
						parseInt(this.getAttribute('data-token')) === tokenIdx;
				});
			sel
				.attr('stroke', '#22C55E')
				.attr('stroke-width', 5)
				.style('filter', 'drop-shadow(0 0 6px #22C55E)')
				.raise();
		};

		if (source) highlight(source.type, source.layer, source.tokenType);
		if (target) {
			if (target.type === 'TOP') {
				// Highlight whole bar in green and pulse
				if (topBarEl) {
					topBarEl
						.attr('stroke', '#22C55E')
						.style('filter', 'drop-shadow(0 0 6px #22C55E)');
				}
			} else {
				highlight(target.type, target.layer, target.tokenType);
			}
		}

		// Highlight connecting edges if both ends exist (only for the relevant layer)
		if (source && target) {
			const TOKENS = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
			const srcToken = source.tokenType;
			const tgtToken = target.type === 'TOP' ? source.tokenType : target.tokenType; // TOP bar acts like same token channel
			const expectedLayerKey = (() => {
				if (source.type === 'ATTN' && target.type === 'FFN' && source.layer === target.layer) {
					return `bert.encoder.layer.${source.layer}.attention.self.attention_probs`;
				}
				if (source.type === 'FFN' && target.type === 'ATTN' && target.layer === source.layer + 1) {
					return `bert.encoder.layer.${source.layer}.intermediate.dense`;
				}
				if (source.type === 'FFN' && target.type === 'TOP' && source.layer === 11) {
					return `bert.encoder.layer.${source.layer}.intermediate.dense`;
				}
				if (source.type === 'FFN' && target.type === 'ATTN' && target.layer === source.layer) {
					// Same-layer FFN→ATTN highlights the attention layer
					return `bert.encoder.layer.${source.layer}.attention.self.attention_probs`;
				}
				return null;
			})();
			// Match edges that connect source row to target row (including to-bar)
			edgesGroup.selectAll('.edge-line')
				.filter(function() {
					const e = d3.select(this);
					const eSrc = e.attr('data-srcToken');
					const eTgt = e.attr('data-tgtToken');
					const toBar = e.attr('data-to-bar') === '1';
					const layerOk = expectedLayerKey ? e.attr('data-layer') === expectedLayerKey : true;
					if (!layerOk) return false;
					if (target.type === 'TOP') return toBar && eSrc === srcToken && eTgt === srcToken;
					// Same-layer FFN→ATTN uses reversed token mapping (edge stores ATTN src = target.token, FFN tgt = source.token)
					if (source.type === 'FFN' && target.type === 'ATTN' && target.layer === source.layer) {
						return eSrc === tgtToken && eTgt === srcToken;
					}
					return eSrc === srcToken && eTgt === tgtToken;
				})
				.each(function() {
					const sel = d3.select(this);
					const x1 = parseFloat(sel.attr('x1')) || 0;
					const y1 = parseFloat(sel.attr('y1')) || 0;
					const x2 = parseFloat(sel.attr('x2')) || 0;
					const y2 = parseFloat(sel.attr('y2')) || 0;
					const len = Math.hypot(x2 - x1, y2 - y1) || 200;
					const flowDown = (source.type === 'FFN' && target.type === 'ATTN' && target.layer === source.layer);
					sel
						.attr('stroke', '#22C55E')
						.attr('stroke-opacity', 1)
						.attr('stroke-dasharray', '6,4')
						.attr('marker-start', null)
						.attr('marker-end', null)
						.attr('stroke-dashoffset', flowDown ? 0 : len)
						.transition()
						.duration(1200)
						.ease(d3.easeLinear)
						.attr('stroke-dashoffset', flowDown ? len : 0);
				})
				.raise();
		}

		// Preselection: when only source is selected, show valid targets and edges in yellow
		if (source && !target) {
			const TOKENS = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
			const srcToken = source.tokenType;
			const srcTokenIdx = tokenTypeToIndex(srcToken);
			const amber = '#F59E0B';

			// Helper to highlight a node in yellow
            const preNode = (nodeType, layer, tokenType) => {
                const tokenIdx = tokenTypeToIndex(tokenType);
                if (tokenIdx === -1) return;
                const sel = svg.selectAll(nodeType === 'ATTN' ? '.attn-circle' : '.ffn-square')
                    .filter(function() {
                        return parseInt(this.getAttribute('data-layer')) === layer &&
                            parseInt(this.getAttribute('data-token')) === tokenIdx;
                    });
                sel
                    .attr('stroke', amber)
                    .attr('stroke-width', 5)
                    .style('filter', `drop-shadow(0 0 6px ${amber})`)
                    .raise();
            };

			// Helper to highlight matching edges in yellow
			const preEdges = (predicate) => {
				edgesGroup.selectAll('.edge-line')
					.filter(function() { return predicate(d3.select(this)); })
					.attr('stroke', amber)
					.attr('stroke-opacity', 1)
					.attr('stroke-dasharray', null)
					.attr('marker-start', null)
					.attr('marker-end', null)
					.style('filter', `drop-shadow(0 0 6px ${amber})`)
					.raise();
			};

			if (source.type === 'ATTN') {
				// Valid targets: all FFN squares in same layer; edges from srcToken to all tgt tokens on attn layer
				TOKENS.forEach(tgt => preNode('FFN', source.layer, tgt));
				const expectedLayerKey = `bert.encoder.layer.${source.layer}.attention.self.attention_probs`;
				preEdges(e => e.attr('data-layer') === expectedLayerKey && e.attr('data-srcToken') === srcToken);
			}

			if (source.type === 'FFN') {
				// Case: FFN -> next ATTN (same token type only - FFN has no attention, just passes through)
				if (source.layer < 11) {
					preNode('ATTN', source.layer + 1, srcToken);
					const expectedLayerKey = `bert.encoder.layer.${source.layer}.intermediate.dense`;
					preEdges(e => e.attr('data-layer') === expectedLayerKey && e.attr('data-srcToken') === srcToken && e.attr('data-tgtToken') === srcToken);
				}
				// Case: FFN -> same-layer ATTN (reverse - any target token for attention view)
				TOKENS.forEach(tgt => preNode('ATTN', source.layer, tgt));
				const attnLayerKey = `bert.encoder.layer.${source.layer}.attention.self.attention_probs`;
				preEdges(e => e.attr('data-layer') === attnLayerKey && e.attr('data-tgtToken') === srcToken);
				// Case: FFN L11 -> TOP
				if (source.layer === 11 && topBarEl) {
					// Highlight bar
					topBarEl.attr('stroke', amber).style('filter', `drop-shadow(0 0 6px ${amber})`);
					const ffnKey = `bert.encoder.layer.${source.layer}.intermediate.dense`;
					preEdges(e => e.attr('data-layer') === ffnKey && e.attr('data-to-bar') === '1' && e.attr('data-srcToken') === srcToken && e.attr('data-tgtToken') === srcToken);
				}
			}
		}
	}

	// Removed scroll adjustments: no auto-scrolling or position preservation

	// Handle click events for FFN and ATTN layers
	function handleClick(layer, type, tokenType) {
		console.log(`Clicked - Layer: ${layer}, Type: ${type}, Token Type: ${tokenType}`);
		
		// Handle conditional NIG cursor mode
		if (conditionalCursorEnabled && conditionalNigTarget$ && type !== 'TOP') {
			console.log(`[Architecture] Conditional NIG target selected: layer=${layer}, type=${type}`);
			// For architecture clicks, we select the layer/type but need neuron index from table
			// Here we emit layer-level selection (neuronIdx = 0 as default, to be overridden by table click)
			conditionalNigTarget$.next({
				layerIdx: layer,
				neuronType: type === 'ATTN' ? 'attention' : 'ffn',
				neuronIdx: 0, // Default to first neuron; table click can provide specific index
				tokenType: tokenType
			});
			return; // Don't do normal selection when in conditional mode
		}
		
		const cur = currentSelection || { source: null, target: null };
		// Normalize click into a node object
		const node = { layer, type, tokenType };

		function isValidSecondClick(src, tgt) {
			if (!src || !tgt) return false;
			if (src.type === 'ATTN') {
				// Only FFN of the same layer (above)
				return tgt.type === 'FFN' && tgt.layer === src.layer;
			}
			if (src.type === 'FFN') {
				// Either ATTN of next layer (must be same token type), TOP (if L11), or ATTN of same layer (any token - for reverse attention view)
				if (tgt.type === 'ATTN' && tgt.layer === src.layer + 1 && tgt.tokenType === src.tokenType) return true;
				if (tgt.type === 'ATTN' && tgt.layer === src.layer) return true;
				if (tgt.type === 'TOP' && src.layer === 11) return true;
				return false;
			}
			return false;
		}

		function flashInvalid(t) {
			const tokenIdx = tokenTypeToIndex(t.tokenType);
			if (tokenIdx === -1) return;
			const sel = svg.selectAll(t.type === 'ATTN' ? '.attn-circle' : '.ffn-square')
				.filter(function() {
					return parseInt(this.getAttribute('data-layer')) === t.layer &&
						parseInt(this.getAttribute('data-token')) === tokenIdx;
				});
			sel.classed('invalid-pulse', true);
			setTimeout(() => sel.classed('invalid-pulse', false), 1000);
		}

		if (!cur.source) {
			// First click cannot be TOP bar; show invalid on bar instead
			if (type === 'TOP') {
				if (topBarEl) {
					topBarEl.classed('invalid-pulse', true);
					setTimeout(() => topBarEl.classed('invalid-pulse', false), 1000);
				}
				return;
			}
			selection$.next({ source: node, target: null });
			return;
		}
		if (!cur.target) {
			// If clicking the same node, clear
			if (cur.source.layer === node.layer && cur.source.type === node.type && cur.source.tokenType === node.tokenType) {
				selection$.next({ source: null, target: null });
			} else {
				if (isValidSecondClick(cur.source, node)) {
					selection$.next({ source: cur.source, target: node });
				} else {
					// Invalid second click: flash appropriate element and clear selection
					if (node.type === 'TOP') {
						if (topBarEl) {
							topBarEl.classed('invalid-pulse', true);
							setTimeout(() => topBarEl.classed('invalid-pulse', false), 1000);
						}
					} else {
						flashInvalid(node);
					}
					selection$.next({ source: null, target: null });
				}
			}
			return;
		}
		// If both set, start a new selection; TOP cannot be a first selection
		if (type === 'TOP') {
			if (topBarEl) {
				topBarEl.classed('invalid-pulse', true);
				setTimeout(() => topBarEl.classed('invalid-pulse', false), 1000);
			}
			selection$.next({ source: null, target: null });
			return;
		}
		selection$.next({ source: node, target: null });
	}

	function drawEdges(edges, globalThreshold, currentPruningState) {
		if (!edgesGroup) {
			console.error("Edges group is not defined. Ensure onMount has initialized the SVG element.");
			return;
		}

		// Clear all existing edges first
		edgesGroup.selectAll(".edge-line").remove();

		// Create a scale for edge thickness based on proportion (0 to 1)
		const thicknessScale = d3.scaleLinear()
			.domain([0, 1]) // proportion range
			.range([0.5, 4]); // thickness range

		const numLayers = 24;
		const barY = margin.top + topBarOffset; // bar is now below the text

		edges.forEach(({ x1, y1, x2, y2, nigValue, layer, count, total, srcToken, tgtToken, globalCutoff, shouldBeRed }) => {
			const x1Pos = margin.left + x1 * gridSize + gridSize / 2;
			let y1Pos = margin.top + y1 * gridSize + gridSize / 2 + yShift;
			const x2Pos = margin.left + x2 * gridSize + gridSize / 2;
			let y2Pos = margin.top + y2 * gridSize + gridSize / 2 + yShift;

			// If y2 is negative (above the grid), connect to the top bar
			if (y2 < 0) {
				y2Pos = barY + barHeight / 2; // Connect to middle of the bar
			}

			// Create edge ID for pruning tracking
			const edgeId = `${layer}_${srcToken}_${tgtToken}`;
			const isPrunedManually = prunedEdges.has(edgeId);
			
			// Check if edge is pruned via pruningState$.edges (interactive pruning)
			const displayLayer = `L${(() => {
				if (typeof layer === "string") {
					const m = layer.match(/layer\.(\d+)/);
					if (m) return m[1];
				}
				return layer ?? '';
			})()}_${layer?.includes('attention') ? 'ATTN' : 'FFN'}`;
			const isPrunedInteractive = shouldEdgeBeRed(displayLayer, srcToken, tgtToken);
			const isPruned = isPrunedManually || isPrunedInteractive;

			// Only draw edge if proportion > 0
			if (nigValue > 0) {
				// Determine edge color: pruned edges are darkred
				const edgeColor = isPruned ? 'darkred' : (shouldBeRed ? 'darkred' : 'black');
				const edgeOpacity = isPruned ? 0.5 : 0.8;
				
							const line = edgesGroup.append("line")
					.attr("x1", x1Pos)
					.attr("y1", y1Pos)
					.attr("x2", x2Pos)
					.attr("y2", y2Pos)
					.attr("stroke", edgeColor)
					.attr("stroke-width", thicknessScale(nigValue)) // Use proportion for thickness
					.attr("stroke-opacity", edgeOpacity)
					.attr("stroke-linecap", "round")
					.attr("class", "edge-line")
					.attr("data-stroke", edgeColor)
					.attr("data-layer", layer || '')
					.attr("data-srcToken", srcToken || '')
					.attr("data-tgtToken", tgtToken || '')
					.attr("data-edge-id", edgeId)
					.attr("data-to-bar", y2 < 0 ? '1' : '0');

			const layerNum = (() => {
				if (typeof layer === "string") {
					const m = layer.match(/layer\.(\d+)/);
					if (m) return m[1];
				}
				return layer ?? '';
			})();
			
			// Determine if this is ATTN or FFN
			const tooltipComponentType = layer?.includes('attention') ? 'ATTN' : 'FFN';
			
			// Enhanced tooltip with count and layer information
			let tooltipHTML = `<b>Layer ${layerNum} ${tooltipComponentType}</b><br>` +
				`${srcToken} → ${tgtToken}<br>` +
				`Count: ${count}/${total} (${(nigValue * 100).toFixed(1)}%)<br>` +
				`Global threshold: ${(globalThreshold * 100).toFixed(1)}%<br>` +
				`Global cutoff: ${globalCutoff ? globalCutoff.toFixed(6) : 'N/A'}`;
			
			if (isPruned) {
				tooltipHTML += `<br><b>Manually pruned</b>`;
			}
			
			// Add pruning information if enabled
			if (currentPruningState.enabled) {
				const pruningThreshold = tooltipComponentType === 'ATTN' ? currentPruningState.thresholds.attention : currentPruningState.thresholds.ffn;
				tooltipHTML += `<br>Pruning threshold: ${(pruningThreshold * 100).toFixed(1)}%`;
				tooltipHTML += `<br>Would be pruned: ${shouldBeRed ? 'Yes' : 'No'}`;
			}
			
			// Custom tooltip on both line and hit target
				const tooltip = d3.select(architectureTooltipEl);

				// Larger transparent hover target
				const hit = edgesGroup.append('line')
					.attr('x1', x1Pos)
					.attr('y1', y1Pos)
					.attr('x2', x2Pos)
					.attr('y2', y2Pos)
					.attr('stroke', 'transparent')
				.attr('stroke-width', Math.max(10, thicknessScale(nigValue) * 3))
				.attr('class', 'edge-line-hit')
				.attr('data-layer', layer || '')
				.attr('data-srcToken', srcToken || '')
				.attr('data-tgtToken', tgtToken || '')
				.on('mouseover', function(event) {
						line.attr('stroke-opacity', 1).attr('stroke-width', Math.max(2, thicknessScale(nigValue)+1));
						tooltip.style('opacity', 1).html(tooltipHTML);
					})
					.on('mousemove', function(event) {
						const px = Math.min(window.innerWidth - 200, (event.pageX || 0) + 12);
						const py = Math.min(window.innerHeight - 120, (event.pageY || 0) + 12);
						tooltip.style('left', `${px}px`).style('top', `${py}px`);
					})
					.on('mouseout', function() {
						line.attr('stroke-opacity', edgeOpacity).attr('stroke-width', thicknessScale(nigValue));
						tooltip.style('opacity', 0);
					})
				.on('click', function(event) {
					if (pruningCursorEnabled) {
						event.stopPropagation();
						// Get a simpler layer format for display
						const displayLayer = `L${layerNum}_${tooltipComponentType}`;
						toggleEdgePruning(displayLayer, srcToken, tgtToken);
					}
				});
			}
		});
	}

	const gridSize = 80;
	const margin = { top: 10, right: 20, bottom: 60, left: 100 };

	onMount(() => {
		// Create custom tooltip element
		architectureTooltipEl = document.createElement('div');
		architectureTooltipEl.className = 'heatmap-tooltip';
		architectureTooltipEl.style.opacity = '0';
		document.body.appendChild(architectureTooltipEl);

		// Set fixed grid size and margins

		const numLayers = 24;
		const numTokenTypes = 5; // cls, qry, sep1, doc, sep2
		const svgWidth = margin.left + (numTokenTypes * gridSize) + margin.right;
		const svgHeight = margin.top + margin.bottom + numLayers * gridSize + yShift;

		svg = d3.select("#architecture-grid")
			.append("svg")
			.attr("width", "100%")
			.attr("height", svgHeight)
			.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
			.attr("preserveAspectRatio", "xMinYMin meet")
			.style("display", "block");

			// Define arrow marker for flow indication
			const defs = svg.append('defs');
			defs.append('marker')
				.attr('id', 'arrow-green')
				.attr('markerWidth', 6)
				.attr('markerHeight', 6)
				.attr('refX', 4)
				.attr('refY', 3)
				.attr('orient', 'auto')
				.append('path')
				.attr('d', 'M0,0 L0,6 L6,3 z')
				.attr('fill', '#22C55E');

		// Add hollow bar for final edges to connect into
		const barY = margin.top + topBarOffset;
		const barStroke = 2;
		const barX = margin.left ; // Center the bar with respect to the first token
		const barWidth = gridSize * 5 ;

		edgesGroup = svg.append("g").attr("class", "edges-group");

		topBarEl = svg.append("rect")
			.attr("x", barX)
			.attr("y", barY)
			.attr("width", barWidth)
			.attr("height", barHeight)
			.attr("fill", "rgba(0,0,0,0)")
			.attr("stroke", "#888")
			.attr("stroke-width", barStroke)
		.attr("rx", 6)
		.attr("ry", 6)
		.attr("class", "top-bar")
		.style("cursor", () => pruningCursorEnabled ? 'auto' : 'pointer')
		.on("click", function (event) {
				const [mx] = d3.pointer(event, this);
				const localX = Math.max(0, Math.min(mx - barX, barWidth - 1));
				const tokenIndex = Math.floor(localX / gridSize);
				const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
				const tokenType = tokenTypes[tokenIndex];
				// Treat bar as a special TOP target; keep layer 11 implicit for table lookup
				handleClick(11, 'TOP', tokenType);
			});



		const sub = combineLatest([edges$, threshold$, pruningState$]).subscribe(
	([edges, threshold, pruningState]) => {
			console.log(`VIEW SUBSCRIPTION UPDATE:`);
			console.log(`  Edges received: ${edges ? edges.length : 'null'}`);
			console.log(`  Threshold: ${threshold}`);
			console.log(`  Pruning enabled: ${pruningState?.enabled}`);
			
			if (edges && edges.length > 0) {
				console.log(`  Drawing ${edges.length} edges`);
				drawEdges(edges, threshold, pruningState);
				// After drawing edges, ensure selection highlight is consistent
	updateSelectionHighlight();
				// Scroll to bottom when NIGs/edges are loaded or updated
				scrollToBottom();
			} else {
				console.log(`  Clearing edges (edges: ${edges ? edges.length : 'null'})`);
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
			if (architectureTooltipEl && architectureTooltipEl.parentNode) {
				architectureTooltipEl.parentNode.removeChild(architectureTooltipEl);
			}
			architectureTooltipEl = null;
			// Reset cursor on destroy
			document.body.style.cursor = '';
		});
		
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const layers = Array.from({ length: numLayers }, (_, i) => numLayers - 1 - i);


		// Add circles for ATTN layers and squares for FFN layers
		layers.forEach((layer, layerIndex) => {
			tokenTypes.forEach((tokenType, tokenIndex) => {
				if (layer % 2 === 0) {
					const nodeId = `L${Math.floor(layer / 2)}_ATTN_${tokenType}`;
					svg.append("circle")
						.attr("cx", margin.left + tokenIndex * gridSize + gridSize / 2)
						.attr("cy", margin.top + layerIndex * gridSize + gridSize / 2 + yShift)
						.attr("r", gridSize / 4)
						.attr("fill", "gray")
						.attr("stroke", "white")
						.attr("stroke-opacity", 0.8)
						.attr("stroke-width", 3)
						.attr("class", "attn-circle")
					.attr("data-layer", Math.floor(layer / 2))
					.attr("data-token", tokenIndex)
					.attr("data-node-id", nodeId)
					.style("cursor", () => pruningCursorEnabled ? 'auto' : 'pointer')
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
							if (pruningCursorEnabled) {
								togglePruningRule(Math.floor(layer / 2), 'ATTN', tokenType);
							} else {
								handleClick(Math.floor(layer / 2), 'ATTN', tokenType);
							}
						});
				} else {
					const nodeId = `L${Math.floor(layer / 2)}_FFN_${tokenType}`;
					svg.append("rect")
						.attr("x", margin.left + tokenIndex * gridSize + (gridSize - gridSize / 2) / 2)
						.attr("y", margin.top + layerIndex * gridSize + (gridSize - gridSize / 2) / 2 + yShift)
						.attr("width", gridSize / 2)
						.attr("height", gridSize / 2)
						.attr("fill", "darkgray")
						.attr("stroke", "white")
						.attr("stroke-width", 3)
						.attr("class", "ffn-square")
					.attr("data-layer", Math.floor(layer / 2))
					.attr("data-token", tokenIndex)
					.attr("data-node-id", nodeId)
					.style("cursor", () => pruningCursorEnabled ? 'auto' : 'pointer')
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
						if (pruningCursorEnabled) {
							togglePruningRule(Math.floor(layer / 2), 'FFN', tokenType);
						} else {
							handleClick(Math.floor(layer / 2), 'FFN', tokenType);
						}
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

		// Top labels removed - handled by sticky header in page layout

		svg.selectAll(".layer-label")
			.data(layers)
			.enter()
			.append("text")
			.attr("x", margin.left - 50)
			.attr("y", (d, i) => {
				const center = margin.top + i * gridSize + gridSize / 2 + yShift;
				// For both ATTN and FFN, place label above the row (between row and its target above)
				return center - gridSize / 2 + 4;
			})
		.attr("text-anchor", "middle")
		.text(d => `L${Math.floor(d / 2)} ${d % 2 === 0 ? 'ATTN' : 'FFN'}`)
		.attr("class", "layer-label")
		.style('cursor', () => pruningCursorEnabled ? 'auto' : 'pointer')
		.on('click', function(event, d){
				const L = Math.floor(d/2);
				const type = (d % 2 === 0) ? 'ATTN' : 'FFN';
				if (pruningCursorEnabled) {
					// In pruning mode, toggle layer pruning rule
					toggleLayerPruningRule(L, type);
				} else if (labelClick$ && typeof labelClick$.next === 'function') {
					// Normal mode: emit label click for table selection
					labelClick$.next({ layer: L, type });
				}
			});
	// Initial highlight attempt (in case selection existed before mount)
	updateSelectionHighlight();
	// Initial node colors (in case color data/mode existed before mount)
	updateNodeColors();
	// Scroll to bottom on initial load
	scrollToBottom();
	});
</script>

<div>
	<div id="architecture-grid"></div>
</div>


<style>
	/* Architecture grid - fixed width to match SVG viewBox, no internal scrolling */
	#architecture-grid {
		width: 520px;
	}

	:global(.token-label-bottom) {
		font-family: sans-serif;
		font-size: 14px;
		fill: #333;
	}

	@keyframes pulseGrow {
	0% { filter: drop-shadow(0 0 0px #22C55E); }
	50% { filter: drop-shadow(0 0 10px #22C55E); }
	100% { filter: drop-shadow(0 0 0px #22C55E); }
}
	@keyframes invalidFlash {
		0% { filter: drop-shadow(0 0 0px darkred); stroke: darkred; }
		50% { filter: drop-shadow(0 0 10px darkred); stroke: darkred; }
		100% { filter: drop-shadow(0 0 0px darkred); stroke: darkred; }
	}

	:global(.invalid-pulse) {
		animation: invalidFlash 1s ease-in-out;
	}
		:global(rect.top-bar.invalid-pulse) {
			stroke: darkred !important;
		}

 :global(.pulse) {
	animation: pulseGrow 1.6s ease-in-out infinite;
}

 :global(.edge-highlight) {
	stroke: #22C55E;
}

 :global(.top-bar) {
	transition: stroke 0.2s ease;
}

 /* Custom tooltip styling to match heatmap tooltips */
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

 /* Greyed-out state for conditional NIG mode */
 :global(.greyed-out) {
	opacity: 0.25 !important;
	filter: grayscale(100%) !important;
	pointer-events: none !important;
}

 :global(.layer-label.greyed-out) {
	opacity: 0.3 !important;
	fill: #9ca3af !important;
}

 /* Preview highlighting for saved prunes on hover */
 :global(.prune-preview-highlight) {
	stroke: #f59e0b !important;
	stroke-width: 4px !important;
	filter: drop-shadow(0 0 6px #f59e0b) !important;
}

 :global(.prune-preview-edge) {
	stroke: #f59e0b !important;
	stroke-width: 3px !important;
	stroke-opacity: 1 !important;
	filter: drop-shadow(0 0 4px #f59e0b) !important;
}

 @keyframes previewPulse {
	0% { filter: drop-shadow(0 0 3px #f59e0b); }
	50% { filter: drop-shadow(0 0 8px #f59e0b); }
	100% { filter: drop-shadow(0 0 3px #f59e0b); }
}

 :global(.prune-preview-highlight) {
	animation: previewPulse 1.5s ease-in-out infinite;
}
</style>
