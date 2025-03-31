import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './nigtable.view.svelte';
import { mount, unmount } from 'svelte';

export class Nigtable extends Component {
	constructor(initialOptions = {}) {
		super();
		this.title = 'nigtable [custom component 🤖]';
		this.$options = new BehaviorSubject(initialOptions); // Use BehaviorSubject for reactivity
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
