import { dataStore } from '@marcellejs/core';
import { writable } from 'svelte/store';
import type { User } from '$lib/declarations';

// Connect to Marcelle backend (MongoDB + SocketIO)
// Make sure to run: pnpm backend
export const user = writable<User | undefined>(undefined);
export const store = dataStore('http://localhost:3030');
//export const store = dataStore('https://marcelle.lisn.upsaclay.fr/nig-viz/api/');

// Track if user is authenticated (not anonymous)
export const isAuthenticated = writable<boolean>(false);

store.$status.subscribe((s) => {
  if (s === 'connected') {
    const currentUser = store.user as User;
    user.set(currentUser);
    // Only consider authenticated if not anonymous
    isAuthenticated.set(currentUser?.role !== 'anonymous' && !!currentUser);
  } else {
    isAuthenticated.set(false);
  }
});
