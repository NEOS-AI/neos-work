/**
 * Design Project types (v0.5.0 / PLAN_FOR_V0_5_0 M1).
 *
 * Dual surface: Workflow (Cowork) + Design Project (Open Design–style file workspace).
 * EditContext powers selection-scoped AI refine (Design Editor gate).
 */

// ── Design Project ─────────────────────────────────────────

export interface DesignProject {
  id: string;
  name: string;
  /** Absolute workspace root (default under ~/.config/neos-work/projects/<id> or imported baseDir). */
  baseDir: string;
  /** Relative entry file within baseDir (e.g. index.html). */
  entryFile: string | null;
  designSystemId: string | null;
  /** Free-form metadata (JSON-serializable). */
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDesignProjectInput {
  name: string;
  /** Optional pre-existing absolute directory (folder import, copy-free). */
  baseDir?: string;
  entryFile?: string | null;
  designSystemId?: string | null;
  meta?: Record<string, unknown>;
}

export interface UpdateDesignProjectInput {
  name?: string;
  baseDir?: string;
  entryFile?: string | null;
  designSystemId?: string | null;
  meta?: Record<string, unknown>;
}

// ── Project conversations / messages (chat surface) ────────

export interface ProjectConversation {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string | null;
  createdAt: string;
}

// ── File registry ──────────────────────────────────────────

export interface ProjectFileEntry {
  /** Project-relative path (posix-style, no leading slash). */
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
  /** True when path is the project entry file. */
  isEntry?: boolean;
}

/**
 * Live file read payload (GET …/files/*). Uses `hash` not revision contentHash.
 * Revisions use `contentHash`; live file IO uses `hash`.
 */
export interface ProjectFileContent {
  path: string;
  content: string;
  hash: string;
}

/** Live file write payload (PUT …/files/*). */
export interface ProjectFileWriteResult {
  path: string;
  hash: string;
  bytes: number;
  created: boolean;
}

/** Project file SSE event payload fields (event type is SSE event name). */
export interface ProjectFileEventPayload {
  projectId?: string;
  path?: string;
  source?: string;
  /** Content hash of written tip (live domain uses `hash`). */
  hash?: string;
  ts?: string;
}

export type FileRevisionSource = 'user' | 'agent' | 'import' | 'restore';

export interface FileRevision {
  id: string;
  projectId: string;
  /** Project-relative path. */
  path: string;
  contentHash: string;
  /** Optional content snapshot (may be omitted on list). */
  content?: string;
  source: FileRevisionSource;
  createdAt: string;
}

// ── Preview comments (OD preview_comments) ─────────────────

export interface PreviewComment {
  id: string;
  projectId: string;
  filePath: string;
  /** CSS selector or path-like selector for the element. */
  selector: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

// ── Edit with AI context (Design Editor) ───────────────────

export type EditContextMode = 'patch' | 'replace-selection' | 'replace-file';

export interface EditContextSelectionLines {
  startLine: number;
  endLine: number;
}

export interface EditContextSelectionSelector {
  selector: string;
}

export interface EditContext {
  filePath: string;
  selection?: EditContextSelectionLines | EditContextSelectionSelector;
  /** OuterHTML or code slice for the selection. */
  snippet?: string;
  /**
   * Default product mode is `replace-selection` or `patch` (Q10 LOCKED).
   * `replace-file` requires explicit user confirmation in UI.
   */
  mode: EditContextMode;
}

export function isEditContextSelectionLines(
  s: EditContext['selection'],
): s is EditContextSelectionLines {
  return (
    !!s &&
    typeof s === 'object' &&
    'startLine' in s &&
    'endLine' in s &&
    typeof (s as EditContextSelectionLines).startLine === 'number' &&
    typeof (s as EditContextSelectionLines).endLine === 'number'
  );
}

export function isEditContextSelectionSelector(
  s: EditContext['selection'],
): s is EditContextSelectionSelector {
  return (
    !!s &&
    typeof s === 'object' &&
    'selector' in s &&
    typeof (s as EditContextSelectionSelector).selector === 'string'
  );
}

/** Normalize / validate EditContext for API ingestion. Returns null if invalid. */
export function normalizeEditContext(raw: unknown): EditContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.filePath !== 'string' || /[\0\r\n]/.test(o.filePath)) return null;
  const filePath = o.filePath.trim().replace(/^\/+/, '');
  if (!filePath || filePath.length > 1_000) return null;

  let mode: EditContextMode = 'replace-selection';
  if (o.mode === 'patch' || o.mode === 'replace-selection' || o.mode === 'replace-file') {
    mode = o.mode;
  } else if (o.mode != null) {
    return null;
  }

  let selection: EditContext['selection'];
  if (o.selection != null) {
    if (typeof o.selection !== 'object' || Array.isArray(o.selection)) return null;
    const sel = o.selection as Record<string, unknown>;
    // Prefer selector when present; do not accept mixed/ambiguous partials.
    if ('selector' in sel) {
      if (typeof sel.selector !== 'string' || /[\0\r\n]/.test(sel.selector)) return null;
      const selector = sel.selector.trim();
      if (!selector || selector.length > 2_000) return null;
      selection = { selector };
    } else if ('startLine' in sel || 'endLine' in sel) {
      if (
        typeof sel.startLine !== 'number' ||
        typeof sel.endLine !== 'number' ||
        !Number.isFinite(sel.startLine) ||
        !Number.isFinite(sel.endLine)
      ) {
        return null;
      }
      const startLine = Math.floor(sel.startLine);
      const endLine = Math.floor(sel.endLine);
      if (startLine < 1 || endLine < startLine || endLine > 1_000_000) return null;
      selection = { startLine, endLine };
    } else {
      return null;
    }
  }

  let snippet: string | undefined;
  if (typeof o.snippet === 'string') {
    if (/\0/.test(o.snippet)) return null;
    if (o.snippet.length > 512 * 1024) return null;
    snippet = o.snippet;
  }

  return { filePath, selection, snippet, mode };
}

// ── Runs (project chat + shared run registry / /api/runs wire) ────────

export type ProjectRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** SSE / event-log type strings for project agent runs. */
export type ProjectRunEventType =
  | 'run.started'
  | 'run.stdout'
  | 'run.stderr'
  | 'run.progress'
  | 'run.tool'
  | 'run.files_changed'
  | 'run.succeeded'
  | 'run.failed'
  | 'run.canceled';

export interface ProjectRunEvent {
  id: string;
  type: ProjectRunEventType | string;
  ts: string;
  data?: unknown;
}

/**
 * Public run summary for list/get/create/cancel responses.
 * Prefer this over full ProjectRun when events are not inlined (eventCount only).
 */
export interface ProjectRunSummary {
  id: string;
  status: ProjectRunStatus | string;
  agentId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  prompt?: string;
  editContext?: EditContext | unknown | null;
  provider?: string | null;
  error?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  eventCount?: number;
  /**
   * Optional collab presence session bound at run create (v0.11 M0 / Q35).
   * Used as lock identity for agent writes when hard-enforce is on.
   * Not an auth credential.
   */
  collabSessionId?: string | null;
}

export interface ProjectRun {
  id: string;
  projectId: string;
  conversationId?: string | null;
  status: ProjectRunStatus;
  prompt?: string;
  editContext?: EditContext | null;
  provider?: string | null;
  agentId?: string | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

const RUN_TERMINAL = new Set([
  'succeeded',
  'failed',
  'canceled',
  'cancelled',
  'error',
]);

const RUN_ACTIVE = new Set(['queued', 'running', 'starting', 'pending']);

/** True when status is terminal (including common wire/UI aliases). */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  if (!status || typeof status !== 'string') return false;
  return RUN_TERMINAL.has(status.trim().toLowerCase());
}

/** True when cancel / busy UI still applies. */
export function isActiveRunStatus(status: string | null | undefined): boolean {
  if (!status || typeof status !== 'string') return false;
  const s = status.trim().toLowerCase();
  if (RUN_TERMINAL.has(s)) return false;
  return RUN_ACTIVE.has(s) || s.length > 0;
}

/** Map loose status strings to a canonical ProjectRunStatus when possible. */
export function normalizeRunStatus(status: string | null | undefined): ProjectRunStatus | string {
  if (!status || typeof status !== 'string') return 'queued';
  const s = status.trim().toLowerCase();
  if (s === 'cancelled') return 'canceled';
  if (s === 'error') return 'failed';
  if (
    s === 'queued'
    || s === 'running'
    || s === 'succeeded'
    || s === 'failed'
    || s === 'canceled'
  ) {
    return s;
  }
  return status.trim();
}

// ── Live artifact (project-scoped; full CRUD in M4 / Task 9) ────────

export interface LiveArtifact {
  id: string;
  projectId: string;
  name: string;
  sourceTemplate?: string | null;
  inputs?: Record<string, unknown>;
  content?: string | null;
  contentType?: string;
  /** Project-relative sidecar path under .neos-work/live-artifacts/ */
  sidecarPath?: string | null;
  refreshCount?: number;
  lastRefreshedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveArtifactRefresh {
  id: string;
  artifactId: string;
  status: 'succeeded' | 'failed';
  contentHash?: string | null;
  error?: string | null;
  createdAt: string;
}

// ── Plugin snapshot pin (M3 placeholder contract) ──────────

export interface PluginSnapshot {
  id: string;
  pluginId: string;
  name: string;
  /** Frozen prompt fragments / tool gates. */
  fragments: Record<string, unknown>;
  createdAt: string;
}

// ── Layers tree (Design Editor; client model for M3) ───────

export interface LayerNode {
  id: string;
  tag: string;
  name: string;
  selector: string;
  depth: number;
  children: LayerNode[];
  visible: boolean;
  locked: boolean;
  sourceRange?: { start: number; end: number };
}

export interface SelectionState {
  filePath: string;
  selector?: string;
  layerId?: string;
  sourceRange?: { start: number; end: number };
  /**
   * Full multi-select ordered selectors (last = primary). v0.8 M3 collab broadcast.
   * Omitted or length ≤ 1 when single selection.
   */
  multiSelectors?: string[];
  /** Parallel layer ids for multi-select (same order as multiSelectors when present). */
  multiLayerIds?: string[];
}
