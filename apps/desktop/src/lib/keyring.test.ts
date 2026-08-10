import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe('desktop keyring bridge', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('getMasterKeyFromOs returns null when empty', async () => {
    invoke.mockResolvedValueOnce(null);
    const { getMasterKeyFromOs } = await import('./keyring.js');
    await expect(getMasterKeyFromOs()).resolves.toEqual({ ok: true, keyB64: null });
    expect(invoke).toHaveBeenCalledWith('get_master_key', undefined);
  });

  it('getMasterKeyFromOs returns b64 key', async () => {
    invoke.mockResolvedValueOnce('YWJjZGVmZ2hpams=');
    const { getMasterKeyFromOs } = await import('./keyring.js');
    const r = await getMasterKeyFromOs();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keyB64).toBe('YWJjZGVmZ2hpams=');
  });

  it('setMasterKeyInOs rejects control chars', async () => {
    const { setMasterKeyInOs } = await import('./keyring.js');
    await expect(setMasterKeyInOs('bad\nkey')).resolves.toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('setMasterKeyInOs invokes tauri', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const { setMasterKeyInOs } = await import('./keyring.js');
    await expect(setMasterKeyInOs('YWJjZGVmZ2hpams=')).resolves.toEqual({
      ok: true,
      keyB64: 'YWJjZGVmZ2hpams=',
    });
    expect(invoke).toHaveBeenCalledWith('set_master_key', { keyB64: 'YWJjZGVmZ2hpams=' });
  });

  it('deleteMasterKeyFromOs invokes tauri', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const { deleteMasterKeyFromOs } = await import('./keyring.js');
    await expect(deleteMasterKeyFromOs()).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('delete_master_key', undefined);
  });
});
