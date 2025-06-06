import { Component } from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';
import View from './architecture.view.svelte';
import { mount, unmount } from 'svelte';

export class Architecture extends Component {
	constructor(options = {}) {
		super();
		this.title = 'architecture [custom component 🤖]';
		this.options = options;
		this.$selection = new BehaviorSubject({ layer: null, tokenType: null }); // Reactive store for selection
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				title: this.title,
				options: this.options,
				selection$: this.$selection, // Pass the reactive store to the view
			},
		});
		return () => unmount(app);
	}
}
