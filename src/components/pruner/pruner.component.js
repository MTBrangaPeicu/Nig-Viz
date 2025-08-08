import { Component } from '@marcellejs/core';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import View from './pruner.view.svelte';
import { mount, unmount } from 'svelte';

export class Pruner extends Component {
  constructor(options = {}) {
    super();
    this.title = 'Pruner';

    // State
    this.enabled$ = new BehaviorSubject(options.options?.enabled || false);
    this.attentionThreshold$ = new BehaviorSubject(options.options?.attentionThreshold || 0.0);
    this.ffnThreshold$ = new BehaviorSubject(options.options?.ffnThreshold || 0.0);
    this.pruningRules$ = new BehaviorSubject(options.options?.pruningRules || []);
    this.pruningTargets$ = new BehaviorSubject(options.options?.pruningTargets || []);

    // Combined options as BehaviorSubject to support getValue()
    this.$options = new BehaviorSubject({
      enabled: options.options?.enabled || false,
      attentionThreshold: options.options?.attentionThreshold || 0.0,
      ffnThreshold: options.options?.ffnThreshold || 0.0,
      pruningRules: options.options?.pruningRules || [],
      pruningTargets: options.options?.pruningTargets || []
    });

    // Update $options when any individual state changes
    combineLatest([
      this.enabled$,
      this.attentionThreshold$,
      this.ffnThreshold$,
      this.pruningRules$,
      this.pruningTargets$
    ]).pipe(
      map(([enabled, attentionThreshold, ffnThreshold, pruningRules, pruningTargets]) => ({
        enabled,
        attentionThreshold,
        ffnThreshold,
        pruningRules,
        pruningTargets
      }))
    ).subscribe(options => {
      this.$options.next(options);
    });
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;
    const app = mount(View, {
      target: t,
      props: {
        title: this.title,
        enabled$: this.enabled$,
        attentionThreshold$: this.attentionThreshold$,
        ffnThreshold$: this.ffnThreshold$,
        pruningRules$: this.pruningRules$,
        pruningTargets$: this.pruningTargets$,
      }
    });
    return () => unmount(app);
  }
}
