/**
 * Shared collab event types (presence + locks + selection). Used by project-collab hub and CollabBus.
 */

export type PresencePeer = {
  sessionId: string;
  displayName: string;
  joinedAt: string;
  colorHint: number;
  lastSeen?: string;
};

export type FileLock = {
  path: string;
  sessionId: string;
  displayName: string;
  acquiredAt: string;
};

/** Peer editing awareness (v0.7 M2 + v0.8 M3 multi-select). */
export type PeerSelection = {
  sessionId: string;
  displayName: string;
  colorHint: number;
  /** Project-relative file path, or null when cleared. */
  path: string | null;
  /** Primary CSS / layer selector, or null when none. */
  selector: string | null;
  layerId?: string | null;
  /**
   * Full multi-select ordered (last = primary). Omitted when single/empty.
   * v0.8 M3 collab multi-selection broadcast.
   */
  selectors?: string[];
  /** Parallel layer ids when available (same order as selectors). */
  layerIds?: string[];
  updatedAt: string;
};

export type CollabEvent =
  | {
      type: 'presence.sync';
      projectId: string;
      self: PresencePeer;
      peers: PresencePeer[];
      locks: FileLock[];
      /** Current peer selections (including remote-mirrored). */
      selections: PeerSelection[];
      ts: string;
    }
  | { type: 'presence.join'; projectId: string; peer: PresencePeer; ts: string }
  | {
      type: 'presence.leave';
      projectId: string;
      sessionId: string;
      reason?: 'leave' | 'idle' | 'evicted';
      ts: string;
    }
  /** Lightweight liveness for multi-replica membership (v0.8 M0). */
  | {
      type: 'presence.heartbeat';
      projectId: string;
      sessionId: string;
      displayName?: string;
      colorHint?: number;
      ts: string;
    }
  | { type: 'lock.acquired'; projectId: string; lock: FileLock; ts: string }
  | { type: 'lock.released'; projectId: string; path: string; sessionId: string; ts: string }
  | {
      type: 'selection.changed';
      projectId: string;
      selection: PeerSelection;
      ts: string;
    };
