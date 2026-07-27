/**
 * Cancel helpers for spawned agent runs.
 */

export function requestCancel(controller: AbortController | undefined | null): boolean {
  if (!controller || controller.signal.aborted) return false;
  try {
    controller.abort();
    return true;
  } catch {
    return false;
  }
}

/** Soft kill then escalate — host may use this after abort. */
export function escalateKill(
  pid: number | undefined,
  signals: NodeJS.Signals[] = ['SIGTERM', 'SIGKILL'],
): void {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return;
  for (const sig of signals) {
    try {
      process.kill(pid, sig);
      return;
    } catch {
      // ESRCH etc.
    }
  }
}
