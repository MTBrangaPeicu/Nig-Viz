import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './nig-histogram.view.svelte';
import { mount, unmount } from 'svelte';

export class NigHistogram extends Component {
  constructor(initialOptions = {}) {
    super();
    this.title = 'NIG Histogram';
    this.$options = new BehaviorSubject(initialOptions);
    this.$globalCutoff = new BehaviorSubject(0);
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;
    const app = mount(View, {
      target: t,
      props: {
        options$: this.$options,
        globalCutoff$: this.$globalCutoff,
      },
    });
    return () => unmount(app);
  }
}

export function nigHistogram(initialOptions) {
  return new NigHistogram(initialOptions);
}
