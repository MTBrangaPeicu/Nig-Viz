import { Component } from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';
import View from './architecture.view.svelte';
import { mount, unmount } from 'svelte';

export class Architecture extends Component {
	constructor(options = {}) {
		super();
		this.title = 'architecture [custom component 🤖]';
		this.options = options;
		this.$selection = new BehaviorSubject({ layer: null, tokenType: null, edges: [], range: null }); // Include edges and range in the reactive store
		this.$threshold = new BehaviorSubject(0.05);
	}

	updateEdges(subsetA) {
		const edges = [];
		const tokenTypes = ['cls', 'qry', 'sep1', 'doc', 'sep2'];
		const totalLayers = 12;

		Object.entries(subsetA).forEach(([layerKey, layerData]) => {
			const match = layerKey.match(/encoder\.layer\.(\d+)\.(attention|intermediate)/);
			if (!match) return;

			const layerIndex = parseInt(match[1]);
			const isAttention = match[2] === 'attention';
			const type = isAttention ? 'ATTN' : 'FFN';

			// Compute vertical position from bottom up
			const baseY = (totalLayers - 1 - layerIndex) * 2;

			if (isAttention) {
				// ATTN connects upward to FFN of same layer
				if (Array.isArray(layerData[0])) {
					tokenTypes.forEach((fromToken, i) => {
						tokenTypes.forEach((toToken, j) => {
							const value = layerData[i][j];
							if (value !== undefined && !isNaN(value)) {
								edges.push({
									layer: layerKey,
									srcToken: fromToken,
									tgtToken: toToken,
									nigValue: value,
									x1: i,
									y1: baseY,        // ATTN (circle)
									x2: j,
									y2: baseY + 1,    // FFN (square) of same layer
								});
							}
						});
					});
				}
			} else {
				// FFN connects upward to next layer's ATTN (if it exists)
				if (layerIndex + 1 < totalLayers) {
					tokenTypes.forEach((token, i) => {
						const value = layerData[i];
						if (value !== undefined && !isNaN(value)) {
							edges.push({
								layer: layerKey,
								srcToken: token,
								tgtToken: null,
								nigValue: value,
								x1: i,
								y1: baseY + 1,      // FFN (square)
								x2: i,
								y2: baseY + 2,      // ATTN (circle) of next layer above
							});
						}
					});
				}
			}
		});

		// Compute min/max range 
		const nigValues = edges.map(e => Math.abs(e.nigValue));
		const range = {
			min: Math.min(...nigValues),
			max: Math.max(...nigValues),
		};

		this.$selection.next({
			...this.$selection.getValue(),
			edges,
			range,
			redraw: true,
		});
	}

	updateThreshold(newThreshold) {
		this.$threshold.next(newThreshold);
		this.redrawEdges();
	}

	redrawEdges() {
		// Trigger edge redraw logic in the view
		this.$selection.next({ ...this.$selection.getValue(), redraw: true });
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
			},
		});
		return () => unmount(app);
	}
}
