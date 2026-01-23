// Prune Snapshot Management Service


import { store } from '$lib/marcelle/store';

export interface PruneSnapshot {
  id: string;
  timestamp: string;
  name: string; // User-provided or auto-generated name
  // Pruning configuration
  rules: Array<{ layer: string; tokenType: string }>;
  targets: Array<{ layer: string; type: string; index: number; tokenType: string }>;
  edges: Array<{ layer: string; srcToken: string; tgtToken: string }>;
  thresholds: { attention: number; ffn: number };
  // Optional: store associated NIG snapshot id for context
  nigSnapshotId?: string;
  // Optional: store query/passage for context
  query?: string;
  passage?: string;
}

export class PruneSnapshotManager {
  private snapshots: PruneSnapshot[] = [];
  private listeners: Set<() => void> = new Set();
  private snapshotService: any;
  private isLoading = false;

  constructor() {
    // Use Marcelle backend service for persistence
    this.snapshotService = store.service('prune-snapshots');
    this.loadFromBackend();
  }

  // Public method to reload snapshots (call after authentication)
  reload() {
    this.loadFromBackend();
  }

  // Load snapshots from backend
  private async loadFromBackend() {
    if (this.isLoading) return;
    this.isLoading = true;
    
    try {
      console.log('[PRUNE SNAPSHOTS] Loading from backend...');
      
      // Query backend for snapshots, sorted by creation time
      const result = await this.snapshotService.find({
        query: {
          $sort: { createdAt: -1 },
          $limit: 50
        }
      });
      
      if (result && result.data && Array.isArray(result.data)) {
        this.snapshots = result.data;
        console.log('[PRUNE SNAPSHOTS] ✓ Loaded', this.snapshots.length, 'snapshots from backend');
        this.notify();
      } else {
        console.log('[PRUNE SNAPSHOTS] No snapshots found in backend');
      }
    } catch (e) {
      console.error('[PRUNE SNAPSHOTS] Failed to load from backend:', e);
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
  getSnapshots(): PruneSnapshot[] {
    return [...this.snapshots];
  }

  // Get latest snapshot
  getLatest(): PruneSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  // Create snapshot from current pruning state
  createSnapshot(
    pruningState: {
      rules: any[];
      targets: any[];
      edges: any[];
      thresholds: { attention?: number; ffn?: number };
    },
    name?: string,
    context?: { query?: string; passage?: string; nigSnapshotId?: string }
  ): PruneSnapshot {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Auto-generate name if not provided
    const autoName = name || this.generateAutoName(pruningState);

    const snapshot: PruneSnapshot = {
      id: `prune-${Date.now()}`,
      timestamp,
      name: autoName,
      rules: pruningState.rules || [],
      targets: pruningState.targets || [],
      edges: pruningState.edges || [],
      thresholds: {
        attention: pruningState.thresholds?.attention || 0,
        ffn: pruningState.thresholds?.ffn || 0
      },
      query: context?.query,
      passage: context?.passage,
      nigSnapshotId: context?.nigSnapshotId
    };

    return snapshot;
  }

  // Generate a descriptive name for the prune
  private generateAutoName(pruningState: any): string {
    const parts: string[] = [];
    
    if (pruningState.rules?.length > 0) {
      parts.push(`${pruningState.rules.length} node${pruningState.rules.length > 1 ? 's' : ''}`);
    }
    if (pruningState.targets?.length > 0) {
      parts.push(`${pruningState.targets.length} target${pruningState.targets.length > 1 ? 's' : ''}`);
    }
    if (pruningState.edges?.length > 0) {
      parts.push(`${pruningState.edges.length} edge${pruningState.edges.length > 1 ? 's' : ''}`);
    }
    
    const attnPct = (pruningState.thresholds?.attention || 0) * 100;
    const ffnPct = (pruningState.thresholds?.ffn || 0) * 100;
    if (attnPct > 0 || ffnPct > 0) {
      parts.push(`A:${attnPct.toFixed(1)}% F:${ffnPct.toFixed(1)}%`);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'Empty prune';
  }

  // Format snapshot label for display
  formatSnapshotLabel(snapshot: PruneSnapshot): string {
    return `${snapshot.timestamp} | ${snapshot.name}`;
  }

  // Save a snapshot to backend
  async saveSnapshot(snapshot: PruneSnapshot) {
    try {
      console.log('[PRUNE SNAPSHOTS] Saving to backend...');
      
      // Save to backend dataStore
      const saved = await this.snapshotService.create(snapshot);
      
      // Update local cache
      this.snapshots.push(saved);
      
      // Keep last 50 in memory
      if (this.snapshots.length > 50) {
        this.snapshots = this.snapshots.slice(-50);
      }
      
      this.notify();
      console.log('[PRUNE SNAPSHOTS] ✓ Saved to backend; total in cache:', this.snapshots.length);
      return saved;
    } catch (e) {
      console.error('[PRUNE SNAPSHOTS] Failed to save to backend:', e);
      return null;
    }
  }

  // Delete a specific snapshot
  async deleteSnapshot(snapshotId: string) {
    try {
      console.log('[PRUNE SNAPSHOTS] Deleting snapshot:', snapshotId);
      
      await this.snapshotService.remove(snapshotId);
      this.snapshots = this.snapshots.filter(s => s.id !== snapshotId);
      this.notify();
      
      console.log('[PRUNE SNAPSHOTS] ✓ Deleted snapshot');
    } catch (e) {
      console.error('[PRUNE SNAPSHOTS] Failed to delete snapshot:', e);
    }
  }

  // Clear all snapshots from backend
  async clearSnapshots() {
    try {
      console.log('[PRUNE SNAPSHOTS] Clearing all snapshots from backend...');
      
      // Delete all snapshots from backend
      for (const snapshot of this.snapshots) {
        if (snapshot.id) {
          await this.snapshotService.remove(snapshot.id);
        }
      }
      
      this.snapshots = [];
      this.notify();
      console.log('[PRUNE SNAPSHOTS] ✓ Cleared all snapshots');
    } catch (e) {
      console.error('[PRUNE SNAPSHOTS] Failed to clear snapshots:', e);
    }
  }

  // Get snapshot by id
  getSnapshotById(id: string): PruneSnapshot | null {
    return this.snapshots.find(s => s.id === id) || null;
  }

  // Get snapshot by index
  getSnapshot(index: number): PruneSnapshot | null {
    return this.snapshots[index] || null;
  }
}

// Singleton instance
export const pruneSnapshotManager = new PruneSnapshotManager();
