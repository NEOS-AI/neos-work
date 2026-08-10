/**
 * Desktop OS keyring bridge for AES master key (v0.24).
 * Service `neos-work` / account `master-key` — base64 of 32 raw bytes.
 * Uses Tauri invoke when available; no-ops / errors in pure browser.
 */

export type MasterKeyResult =
  | { ok: true; keyB64: string | null }
  | { ok: false; error: string };

function isSafeB64(s: string): boolean {
  if (!s || /[\0\r\n]/.test(s)) return false;
  const t = s.trim();
  return t.length > 0 && t.length <= 128;
}

/** Dynamic import so non-Tauri vitest does not require the plugin. */
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getMasterKeyFromOs(): Promise<MasterKeyResult> {
  try {
    const v = await invokeTauri<string | null>('get_master_key');
    if (v == null || v === '') return { ok: true, keyB64: null };
    if (!isSafeB64(v)) return { ok: false, error: 'Invalid key material from keyring' };
    return { ok: true, keyB64: v.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Not in Tauri / command missing
    if (/not allowed|plugin|webview|__TAURI__/i.test(msg)) {
      return { ok: false, error: 'OS keyring unavailable (not running in Tauri)' };
    }
    return { ok: false, error: msg.slice(0, 200) };
  }
}

export async function setMasterKeyInOs(keyB64: string): Promise<MasterKeyResult> {
  if (!isSafeB64(keyB64)) {
    return { ok: false, error: 'Invalid key material' };
  }
  try {
    await invokeTauri<void>('set_master_key', { keyB64: keyB64.trim() });
    return { ok: true, keyB64: keyB64.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

export async function deleteMasterKeyFromOs(): Promise<{ ok: boolean; error?: string }> {
  try {
    await invokeTauri<void>('delete_master_key');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}
