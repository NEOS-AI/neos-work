import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lastChildren: Array<
  EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  }
> = [];

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => {
        throw new Error('kill failed');
      });
      lastChildren.push(child);
      return child;
    }),
  };
});

const { createShellTool } = await import('./shell.js');

describe('createShellTool spawn error path', () => {
  let root: string;

  beforeEach(async () => {
    lastChildren.length = 0;
    root = await mkdtemp(join(tmpdir(), 'neos-sh-err-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns structured failure when spawn emits error', async () => {
    const tool = createShellTool(root);
    const run = tool.execute({ command: 'echo hello' });
    // Emit after microtask so error listeners are attached
    await Promise.resolve();
    lastChildren.at(-1)?.emit('error', new Error('spawn ENOENT mock'));
    const result = await run;
    expect(result.success).toBe(false);
    expect(result.output).toBeNull();
    expect(result.error).toMatch(/spawn ENOENT mock|Operation failed/i);
  });

  it('swallows kill exceptions on timeout then settles on close', async () => {
    const tool = createShellTool(root);
    // Tool input field is `timeout` (ms), not timeoutMs
    const run = tool.execute({ command: 'hang', timeout: 30 });
    await new Promise((r) => setTimeout(r, 80));
    // kill() was invoked by timeout and threw (ignored)
    expect(lastChildren.at(-1)?.kill).toHaveBeenCalled();
    lastChildren.at(-1)?.emit('close', null);
    const result = await run;
    // null code → exitCode -1
    expect(result.success).toBe(false);
    expect(result.output).toMatchObject({ exitCode: -1 });
  });
});
