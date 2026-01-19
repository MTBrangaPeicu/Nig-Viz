import { BehaviorSubject } from 'rxjs';
import { Component } from '@marcellejs/core';
import View from './distribution-chart.view.svelte';
import { mount, unmount } from 'svelte';

export class DistributionChart extends Component {
  constructor(initialOptions = {}) {
    super();
    this.title = 'Distribution Chart';
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

export function distributionChart(initialOptions) {
  return new DistributionChart(initialOptions);
}
