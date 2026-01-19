import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './ecdf-chart.view.svelte';
import { mount, unmount } from 'svelte';

export class EcdfChart extends Component {
  constructor(initialOptions = {}) {
    super();
    this.title = 'ECDF Chart';
    this.$options = new BehaviorSubject(initialOptions);
    this.$globalCutoff = new BehaviorSubject(0);
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return () => {};
    const app = mount(View, {
      target: t,
      props: {
        options$: this.$options,
        globalCutoff$: this.$globalCutoff,
        id: this.id,
      },
    });
    return () => unmount(app);
  }
}

export function ecdfChart(initialOptions) {
  return new EcdfChart(initialOptions);
}
