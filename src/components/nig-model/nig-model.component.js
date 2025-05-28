import {
  Component,
  throwError,
} from '@marcellejs/core';
import { BehaviorSubject } from 'rxjs';

export class NigModel extends Component {
  title = "NIG Model";

  constructor(store, serviceName) {
    super();
    this.store = store;
    this.ready = false;
    this.serviceName = serviceName;
    this.$status = new BehaviorSubject(
      { status: 'idle', message: '', progress: 0 },
      true,
    );
    this.$data = new BehaviorSubject(null, true); // <-- Add $data observable

    this.store
      .connect()
      .then(() => this.setup())
      .catch((err) => {
        const e = new Error(`an error occurred duing setup: ${err}`);
        e.name = "[Julie's Classifier]";
        throwError(e);
      });
  }

  async setup() {
    this.service = this.store.service(this.serviceName);
    this.service.on('patched', (x) => {
      if (x._id === this.currentId) {
        this.$status.next(x);
        // PATCH: Always emit the full patched doc to $data for status and result
        this.$data.next(x);
      }
    });
    this.service.on('created', (x) => {
      if (x._id === this.currentId) {
        this.$data.next(x);
      }
    });
    this.ready = true;
  }

  async predict(payload) {
    if (!this.service) return;
    this.$status.next({
      status: 'processing',
      message: 'Requesting prediction',
      progress: null,
    });
    const res = await this.service.create({
      ...payload,
      status: 'requested',
      progress: null
    });
    this.currentId = res.id || res._id;
    // If result is available immediately, emit it
    if (res.result) {
      this.$data.next(res.result);
    }
  }

  mount() {}
}
