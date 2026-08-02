/**
 * Design Editor dirty / disk conflict state machine (v0.5 Task 1b).
 *
 * Disk is SSOT after save. Local buffer may be dirty while editing.
 * When agent (or external) write lands with a different disk tip while dirty,
 * enter conflict — UI offers Keep mine / Take agent / Diff.
 */

export type ConflictChoice = 'keep-mine' | 'take-agent' | 'diff';

export interface EditorBufferState {
  /** Project-relative path currently open (null = none). */
  path: string | null;
  /** Local editor buffer. */
  local: string;
  /** Last known saved/disk tip content. */
  disk: string;
  /** Content hash of disk tip (optional, for cheap compare). */
  diskHash?: string | null;
  /**
   * When set, agent/external write arrived while local !== disk.
   * Holds the incoming disk content awaiting resolution.
   */
  pendingDisk: string | null;
  pendingDiskHash?: string | null;
}

export type EditorBufferEvent =
  | { type: 'open'; path: string; content: string; hash?: string | null }
  | { type: 'edit'; content: string }
  | { type: 'saved'; content: string; hash?: string | null }
  | { type: 'disk-changed'; content: string; hash?: string | null }
  | { type: 'resolve-conflict'; choice: ConflictChoice; merged?: string };

export function createEmptyBuffer(): EditorBufferState {
  return {
    path: null,
    local: '',
    disk: '',
    diskHash: null,
    pendingDisk: null,
    pendingDiskHash: null,
  };
}

export function isDirty(state: EditorBufferState): boolean {
  return state.path != null && state.local !== state.disk;
}

export function isConflict(state: EditorBufferState): boolean {
  return state.pendingDisk != null;
}

/**
 * Whether an SSE/file event with optional content hash needs a disk re-fetch.
 * When the event hash matches the known disk (or pending conflict) tip, skip
 * network read — content is unchanged (v0.5.28+ server publishes hash).
 */
export function shouldSkipDiskReload(
  state: EditorBufferState,
  event: { path?: string | null; hash?: string | null },
): boolean {
  if (state.path == null) return true;
  const p = typeof event.path === 'string' ? event.path : '';
  if (p && p !== state.path) return true;
  const hash = typeof event.hash === 'string' && event.hash ? event.hash : null;
  if (!hash) return false;
  if (state.pendingDisk != null) {
    return state.pendingDiskHash != null && state.pendingDiskHash === hash;
  }
  return state.diskHash != null && state.diskHash === hash;
}

export function reduceEditorBuffer(
  state: EditorBufferState,
  event: EditorBufferEvent,
): EditorBufferState {
  switch (event.type) {
    case 'open': {
      const content = typeof event.content === 'string' ? event.content : '';
      return {
        path: event.path,
        local: content,
        disk: content,
        diskHash: event.hash ?? null,
        pendingDisk: null,
        pendingDiskHash: null,
      };
    }
    case 'edit': {
      if (state.path == null) return state;
      return { ...state, local: event.content };
    }
    case 'saved': {
      if (state.path == null) return state;
      const content = typeof event.content === 'string' ? event.content : state.local;
      return {
        ...state,
        local: content,
        disk: content,
        diskHash: event.hash ?? state.diskHash ?? null,
        // Clear conflict if saved content matches pending (user chose keep and saved)
        pendingDisk:
          state.pendingDisk != null && state.pendingDisk !== content
            ? state.pendingDisk
            : null,
        pendingDiskHash:
          state.pendingDisk != null && state.pendingDisk !== content
            ? state.pendingDiskHash
            : null,
      };
    }
    case 'disk-changed': {
      if (state.path == null) return state;
      const incoming = typeof event.content === 'string' ? event.content : '';
      const hash = event.hash ?? null;
      // Same content hash as known disk tip — ignore (even without content compare)
      if (hash != null && state.diskHash != null && hash === state.diskHash) {
        return state;
      }
      // Same as current disk content — ignore
      if (incoming === state.disk && (hash == null || hash === state.diskHash)) {
        return state;
      }
      // Already conflicting on the same pending tip
      if (
        state.pendingDisk != null
        && ((hash != null && state.pendingDiskHash === hash) || incoming === state.pendingDisk)
      ) {
        return state;
      }
      // Clean buffer: accept disk tip
      if (state.local === state.disk) {
        return {
          ...state,
          local: incoming,
          disk: incoming,
          diskHash: hash,
          pendingDisk: null,
          pendingDiskHash: null,
        };
      }
      // Dirty: enter conflict
      return {
        ...state,
        pendingDisk: incoming,
        pendingDiskHash: hash,
      };
    }
    case 'resolve-conflict': {
      if (state.pendingDisk == null) return state;
      if (event.choice === 'keep-mine') {
        // Keep local; adopt pending as new disk baseline only after explicit save.
        // Mark disk as pending tip so next save overwrites agent version.
        return {
          ...state,
          disk: state.pendingDisk,
          diskHash: state.pendingDiskHash ?? null,
          pendingDisk: null,
          pendingDiskHash: null,
          // local stays → still dirty vs new disk if different
        };
      }
      if (event.choice === 'take-agent') {
        return {
          ...state,
          local: state.pendingDisk,
          disk: state.pendingDisk,
          diskHash: state.pendingDiskHash ?? null,
          pendingDisk: null,
          pendingDiskHash: null,
        };
      }
      // diff: apply merged buffer if provided; otherwise leave conflict open
      if (typeof event.merged === 'string') {
        return {
          ...state,
          local: event.merged,
          disk: state.pendingDisk,
          diskHash: state.pendingDiskHash ?? null,
          pendingDisk: null,
          pendingDiskHash: null,
        };
      }
      return state;
    }
    default:
      return state;
  }
}

/** Simple line-oriented unified-diff style summary for conflict UI. */
export function simpleDiffLines(a: string, b: string): {
  removed: number;
  added: number;
  same: number;
  preview: string[];
} {
  const la = a.split('\n');
  const lb = b.split('\n');
  const max = Math.max(la.length, lb.length);
  let removed = 0;
  let added = 0;
  let same = 0;
  const preview: string[] = [];
  for (let i = 0; i < max && preview.length < 40; i++) {
    const left = la[i];
    const right = lb[i];
    if (left === right) {
      same++;
      if (left !== undefined) preview.push(`  ${left}`);
    } else {
      if (left !== undefined) {
        removed++;
        preview.push(`- ${left}`);
      }
      if (right !== undefined) {
        added++;
        preview.push(`+ ${right}`);
      }
    }
  }
  return { removed, added, same, preview };
}
