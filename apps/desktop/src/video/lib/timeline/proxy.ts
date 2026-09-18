import { useEffect, useRef, useState } from "react";
import { removeFile } from "@video/lib/tauri/timeline";
import { projectDuration, projectHash } from "./project";
import type { TimelineProject } from "./types";

export const PROXY_DEBOUNCE_MS = 800;

export type ProxyState = {
  hash: string | null;
  path: string | null;
  dirty: boolean;
  rendering: boolean;
};

export type ProxyRenderArgs = {
  project: TimelineProject;
  outputPath: string;
};

export type ProxyRenderFn = (args: ProxyRenderArgs) => Promise<void>;

const INITIAL_STATE: ProxyState = {
  hash: null,
  path: null,
  dirty: false,
  rendering: false,
};

/** projectHash is full JSON; filenames need a short, path-safe digest. */
function digestForFilename(hash: string): string {
  // Two 32-bit FNV-1a passes (offset seeds) → 16 hex chars; ES2017-safe.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < hash.length; i++) {
    const c = hash.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

export function proxyFilename(hash: string): string {
  return `video-rs-proxy-${digestForFilename(hash)}.mp4`;
}

export function isEmptyTimeline(project: TimelineProject): boolean {
  return projectDuration(project) <= 0;
}

export function isDirty(project: TimelineProject, readyHash: string | null): boolean {
  if (isEmptyTimeline(project)) return false;
  return projectHash(project) !== readyHash;
}

export async function proxyOutputPath(hash: string): Promise<string> {
  const { tempDir, join } = await import("@tauri-apps/api/path");
  const dir = await tempDir();
  return join(dir, proxyFilename(hash));
}

async function bestEffortRemove(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await removeFile(path);
  } catch {
    // ignore missing files / permission errors
  }
}

type CacheInternal = {
  state: ProxyState;
  latest: TimelineProject | null;
  timer: ReturnType<typeof setTimeout> | null;
  rendering: boolean;
  /** Debounce elapsed while a job was in flight — kick when it finishes. */
  pendingKick: boolean;
  /** hash currently being rendered */
  inFlightHash: string | null;
  /** path currently being written */
  inFlightPath: string | null;
  disposed: boolean;
};

export type ProxyCache = {
  getState: () => ProxyState;
  /** Observe project changes; debounces and may start a proxy render. */
  scheduleProxyRender: (project: TimelineProject) => void;
  subscribe: (listener: (state: ProxyState) => void) => () => void;
  dispose: () => void;
};

export type CreateProxyCacheOptions = {
  render: ProxyRenderFn;
  debounceMs?: number;
  onError?: (message: string) => void;
};

/**
 * Session proxy cache: dirty via projectHash, 800ms debounce, one render at a time.
 * Does not touch TimelineProject schema; path is session state only.
 */
export function createProxyCache(options: CreateProxyCacheOptions): ProxyCache {
  const debounceMs = options.debounceMs ?? PROXY_DEBOUNCE_MS;
  const listeners = new Set<(state: ProxyState) => void>();

  const internal: CacheInternal = {
    state: { ...INITIAL_STATE },
    latest: null,
    timer: null,
    rendering: false,
    pendingKick: false,
    inFlightHash: null,
    inFlightPath: null,
    disposed: false,
  };

  const emit = (next: ProxyState) => {
    internal.state = next;
    for (const listener of listeners) listener(next);
  };

  const clearTimer = () => {
    if (internal.timer != null) {
      clearTimeout(internal.timer);
      internal.timer = null;
    }
  };

  const snapshotDirty = (project: TimelineProject | null, readyHash: string | null): boolean => {
    if (!project || isEmptyTimeline(project)) return false;
    return projectHash(project) !== readyHash;
  };

  const runRender = async () => {
    if (internal.disposed || internal.rendering) return;

    const project = internal.latest;
    if (!project || isEmptyTimeline(project)) {
      emit({
        ...internal.state,
        dirty: false,
        rendering: false,
      });
      return;
    }

    const hash = projectHash(project);
    if (hash === internal.state.hash && internal.state.path) {
      emit({
        ...internal.state,
        dirty: false,
        rendering: false,
      });
      return;
    }

    let outputPath: string;
    try {
      outputPath = await proxyOutputPath(hash);
    } catch (err) {
      options.onError?.(String(err));
      emit({
        ...internal.state,
        dirty: snapshotDirty(internal.latest, internal.state.hash),
        rendering: false,
      });
      return;
    }

    const previousReadyPath = internal.state.path;
    // Drop prior ready file only when writing a different path (brief: cleanup).
    // Keep last-good until the new file is applied — delete after success below
    // if path differs. Also delete any abandoned in-flight path.
    if (internal.inFlightPath && internal.inFlightPath !== outputPath) {
      void bestEffortRemove(internal.inFlightPath);
    }

    internal.rendering = true;
    internal.inFlightHash = hash;
    internal.inFlightPath = outputPath;
    emit({
      ...internal.state,
      dirty: true,
      rendering: true,
    });

    try {
      await options.render({ project, outputPath });
    } catch (err) {
      if (!internal.disposed) {
        options.onError?.(String(err));
        void bestEffortRemove(outputPath);
        internal.rendering = false;
        internal.inFlightHash = null;
        internal.inFlightPath = null;
        emit({
          ...internal.state,
          dirty: snapshotDirty(internal.latest, internal.state.hash),
          rendering: false,
        });
        finishAndMaybeKick();
      }
      return;
    }

    if (internal.disposed) return;

    const latest = internal.latest;
    const stillCurrent = latest != null && projectHash(latest) === hash;

    internal.rendering = false;
    internal.inFlightHash = null;
    internal.inFlightPath = null;

    if (!stillCurrent) {
      // Stale in-flight result — do not apply; drop orphan output.
      void bestEffortRemove(outputPath);
      emit({
        ...internal.state,
        dirty: snapshotDirty(latest, internal.state.hash),
        rendering: false,
      });
      finishAndMaybeKick();
      return;
    }

    if (previousReadyPath && previousReadyPath !== outputPath) {
      void bestEffortRemove(previousReadyPath);
    }

    emit({
      hash,
      path: outputPath,
      dirty: false,
      rendering: false,
    });

    finishAndMaybeKick();
  };

  const needsRender = (): boolean => {
    const project = internal.latest;
    if (!project || isEmptyTimeline(project)) return false;
    const hash = projectHash(project);
    return hash !== internal.state.hash || !internal.state.path;
  };

  /** After a job ends: run immediately only if debounce already elapsed while busy. */
  const finishAndMaybeKick = () => {
    if (internal.disposed) return;
    if (!internal.pendingKick) return;
    internal.pendingKick = false;
    if (!needsRender()) return;
    queueMicrotask(() => {
      if (!internal.disposed && !internal.rendering && needsRender()) {
        void runRender();
      }
    });
  };

  const scheduleProxyRender = (project: TimelineProject) => {
    if (internal.disposed) return;
    internal.latest = project;

    if (isEmptyTimeline(project)) {
      clearTimer();
      internal.pendingKick = false;
      emit({
        ...internal.state,
        dirty: false,
        rendering: internal.rendering,
      });
      return;
    }

    const hash = projectHash(project);
    const upToDate = hash === internal.state.hash && internal.state.path != null;
    const dirty = !upToDate;

    emit({
      ...internal.state,
      dirty: dirty || internal.rendering,
      rendering: internal.rendering,
    });

    if (upToDate && !internal.rendering) {
      internal.pendingKick = false;
      return;
    }

    clearTimer();
    internal.timer = setTimeout(() => {
      internal.timer = null;
      if (internal.disposed) return;
      if (internal.rendering) {
        // One job at a time; kick when the current job ends.
        internal.pendingKick = true;
        return;
      }
      void runRender();
    }, debounceMs);
  };

  return {
    getState: () => internal.state,
    scheduleProxyRender,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      internal.disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
}

export type UseTimelineProxyOptions = {
  /** When false, cancels pending work and does not schedule (default true). */
  enabled?: boolean;
  debounceMs?: number;
  onError?: (message: string) => void;
};

/**
 * React binding for session proxy cache. Pass a `render` that attaches jobId
 * via useFfmpegJob so Task 11 reuses the existing job system.
 */
export function useTimelineProxy(
  project: TimelineProject,
  render: ProxyRenderFn,
  options?: UseTimelineProxyOptions,
): ProxyState {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? PROXY_DEBOUNCE_MS;
  const onError = options?.onError;

  const renderRef = useRef(render);
  renderRef.current = render;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [state, setState] = useState<ProxyState>(INITIAL_STATE);
  const cacheRef = useRef<ProxyCache | null>(null);

  useEffect(() => {
    const cache = createProxyCache({
      debounceMs,
      render: (args) => renderRef.current(args),
      onError: (message) => onErrorRef.current?.(message),
    });
    cacheRef.current = cache;
    const unsub = cache.subscribe(setState);
    return () => {
      unsub();
      cache.dispose();
      cacheRef.current = null;
    };
  }, [debounceMs]);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    if (!enabled) return;
    cache.scheduleProxyRender(project);
  }, [project, enabled]);

  return state;
}
