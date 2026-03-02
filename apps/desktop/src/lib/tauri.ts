/**
 * Tauri integration helpers.
 * Provides safe wrappers around Tauri APIs that gracefully degrade
 * when running outside of Tauri (e.g., in a browser during development).
 */

/** Check if we're running inside a Tauri webview */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Start the engine server via Tauri sidecar.
 * Returns true if started successfully, false if sidecar is unavailable.
 * In development, sidecar may not be available — the user should start
 * the server manually with `pnpm --filter @neos-work/server dev`.
 */
export async function startEngine(): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<string>('start_engine');
    return result === 'ok' || result === 'already_running';
  } catch (error) {
    console.warn('[tauri] Failed to start engine sidecar:', error);
    return false;
  }
}

/**
 * Stop the engine server via Tauri.
 */
export async function stopEngine(): Promise<void> {
  if (!isTauri()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_engine');
  } catch (error) {
    console.warn('[tauri] Failed to stop engine:', error);
  }
}

/**
 * Get the auth token from the engine sidecar process.
 * Returns null in dev mode or if token is not yet available.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!isTauri()) return null;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('get_auth_token');
  } catch (error) {
    console.warn('[tauri] Failed to get auth token:', error);
    return null;
  }
}

/**
 * Get the engine port from the sidecar process.
 * Returns null in dev mode or if port is not yet available.
 */
export async function getEnginePort(): Promise<number | null> {
  if (!isTauri()) return null;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number | null>('get_engine_port');
  } catch (error) {
    console.warn('[tauri] Failed to get engine port:', error);
    return null;
  }
}
