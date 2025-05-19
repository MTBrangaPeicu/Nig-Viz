import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './progressbar.view.svelte';
import { mount, unmount } from 'svelte';

export class Progressbar extends Component {
	constructor(initialOptions = {}) {
		super();
		this.title = 'Progress Bar';
		this.$options = new BehaviorSubject(initialOptions); // Use BehaviorSubject for reactivity
	}

	// Method to update progress
	updateProgress(value) {
		this.$options.next({ progress: value });
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				options$: this.$options, // Pass the reactive store to the view
			},
		});
		return () => unmount(app);
	}
}
