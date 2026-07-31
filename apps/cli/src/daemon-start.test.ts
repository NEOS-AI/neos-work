import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDaemonSession,
  parseMetaLine,
  readDaemonSession,
  startDaemonProcess,
  writeDaemonSession,
} from './daemon-start.js';

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe('parseMetaLine', () => {
  it('parses port and token', () => {
    expect(parseMetaLine('NEOS_PORT=4123')).toEqual({ port: 4123 });
    expect(parseMetaLine('NEOS_AUTH_TOKEN=abcdef')).toEqual({ token: 'abcdef' });
    expect(parseMetaLine('hello')).toEqual({});
    expect(parseMetaLine('NEOS_PORT=99999')).toEqual({});
    expect(parseMetaLine('NEOS_AUTH_TOKEN=bad\ntok')).toEqual({});
  });
});

describe('daemon session file', () => {
  it('writes, reads, and clears a local session', () => {
    const file = path.join(os.tmpdir(), `neos-cli-session-${process.pid}-${Date.now()}.json`);
    tmpFiles.push(file);
    writeDaemonSession(file, {
      pid: 12345,
      port: 3000,
      token: 'tok-abc',
      serverUrl: 'http://127.0.0.1:3000',
    });
    const s = readDaemonSession(file);
    expect(s?.pid).toBe(12345);
    expect(s?.token).toBe('tok-abc');
    clearDaemonSession(file);
    expect(readDaemonSession(file)).toBeNull();
  });

  it('rejects non-local or invalid session payloads', () => {
    const file = path.join(os.tmpdir(), `neos-cli-session-bad-${process.pid}.json`);
    tmpFiles.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        pid: 1,
        port: 3000,
        token: 'x',
        serverUrl: 'http://evil.example:3000',
      }),
    );
    expect(readDaemonSession(file)).toBeNull();
    fs.writeFileSync(
      file,
      JSON.stringify({
        pid: -1,
        port: 3000,
        token: 'x',
        serverUrl: 'http://127.0.0.1:3000',
      }),
    );
    expect(readDaemonSession(file)).toBeNull();
  });
});

describe('startDaemonProcess', () => {
  it('resolves when mock child emits metadata', async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        pid: number;
        kill: () => void;
        unref: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 4242;
      child.kill = vi.fn();
      child.unref = vi.fn();
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('NEOS_PORT=3456\nNEOS_AUTH_TOKEN=secret-tok\n'));
      });
      return child;
    });

    const result = await startDaemonProcess({
      spawnFn: spawnFn as never,
      serverEntry: '/fake/server/dist/index.js',
      timeoutMs: 2000,
    });
    expect(result.port).toBe(3456);
    expect(result.token).toBe('secret-tok');
    expect(result.pid).toBe(4242);
    expect(result.serverUrl).toBe('http://127.0.0.1:3456');
  });
});
