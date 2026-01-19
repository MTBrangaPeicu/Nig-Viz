import { Component } from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';
import View from './better-number.view.svelte';
import { mount, unmount } from 'svelte';

export class BetterNumber extends Component {
	constructor(defaultValue = 10, step = 10) {
		super();
		this.title = 'betterNumber [custom component 🤖]';
		this.$value = new BehaviorSubject(defaultValue); 
		this.step = step;
		this.id = `better-number-${Math.random().toString(36).slice(2)}`;
	}

	mount(target) {
		const t = target || document.querySelector(`#${this.id}`);
		if (!t) return;
		const app = mount(View, {
			target: t,
			props: {
				title: this.title,
				value: this.$value, 
				step: this.step,
				id: this.id,
			},
		});
		return () => unmount(app);
	}
}
