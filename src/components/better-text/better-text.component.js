import { BehaviorSubject } from 'rxjs';
import { Component, rxBind } from '@marcellejs/core';
import View from './better-text.view.svelte';
import { mount, unmount } from 'svelte';

export class BetterText extends Component {
  constructor(defaultValue = '', options = [], id = `better-text-${Math.random().toString(36).substr(2, 9)}`) {
    super();
    this.title = 'betterText [autocomplete ✍️]';
    this.$value = new BehaviorSubject(defaultValue); // Reactive value stream
    this.$options = new BehaviorSubject(options); // Reactive options stream
    this.id = id; // Unique id for the input field
  }

  updateOptions(newOptions) {
    this.$options.next(newOptions); // Update options reactively
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;

    const app = mount(View, {
      target: t,
      props: {
        value$: rxBind(this.$value), // Bind reactive value stream
        options$: rxBind(this.$options), // Bind reactive options stream
        id: this.id, // Pass the unique id to the view
      },
    });

    return () => unmount(app);
  }
}
