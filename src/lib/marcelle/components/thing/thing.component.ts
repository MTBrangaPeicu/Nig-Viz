import { Component } from '@marcellejs/core';
import View from './thing.view.svelte';
import { mount, unmount } from 'svelte';

export interface ThingOptions {
  [key: string]: unknown;
}

export class Thing extends Component {
  title: string;
  options: ThingOptions;

  constructor(options: ThingOptions = {}) {
    super();
    this.title = 'thing [custom component 🤖]';
    this.options = options;
  }

  mount(target?: HTMLElement) {
    const t = target || document.querySelector(`#${this.id}`);
    if (!t) return;
    const app = mount(View, {
      target: t,
      props: {
        title: this.title,
        options: this.options,
      },
    });
    return () => unmount(app);
  }
}
