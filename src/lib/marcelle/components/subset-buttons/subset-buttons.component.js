import { BehaviorSubject } from 'rxjs';
import { Component} from '@marcellejs/core';
import View from './subset-buttons.view.svelte';
import { mount, unmount } from 'svelte';

export class SubsetButtons extends Component {
  constructor(options = ['Random'], id = `subset-buttons-${Math.random().toString(36).slice(2)}`) {
    super();
    this.title = 'Subsets';
    this.$options = new BehaviorSubject(options);
    this.$value = new BehaviorSubject('Random');
    this.id = id;
  }

  setOptions(opts) {
    const arr = Array.isArray(opts) ? opts : [];
    this.$options.next(arr.length ? arr : ['Random']);
    if (!arr.includes(this.$value.getValue())) {
      this.$value.next(arr[0] || 'Random');
    }
  }

  mount(target) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;

    const app = mount(View, {
      target: t,
      props: {
        title: this.title,
        options$: this.$options,
        value$: this.$value,
        id: this.id,
      },
    });

    return () => unmount(app);
  }
}
