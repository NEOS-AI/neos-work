/**
 * In-process pub/sub for Design Project file mutations (v0.5.28).
 * Powers GET /api/projects/:id/events/stream (file.changed SSE).
 */

export type ProjectFileEventType = 'file.changed' | 'file.deleted' | 'file.created';

export interface ProjectFileEvent {
  type: ProjectFileEventType;
  projectId: string;
  path: string;
  source?: string;
  hash?: string;
  ts: string;
}

type Listener = (event: ProjectFileEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const MAX_LISTENERS_PER_PROJECT = 64;

function normalizeProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return '';
  const id = projectId.trim();
  if (!id || id.length > 128) return '';
  return id;
}

function normalizePath(raw: string): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  let p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.length > 1_000) return '';
  if (p.includes('..')) return '';
  return p;
}

/** Subscribe to events for one project. Returns unsubscribe. */
export function subscribeProjectFileEvents(
  projectId: string,
  listener: Listener,
): () => void {
  const id = normalizeProjectId(projectId);
  if (!id) return () => {};
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  if (set.size >= MAX_LISTENERS_PER_PROJECT) {
    // Drop oldest (first) to avoid unbounded growth under reconnect storms
    const first = set.values().next().value;
    if (first) set.delete(first);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(id);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(id);
  };
}

/** Publish a file event to all subscribers of the project. */
export function publishProjectFileEvent(input: {
  type: ProjectFileEventType;
  projectId: string;
  path: string;
  source?: string;
  hash?: string;
}): void {
  const projectId = normalizeProjectId(input.projectId);
  const path = normalizePath(input.path);
  if (!projectId || !path) return;

  const source =
    typeof input.source === 'string' && !/[\0\r\n]/.test(input.source)
      ? input.source.trim().slice(0, 64)
      : undefined;
  const hash =
    typeof input.hash === 'string' && !/[\0\r\n]/.test(input.hash)
      ? input.hash.trim().slice(0, 128)
      : undefined;

  const event: ProjectFileEvent = {
    type: input.type,
    projectId,
    path,
    ...(source ? { source } : {}),
    ...(hash ? { hash } : {}),
    ts: new Date().toISOString(),
  };

  const set = listeners.get(projectId);
  if (!set || set.size === 0) return;
  for (const fn of [...set]) {
    try {
      fn(event);
    } catch {
      // never break publishers
    }
  }
}

/** Test helper: clear all listeners. */
export function clearProjectFileEventListeners(): void {
  listeners.clear();
}

/** Test helper: subscriber count for a project. */
export function projectFileEventListenerCount(projectId: string): number {
  const id = normalizeProjectId(projectId);
  return id ? (listeners.get(id)?.size ?? 0) : 0;
}
