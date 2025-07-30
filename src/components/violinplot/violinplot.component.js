import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './violinplot.view.svelte';
import { mount, unmount } from 'svelte';

export class Violinplot extends Component {
	constructor(initialOptions = {}) {
		super();
		this.title = 'violinplot [custom component 🎻]';
		this.$options = new BehaviorSubject(initialOptions);
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				options$: this.$options,
			},
		});
		return () => unmount(app);
	}
}
