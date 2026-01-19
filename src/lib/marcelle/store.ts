import { dataStore } from '@marcellejs/core';

// Connect to Marcelle backend (MongoDB + SocketIO)
// Make sure to run: pnpm backend
export const store = dataStore('http://localhost:3030');
