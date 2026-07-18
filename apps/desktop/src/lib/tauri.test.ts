import { describe, expect, it, afterEach } from 'vitest';
import { isTauri, startEngine, stopEngine, getAuthToken, getEnginePort } from './tauri.js';

describe('tauri helpers outside Tauri', () => {
  afterEach(() => {
    // ensure we don't leave fake globals
    // @ts-expect-error cleanup
    delete window.__TAURI_INTERNALS__;
  });

  it('isTauri is false without __TAURI_INTERNALS__', () => {
    expect(isTauri()).toBe(false);
  });

  it('isTauri is true when internals exist', () => {
    // @ts-expect-error test stub
    window.__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });

  it('startEngine returns false outside Tauri', async () => {
    expect(await startEngine()).toBe(false);
  });

  it('stopEngine / getAuthToken / getEnginePort no-op outside Tauri', async () => {
    await expect(stopEngine()).resolves.toBeUndefined();
    expect(await getAuthToken()).toBeNull();
    expect(await getEnginePort()).toBeNull();
  });

  it('startEngine returns false when Tauri flag set but invoke unavailable', async () => {
    // @ts-expect-error stub
    window.__TAURI_INTERNALS__ = {};
    // Dynamic import of @tauri-apps/api/core will fail / throw → false
    expect(await startEngine()).toBe(false);
  });
});
