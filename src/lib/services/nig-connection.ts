/**
 * NIGConnection - Minimal service layer for Marcelle backend integration
 * 
 * This is a thin wrapper that:
 * 1. Creates model instances (igModel, nigModel)
 * 2. Provides access to dataset service
 * 3. Exposes streams for subscription
 * 
 */

import { store } from '$lib/marcelle/store';
import { nigModel } from '$lib/marcelle/components';
import { snapshotManager } from './nig-snapshots';

export class NIGConnection {
  // Model instances
  igModelInstance: any;
  nigModelInstance: any;
  forwardPassModelInstance: any;
  prunedForwardPassModelInstance: any;
  conditionalNigModelInstance: any;
  datasetService: any;

  // Input components (for snapshot restoration)
  queryInput: any = null;
  passageInput: any = null;
  passageInput2: any = null;
  numRepsInput: any = null;
  baselineValue: any = null;

  // Global state variables (from index.js)
  samplesReady = false;
  selectedQueryId: string | null = null;
  currentNigId: string | null = null;
  lastNIGRequestInputs: any = null;
  globalNigExtent: [number, number] | null = null;
  globalNigAbsMax: number | null = null;
  globalAttnActivationExtent: [number, number] | null = null;
  globalFFNActivationExtent: [number, number] | null = null;

  // Conditional NIG state management
  originalNigData: any = null;  // Store original NIG data before conditional computation
  originalThreshold: number | null = null; // Store original threshold value
  isConditionalMode = false;    // Track if we're in conditional mode
  conditionalTarget: any = null; // Current conditional target info

  constructor() {
    // Create model instances (from index.js lines 14-15)
    this.igModelInstance = nigModel(store, 'predictions');
    this.nigModelInstance = nigModel(store, 'nig-values');
    this.forwardPassModelInstance = nigModel(store, 'forward-pass');
    this.prunedForwardPassModelInstance = nigModel(store, 'pruned-forward-pass');
    this.conditionalNigModelInstance = nigModel(store, 'conditional-nig');
    
    // Get dataset service (from index.js line 35)
    this.datasetService = store.service('msmarco-samples');

    // Subscribe to NIG results for auto-saving snapshots
    this.setupSnapshotAutoSave();
  }

  // Auto-save NIG snapshots (from index.js lines 618-628)
  private setupSnapshotAutoSave() {
    this.nigModelInstance.$data.subscribe(async (doc: any) => {
      // Only snapshot fresh computations, not injected snapshots or conditional NIG results
      if (doc && doc.result && doc.result.subset_b && !doc.__fromSnapshot && !doc.__isConditional) {
        const snapshot = snapshotManager.createSnapshot(doc, this.lastNIGRequestInputs || {});
        if (snapshot) {
          await snapshotManager.saveSnapshot(snapshot);
          console.log('[NIG CONNECTION] Auto-saved snapshot to backend');
        }
      }
    });
  }

  // Load a snapshot into the NIG model stream (from index.js lines 225-280)
  loadSnapshot(snapshot: any) {
    if (!snapshot || !snapshot.data) {
      console.warn('[NIG CONNECTION] Cannot load snapshot - missing data');
      return;
    }

    console.log('[NIG CONNECTION] Loading snapshot id=', snapshot.id);

    // Restore input values (from Nig-Viz lines 236-269)
    this.lastNIGRequestInputs = {
      query: snapshot.query,
      passage: snapshot.passage,
      baselineLabel: snapshot.baselineLabel,
      numReps: snapshot.numReps,
    };

    // Restore query input UI (add to options if not present)
    if (snapshot.query && this.queryInput) {
      console.log('[NIG CONNECTION] Restoring query:', snapshot.query);
      const currentQueries = this.queryInput.options || [];
      if (!currentQueries.includes(snapshot.query)) {
        const newList = [...currentQueries, snapshot.query];
        this.queryInput.updateOptions(newList);
        console.log('[NIG CONNECTION] Added query to options');
      }
      this.queryInput.$value.next(snapshot.query);
      console.log('[NIG CONNECTION] Set query value in UI');
    } else {
      console.warn('[NIG CONNECTION] Cannot restore query - queryInput not registered:', !!this.queryInput);
    }

    // Restore passage input UI (add to options if not present)
    if (snapshot.passage && this.passageInput) {
      console.log('[NIG CONNECTION] Restoring passage:', snapshot.passage.substring(0, 50) + '...');
      const currentPassages = this.passageInput.options || [];
      if (!currentPassages.includes(snapshot.passage)) {
        const newPassages = [...currentPassages, snapshot.passage];
        this.passageInput.updateOptions(newPassages);
        console.log('[NIG CONNECTION] Added passage to options');
      }
      this.passageInput.$value.next(snapshot.passage);
      console.log('[NIG CONNECTION] Set passage value in UI');
    } else {
      console.warn('[NIG CONNECTION] Cannot restore passage - passageInput not registered:', !!this.passageInput);
    }

    // Restore baseline selection
    if (snapshot.baselineLabel && this.baselineValue) {
      console.log('[NIG CONNECTION] Restoring baseline:', snapshot.baselineLabel);
      this.baselineValue.set(snapshot.baselineLabel);
    }

    // Restore repetitions
    if (typeof snapshot.numReps === 'number' && snapshot.numReps > 0 && this.numRepsInput) {
      console.log('[NIG CONNECTION] Restoring numReps:', snapshot.numReps);
      this.numRepsInput.$value.next(snapshot.numReps);
    }

    // Inject snapshot into model stream
    try {
      const resultPayload: any = { subset_b: snapshot.data };
      
      // Include activations if available
      if (snapshot.activations) {
        if (snapshot.activations.attention) {
          resultPayload.attn_activations = snapshot.activations.attention;
        }
        if (snapshot.activations.ffn) {
          resultPayload.ffn_activations = snapshot.activations.ffn;
        }
      }

      // Mark as snapshot to prevent re-snapshotting
      this.nigModelInstance.$data.next({
        _id: `snapshot-${snapshot.id}`,
        __fromSnapshot: true,
        result: resultPayload
      });

      console.log('[NIG CONNECTION] Snapshot loaded successfully, UI inputs restored');
    } catch (e) {
      console.error('[NIG CONNECTION] Failed to load snapshot:', e);
    }
  }

  // Expose streams for direct subscription
  get igData$() {
    return this.igModelInstance.$data;
  }

  get igStatus$() {
    return this.igModelInstance.$status;
  }

  get nigData$() {
    return this.nigModelInstance.$data;
  }

  get nigStatus$() {
    return this.nigModelInstance.$status;
  }

  get forwardPassData$() {
    return this.forwardPassModelInstance.$data;
  }

  get prunedForwardPassData$() {
    return this.prunedForwardPassModelInstance.$data;
  }

  // Helper to get baseline type (from index.js lines 433-437)
  getBaselineType(selectedBaseline: string): number {
    return selectedBaseline === 'Only Padded Tokens' ? 0
      : selectedBaseline === 'Padded Query and Passage (Special Tokens Preserved)' ? 1
      : selectedBaseline === 'Padded Query (Special Tokens Preserved)' ? 2
      : 1; // default
  }

  // Submit IG prediction (from index.js lines 440-449)
  submitIG(params: { query: string; passage: string; passage2?: string; numReps: number; baselineLabel: string }) {
    const passage = params.passage + (params.passage2 ? (' \n\n' + params.passage2) : '');
    
    this.igModelInstance.predict({
      query: params.query,
      passage,
      num_reps: params.numReps,
      baseline_type: this.getBaselineType(params.baselineLabel),
      type: 'ig'
    });
  }

  // Submit NIG prediction (from index.js lines 452-472)
  submitNIG(params: { query: string; passage: string; numReps: number; baselineLabel: string }) {
    // Capture inputs at submit time for snapshot metadata (from index.js lines 457-462)
    this.lastNIGRequestInputs = {
      query: params.query,
      passage: params.passage,
      baselineLabel: params.baselineLabel,
      numReps: params.numReps,
    };

    this.nigModelInstance.predict({
      query: params.query,
      passage: params.passage,
      num_reps: params.numReps,
      baseline_type: this.getBaselineType(params.baselineLabel),
      type: 'nig'
    });
  }

  // Request dataset samples (from index.js line 113)
  requestSamples(params: { n?: number; subset?: string; query_id?: string } = {}) {
    const { n = 10, subset = 'Random', query_id } = params;
    
    if (query_id) {
      this.datasetService.create({ subset, query_id });
    } else {
      this.datasetService.create({ n, subset });
    }
  }

  // Submit forward pass (from Nig-Viz index.js lines 1126-1131)
  submitForwardPass(query: string, passage: string) {
    this.forwardPassModelInstance.predict({
      query,
      passage,
    });
  }

  // Submit pruned forward pass (from Nig-Viz index.js lines 1134-1184)
  submitPrunedForwardPass(params: {
    query: string;
    passage: string;
    attentionThreshold: number;
    ffnThreshold: number;
    pruningEnabled: boolean;
    pruningRules?: any[];
    pruningTargets?: any[];
    pruningEdges?: any[];
  }) {
    this.prunedForwardPassModelInstance.predict({
      query: params.query,
      passage: params.passage,
      pruning_percentage_attention: params.attentionThreshold,
      pruning_percentage_ffn: params.ffnThreshold,
      pruning_enabled: params.pruningEnabled,
      pruning_rules: params.pruningRules || [],
      pruning_targets: params.pruningTargets || [],
      pruning_edges: params.pruningEdges || [],
    });
  }

  // Conditional NIG stream
  get conditionalNigData$() {
    return this.conditionalNigModelInstance.$data;
  }

  get conditionalNigStatus$() {
    return this.conditionalNigModelInstance.$status;
  }

  // Submit conditional NIG computation
  submitConditionalNIG(params: {
    query: string;
    passage: string;
    numReps: number;
    layerIdx: number;
    neuronIdx: number;
    neuronType: 'attention' | 'ffn';
    sourceInputPart?: 'cls' | 'query' | 'sep_1' | 'document' | 'sep_2' | null;
    targetInputPart?: 'cls' | 'query' | 'sep_1' | 'document' | 'sep_2' | null;
  }) {
    console.log('[NIG CONNECTION] Submitting conditional NIG request:', params);
    
    // Save target info for later use
    this.conditionalTarget = {
      layerIdx: params.layerIdx,
      neuronIdx: params.neuronIdx,
      neuronType: params.neuronType,
      sourceInputPart: params.sourceInputPart,
      targetInputPart: params.targetInputPart
    };
    
    this.conditionalNigModelInstance.predict({
      query: params.query,
      passage: params.passage,
      num_reps: params.numReps,
      layer_idx: params.layerIdx,
      neuron_idx: params.neuronIdx,
      neuron_type: params.neuronType,
      source_input_part: params.sourceInputPart || null,
      target_input_part: params.targetInputPart || null,
    });
  }

  // Save original NIG data before entering conditional mode
  saveOriginalNigData(nigResult: any, currentThreshold?: number) {
    if (!this.originalNigData) {
      this.originalNigData = JSON.parse(JSON.stringify(nigResult));
      console.log('[NIG CONNECTION] Saved original NIG data');
    }
    if (currentThreshold !== undefined && this.originalThreshold === null) {
      this.originalThreshold = currentThreshold;
      console.log('[NIG CONNECTION] Saved original threshold:', currentThreshold);
    }
  }

  // Enter conditional mode - replaces NIG data with conditional results
  enterConditionalMode(conditionalResult: any) {
    this.isConditionalMode = true;
    console.log('[NIG CONNECTION] Entered conditional mode, target:', this.conditionalTarget);
    
    // Inject conditional NIG result into the main NIG stream
    // This will update the architecture and table views
    this.nigModelInstance.$data.next({
      _id: `conditional-${Date.now()}`,
      __isConditional: true,
      __conditionalTarget: this.conditionalTarget,
      result: {
        subset_b: conditionalResult.subset_b,
        // No activations in conditional mode
        attn_activations: {},
        ffn_activations: {},
      }
    });
  }

  // Exit conditional mode - restore original NIG data
  exitConditionalMode() {
    if (!this.originalNigData) {
      console.warn('[NIG CONNECTION] No original NIG data to restore');
      return;
    }
    
    this.isConditionalMode = false;
    this.conditionalTarget = null;
    
    // Restore original NIG data
    this.nigModelInstance.$data.next({
      _id: `restored-${Date.now()}`,
      __isConditional: false,
      result: this.originalNigData
    });
    
    console.log('[NIG CONNECTION] Exited conditional mode, restored original NIG data');
  }

  // Clear original NIG data (call when new NIG computation is done)
  clearOriginalNigData() {
    this.originalNigData = null;
    this.originalThreshold = null;
    this.isConditionalMode = false;
    this.conditionalTarget = null;
  }

  // Get saved original threshold for restoration
  getOriginalThreshold(): number | null {
    return this.originalThreshold;
  }
}

// Singleton instance
export const nigConnection = new NIGConnection();
