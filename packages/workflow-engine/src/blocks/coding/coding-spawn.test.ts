import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const lastChildren: Array<
  EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  }
> = [];

vi.mock('node:child_process', () => ({
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
}));

const { getNativeExecutor } = await import('../registry.js');
const { registerCodingBlocks } = await import('./index.js');

beforeAll(() => {
  registerCodingBlocks();
});

describe('coding blocks spawn timeout / scrub paths', () => {
  beforeEach(() => {
    lastChildren.length = 0;
  });

  afterEach(() => {
    // Settle any hanging timers
    for (const c of lastChildren) {
      try {
        c.emit('exit', 0);
      } catch {
        /* ignore */
      }
    }
  });

  it('swallows kill errors on code_eval python timeout then settles', async () => {
    vi.useFakeTimers();
    try {
      const exec = getNativeExecutor('code_eval')!;
      const run = exec.execute({
        params: { code: 'print(1)', language: 'python' },
        inputs: {},
        settings: {},
      });
      await Promise.resolve();
      const child = lastChildren.at(-1);
      expect(child).toBeDefined();
      child!.stderr.emit('data', Buffer.from('py-out\n'));
      // CODE_EVAL_TIMEOUT_MS = 5000 — timer calls kill which throws (ignored)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(child!.kill).toHaveBeenCalled();
      child!.emit('exit', 1);
      const result = await run;
      expect(result.ok).toBe(false);
      expect(result.output !== undefined || result.error !== undefined).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('code_eval JS falls back to Operation failed when error scrubs empty', async () => {
    const exec = getNativeExecutor('code_eval')!;
    // Non-Error throw of control-only / empty → scrub → '' → 'Operation failed'
    const result = await exec.execute({
      params: {
        code: 'throw ""',
        language: 'js',
      },
      inputs: {},
      settings: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Operation failed');
  });
});
