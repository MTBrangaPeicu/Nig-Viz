import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './nigtable.view.svelte';
import { mount, unmount } from 'svelte';

export class Nigtable extends Component {
	constructor(initialOptions = {}) {
		super();
		this.title = 'nigtable [custom component 🤖]';
		this.$options = new BehaviorSubject(initialOptions); // Use BehaviorSubject for reactivity
		this.pruningState$ = new BehaviorSubject({ enabled: false, rules: [], targets: [], edges: [], thresholds: {} });
		this.absoluteValues$ = new BehaviorSubject(true); // Stream to control absolute vs signed values
		this.selectionRequest$ = new BehaviorSubject(null); // Stream to request architecture selection updates
		this.$globalCutoff = new BehaviorSubject(0); // Reactive stream for global cutoff value
		this.pruningCursorEnabled$ = new BehaviorSubject(false); // Stream to enable/disable pruning cursor mode
		// Conditional NIG support
		this.conditionalCursorEnabled$ = new BehaviorSubject(false); // Stream to enable/disable conditional NIG cursor mode
		this.conditionalNigTarget$ = new BehaviorSubject(null); // Emits { layerIdx, neuronType, neuronIdx } on neuron click
	}

	updatePruningState(pruningOptions) {
		this.pruningState$.next({
			enabled: pruningOptions.enabled,
			rules: pruningOptions.pruningRules || [],
			targets: pruningOptions.pruningTargets || [],
			thresholds: {
				attention: pruningOptions.attentionThreshold || 0.0,
				ffn: pruningOptions.ffnThreshold || 0.0
			}
		});
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				options$: this.$options, // Pass the reactive store to the view
				pruningState$: this.pruningState$, // Pass pruning state to view
				absoluteValues$: this.absoluteValues$, // Pass absolute values mode to view
				selectionRequest$: this.selectionRequest$, // Pass selection request stream to view
				globalCutoff$: this.$globalCutoff, // Pass global cutoff stream to view
				pruningCursorEnabled$: this.pruningCursorEnabled$, // Pass pruning cursor state to view
				conditionalCursorEnabled$: this.conditionalCursorEnabled$, // Pass conditional cursor state to view
				conditionalNigTarget$: this.conditionalNigTarget$, // Pass conditional target stream to view
			},
		});
		return () => unmount(app);
	}
}
