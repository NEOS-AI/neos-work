import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { parseMetaLine, startDaemonProcess } from './daemon-start.js';

describe('parseMetaLine', () => {
  it('parses port and token', () => {
    expect(parseMetaLine('NEOS_PORT=4123')).toEqual({ port: 4123 });
    expect(parseMetaLine('NEOS_AUTH_TOKEN=abcdef')).toEqual({ token: 'abcdef' });
    expect(parseMetaLine('hello')).toEqual({});
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
