import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './nigtable.view.svelte';
import { mount, unmount } from 'svelte';

export class Nigtable extends Component {
	constructor(initialOptions = {}) {
		super();
		this.title = 'nigtable [custom component 🤖]';
		this.$options = new BehaviorSubject(initialOptions); // Use BehaviorSubject for reactivity
		this.pruningState$ = new BehaviorSubject({ enabled: false, rules: [], targets: [], thresholds: {} });
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
			},
		});
		return () => unmount(app);
	}
}
