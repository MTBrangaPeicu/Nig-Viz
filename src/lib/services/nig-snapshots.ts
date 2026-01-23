// NIG Snapshot Management Service

import { store } from '$lib/marcelle/store';

export interface NIGSnapshot {
  version: number;
  id: string;
  timestamp: string;
  query: string;
  passage: string;
  baselineLabel: string;
  numReps: number;
  data: any; // The NIG data structure
  activations?: {
    attention: any;
    ffn: any;
  };
  selection?: any; // Last architecture selection
}

export class NIGSnapshotManager {
  private snapshots: NIGSnapshot[] = [];
  private listeners: Set<() => void> = new Set();
  private snapshotService: any;
  private isLoading = false;
  private totalStorageBytes = 0;

  constructor() {
    // Use Marcelle backend service for persistence (not localStorage)
    this.snapshotService = store.service('nig-snapshots');
    this.loadFromBackend();
  }

  // Public method to reload snapshots (call after authentication)
  reload() {
    this.loadFromBackend();
  }

  // Get total storage used by snapshots
  getTotalStorageKB(): number {
    return Math.round(this.totalStorageBytes / 1024);
  }

  // Get storage info for display
  getStorageInfo(): { count: number; totalKB: number; avgKB: number } {
    const totalKB = this.getTotalStorageKB();
    const avgKB = this.snapshots.length > 0 ? Math.round(totalKB / this.snapshots.length) : 0;
    return {
      count: this.snapshots.length,
      totalKB,
      avgKB
    };
  }

  // Load snapshots from backend
  private async loadFromBackend() {
    if (this.isLoading) return;
    this.isLoading = true;
    
    try {
      console.log('[NIG SNAPSHOTS] Loading from backend...');
      
      // Query backend for snapshots, sorted by creation time
      const result = await this.snapshotService.find({
        query: {
          $sort: { createdAt: -1 },
          $limit: 20
        }
      });
      
      if (result && result.data && Array.isArray(result.data)) {
        this.snapshots = result.data;
        console.log('[NIG SNAPSHOTS] ✓ Loaded', this.snapshots.length, 'snapshots from backend');
        this.notify();
      } else {
        console.log('[NIG SNAPSHOTS] No snapshots found in backend');
      }
    } catch (e) {
      console.error('[NIG SNAPSHOTS] Failed to load from backend:', e);
    } finally {
      this.isLoading = false;
    }
  }

  // Subscribe to snapshot changes
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Notify all listeners
  private notify() {
    this.listeners.forEach(fn => fn());
  }

  // Get all snapshots
  getSnapshots(): NIGSnapshot[] {
    return [...this.snapshots];
  }

  // Get latest snapshot
  getLatest(): NIGSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  // Format snapshot label for display
  formatSnapshotLabel(snapshot: NIGSnapshot): string {
    const q = (snapshot.query || '').slice(0, 25).replace(/\s+/g, ' ');
    const p = (snapshot.passage || '').slice(0, 25).replace(/\s+/g, ' ');
    const bl = snapshot.baselineLabel ? snapshot.baselineLabel.split(' ')[0] : 'BL?';
    return `${snapshot.timestamp} | ${bl} | r=${snapshot.numReps} | Q:${q}${q.length === 25 ? '…' : ''} | P:${p}${p.length === 25 ? '…' : ''}`;
  }

  // Create snapshot from NIG model result
  createSnapshot(doc: any, inputs: any): NIGSnapshot | null {
    if (!doc || !doc.result || !doc.result.subset_b) {
      console.warn('[NIG SNAPSHOTS] Cannot create snapshot - missing data');
      return null;
    }

    const nig = doc.result.subset_b;
    const r = doc.result;
    
    // Capture activations if available
    const attnActs = r.attn_activations || r.activations_attn || r.attention_probs || null;
    const ffnActs = r.ffn_activations || r.activations_ffn || r.activations || null;

    const snapshot: NIGSnapshot = {
      version: 2,
      id: doc._id || `snapshot-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      query: inputs.query || '',
      passage: inputs.passage || '',
      baselineLabel: inputs.baselineLabel || '',
      numReps: inputs.numReps || 1,
      data: nig,
      activations: { attention: attnActs, ffn: ffnActs },
    };

    return snapshot;
  }

  // Save a snapshot to backend
  async saveSnapshot(snapshot: NIGSnapshot) {
    try {
      console.log('[NIG SNAPSHOTS] Saving to backend...');
      
      // Save to backend dataStore
      const saved = await this.snapshotService.create(snapshot);
      
      // Update local cache
      this.snapshots.push(saved);
      
      // Keep last 20 in memory
      if (this.snapshots.length > 20) {
        this.snapshots = this.snapshots.slice(-20);
      }
      
      this.notify();
      console.log('[NIG SNAPSHOTS] ✓ Saved to backend; total in cache:', this.snapshots.length);
    } catch (e) {
      console.error('[NIG SNAPSHOTS] Failed to save to backend:', e);
    }
  }

  // Clear all snapshots from backend
  async clearSnapshots() {
    try {
      console.log('[NIG SNAPSHOTS] Clearing all snapshots from backend...');
      
      // Delete all snapshots from backend
      for (const snapshot of this.snapshots) {
        if (snapshot.id) {
          await this.snapshotService.remove(snapshot.id);
        }
      }
      
      this.snapshots = [];
      this.notify();
      console.log('[NIG SNAPSHOTS] ✓ Cleared all snapshots');
    } catch (e) {
      console.error('[NIG SNAPSHOTS] Failed to clear snapshots:', e);
    }
  }

  // Get snapshot by index
  getSnapshot(index: number): NIGSnapshot | null {
    return this.snapshots[index] || null;
  }
}

// Singleton instance
export const snapshotManager = new NIGSnapshotManager();
