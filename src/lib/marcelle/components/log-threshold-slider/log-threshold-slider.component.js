import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './log-threshold-slider.view.svelte';
import { mount, unmount } from 'svelte';

export class LogThresholdSlider extends Component {
  constructor(initial = 0.5) {
    super();
    this.title = '';
    this.$value = new BehaviorSubject(initial); // s in [0,1]
    this.$options = new BehaviorSubject({}); // for globalExtent
  }
  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;
    const app = mount(View, {
      target: t,
      props: { value$: this.$value, options$: this.$options },
    });
    return () => unmount(app);
  }
}

export function logThresholdSlider(initial) {
  return new LogThresholdSlider(initial);
}
