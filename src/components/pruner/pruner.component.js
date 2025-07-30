import { Component } from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';
import View from './pruner.view.svelte';
import { mount, unmount } from 'svelte';

export class Pruner extends Component {
  constructor(options = {}) {
    super();
    this.title = 'Pruner';

    // State
    this.enabled$ = new BehaviorSubject(false);
    this.globalThreshold$ = new BehaviorSubject(0.1);
    this.pruningRules$ = new BehaviorSubject([]);     // [{layer, tokenType}]
    this.pruningTargets$ = new BehaviorSubject([]);   // [{type, layer, index}]
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;
    const app = mount(View, {
      target: t,
      props: {
        title: this.title,
        enabled$: this.enabled$,
        globalThreshold$: this.globalThreshold$,
        pruningRules$: this.pruningRules$,
        pruningTargets$: this.pruningTargets$,
      }
    });
    return () => unmount(app);
  }
}
