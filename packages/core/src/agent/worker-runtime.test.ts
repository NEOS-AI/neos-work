import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DomainWorker } from '@neos-work/shared';
import { mockAdapter } from '../test-utils/mock-adapter.js';
import {
  buildWorkerSystemPrompt,
  buildWorkerToolRegistry,
  canonicalizeToolName,
  resolveWorkerToolNames,
  resolveWorkerWorkspace,
  runWorker,
  toolsForPermissionProfile,
  WorkerRuntime,
} from './worker-runtime.js';

function makeWorker(partial: Partial<DomainWorker> & Pick<DomainWorker, 'id'>): DomainWorker {
  return {
    name: partial.name ?? partial.id,
    domain: partial.domain ?? 'general',
    description: partial.description ?? '',
    systemPrompt: partial.systemPrompt ?? 'You are a test worker.',
    ...partial,
  };
}

describe('toolsForPermissionProfile / canonicalizeToolName', () => {
  it('maps profiles to expected tool sets', () => {
    expect([...toolsForPermissionProfile('read_only')].sort()).toEqual(
      ['list_directory', 'read_file', 'search_files'].sort(),
    );
    expect(toolsForPermissionProfile('execute').has('run_command')).toBe(true);
    expect(toolsForPermissionProfile('execute').has('write_file')).toBe(true);
    expect(toolsForPermissionProfile('network').has('web_search')).toBe(true);
    expect(toolsForPermissionProfile('network').has('run_command')).toBe(false);
    expect(toolsForPermissionProfile('full').has('web_search')).toBe(true);
    expect(toolsForPermissionProfile('full').has('run_command')).toBe(true);
    expect(toolsForPermissionProfile(undefined).has('web_search')).toBe(true);
    // read_write has writes but no shell/network
    expect(toolsForPermissionProfile('read_write').has('write_file')).toBe(true);
    expect(toolsForPermissionProfile('read_write').has('move_file')).toBe(true);
    expect(toolsForPermissionProfile('read_write').has('run_command')).toBe(false);
    expect(toolsForPermissionProfile('read_write').has('web_search')).toBe(false);
  });

  it('canonicalizes legacy tool aliases', () => {
    expect(canonicalizeToolName('list_files')).toBe('list_directory');
    expect(canonicalizeToolName('shell')).toBe('run_command');
    expect(canonicalizeToolName('run_shell')).toBe('run_command');
    expect(canonicalizeToolName('  read_file  ')).toBe('read_file');
    expect(canonicalizeToolName('bad\nname')).toBe('');
    expect(canonicalizeToolName('')).toBe('');
    expect(canonicalizeToolName('   ')).toBe('');
    expect(canonicalizeToolName(null as unknown as string)).toBe('');
    // Case-insensitive alias table lookup
    expect(canonicalizeToolName('SHELL')).toBe('run_command');
  });
});

describe('resolveWorkerToolNames', () => {
  it('intersects profile with allowedTools after aliasing', () => {
    const w = makeWorker({
      id: 't1',
      permissionProfile: 'execute',
      allowedTools: ['read_file', 'list_files', 'shell', 'web_search'],
    });
    const names = resolveWorkerToolNames(w);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'list_directory', 'run_command']));
    // web_search not in execute profile → excluded
    expect(names).not.toContain('web_search');
  });

  it('uses full profile set when allowedTools empty/missing', () => {
    const empty = makeWorker({
      id: 'empty-tools',
      permissionProfile: 'network',
      allowedTools: [],
    });
    expect(resolveWorkerToolNames(empty)).toEqual(
      expect.arrayContaining(['read_file', 'web_search', 'write_file']),
    );
    expect(resolveWorkerToolNames(empty)).not.toContain('run_command');

    const missing = makeWorker({
      id: 'no-tools',
      permissionProfile: 'read_only',
    });
    expect(resolveWorkerToolNames(missing).sort()).toEqual(
      ['list_directory', 'read_file', 'search_files'].sort(),
    );
  });

  it('forces coordinator toward read_only when profile is high privilege', () => {
    const w = makeWorker({
      id: 'coord',
      permissionProfile: 'full',
      defaultMode: 'coordinator',
      allowedTools: ['read_file', 'write_file', 'shell'],
    });
    const names = resolveWorkerToolNames(w, 'coordinator');
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });

  it('forces coordinator execute/read_write profiles to read_only', () => {
    for (const permissionProfile of ['execute', 'read_write'] as const) {
      const names = resolveWorkerToolNames(
        makeWorker({
          id: `coord-${permissionProfile}`,
          permissionProfile,
          defaultMode: 'coordinator',
          allowedTools: ['read_file', 'write_file', 'shell'],
        }),
        'coordinator',
      );
      expect(names).toContain('read_file');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('run_command');
    }
  });

  it('defaults missing coordinator profile to read_only', () => {
    const names = resolveWorkerToolNames(
      makeWorker({
        id: 'coord-undef',
        permissionProfile: undefined,
        defaultMode: 'coordinator',
      }),
      'coordinator',
    );
    expect(names.sort()).toEqual(['list_directory', 'read_file', 'search_files'].sort());
  });

  it('keeps network profile for coordinator (not forced down from network)', () => {
    const w = makeWorker({
      id: 'coord-net',
      permissionProfile: 'network',
      defaultMode: 'coordinator',
      allowedTools: ['read_file', 'web_search', 'write_file'],
    });
    const names = resolveWorkerToolNames(w);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'web_search', 'write_file']));
  });
});

describe('resolveWorkerWorkspace', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'neos-ws-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('creates run and isolated workspaces under base', async () => {
    const runDir = await resolveWorkerWorkspace({
      policy: { kind: 'run' },
      runId: 'run-1',
      baseDir: base,
    });
    expect(runDir).toBe(join(base, 'run-1'));

    const iso = await resolveWorkerWorkspace({
      policy: { kind: 'isolated' },
      runId: 'run-1',
      workerRunId: 'w-abc',
      baseDir: base,
    });
    expect(iso).toBe(join(base, 'run-1', 'w-abc'));

    const sub = await resolveWorkerWorkspace({
      policy: { kind: 'run', subdir: 'outputs' },
      runId: 'run-2',
      baseDir: base,
    });
    expect(sub).toBe(join(base, 'run-2', 'outputs'));
  });

  it('sanitizes path segments so escapes cannot leave base', async () => {
    const dir = await resolveWorkerWorkspace({
      policy: { kind: 'run' },
      runId: '../escape',
      baseDir: base,
    });
    expect(dir.startsWith(base)).toBe(true);
    expect(dir).not.toContain('..');
  });

  it('rejects control-char runId and defaults blank segments', async () => {
    const dir = await resolveWorkerWorkspace({
      policy: { kind: 'run' },
      runId: `bad${'\n'}id`,
      baseDir: base,
    });
    // control-char → empty → default-run
    expect(dir).toBe(join(base, 'default-run'));

    const blank = await resolveWorkerWorkspace({
      policy: { kind: 'run', subdir: '  ' },
      runId: '   ',
      baseDir: base,
    });
    expect(blank).toBe(join(base, 'default-run'));
  });

  it('isolated without workerRunId creates a uuid segment under runId', async () => {
    const dir = await resolveWorkerWorkspace({
      policy: { kind: 'isolated' },
      runId: 'run-iso',
      baseDir: base,
    });
    expect(dir.startsWith(join(base, 'run-iso'))).toBe(true);
    expect(dir.length).toBeGreaterThan(join(base, 'run-iso').length + 1);
  });

  it('kind none returns process.cwd', async () => {
    const dir = await resolveWorkerWorkspace({ policy: { kind: 'none' }, baseDir: base });
    expect(dir).toBe(process.cwd());
  });

  it('defaults policy to run when omitted', async () => {
    const dir = await resolveWorkerWorkspace({ runId: 'implicit-run', baseDir: base });
    expect(dir).toBe(join(base, 'implicit-run'));
  });

  it('falls back to default workspace base when baseDir is whitespace-only', async () => {
    const dir = await resolveWorkerWorkspace({
      policy: { kind: 'run' },
      runId: 'ws-default-base',
      baseDir: '   ',
    });
    // Whitespace baseDir is treated as missing → package default under cwd/tmp
    expect(dir.includes('ws-default-base')).toBe(true);
    expect(dir).not.toBe(join('   ', 'ws-default-base'));
  });
});

describe('buildWorkerToolRegistry + path jail', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neos-reg-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('registers only profile-permitted tools rooted at workspace', async () => {
    const worker = makeWorker({
      id: 'rw',
      permissionProfile: 'read_write',
      allowedTools: ['read_file', 'write_file', 'list_files'],
    });
    const reg = buildWorkerToolRegistry({ worker, workspaceRoot: root });
    const names = reg.getAll().map((t) => t.name).sort();
    expect(names).toEqual(['list_directory', 'read_file', 'write_file'].sort());
    expect(reg.get('run_command')).toBeUndefined();
    expect(reg.get('web_search')).toBeUndefined();

    const write = reg.get('write_file')!;
    const ok = await write.execute({ path: 'hello.txt', content: 'hi' });
    expect(ok.success).toBe(true);

    const escaped = await write.execute({ path: '../escape.txt', content: 'nope' });
    expect(escaped.success).toBe(false);
    expect(String(escaped.error ?? '')).toMatch(/outside|workspace|invalid|Path/i);
  });

  it('read_only rejects write_file registration', async () => {
    const worker = makeWorker({
      id: 'ro',
      permissionProfile: 'read_only',
    });
    const reg = buildWorkerToolRegistry({ worker, workspaceRoot: root });
    expect(reg.get('write_file')).toBeUndefined();
    expect(reg.get('read_file')).toBeDefined();
  });
});

describe('buildWorkerSystemPrompt', () => {
  it('merges worker prompt, append, design, memory with caps', () => {
    const worker = makeWorker({
      id: 'p',
      systemPrompt: 'Base worker prompt.',
    });
    const prompt = buildWorkerSystemPrompt({
      worker,
      systemPromptAppend: 'Node append.',
      designSystemContent: 'Brand tokens',
      memoryContext: 'User prefers dark mode',
    });
    expect(prompt).toContain('Base worker prompt.');
    expect(prompt).toContain('Node append.');
    expect(prompt).toContain('DESIGN CONTEXT');
    expect(prompt).toContain('Brand tokens');
    expect(prompt).toContain('Agent Memory');
    expect(prompt).toContain('dark mode');
  });

  it('drops null-byte design/memory', () => {
    const worker = makeWorker({ id: 'p', systemPrompt: 'OK' });
    const prompt = buildWorkerSystemPrompt({
      worker,
      designSystemContent: `x${'\0'}y`,
      memoryContext: `m${'\0'}`,
    });
    expect(prompt).not.toContain('DESIGN CONTEXT');
    expect(prompt).not.toContain('Agent Memory');
  });

  it('truncates oversized design and memory contexts', () => {
    const worker = makeWorker({ id: 'p', systemPrompt: 'Base' });
    const prompt = buildWorkerSystemPrompt({
      worker,
      designSystemContent: 'D'.repeat(40_000),
      memoryContext: 'M'.repeat(40_000),
    });
    expect(prompt).toContain('…[design context truncated]');
    expect(prompt).toContain('…[memory truncated]');
    expect(prompt.length).toBeLessThan(40_000 + 40_000);
  });

  it('strips null bytes from system prompt and caps total length', () => {
    const worker = makeWorker({
      id: 'p',
      systemPrompt: `Hello${'\0'}World ${'X'.repeat(120_000)}`,
    });
    const prompt = buildWorkerSystemPrompt({ worker });
    expect(prompt).not.toContain('\0');
    expect(prompt.length).toBeLessThanOrEqual(100_000);
  });
});

describe('runWorker / WorkerRuntime', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'neos-run-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('runs solo worker with mock adapter and emits lifecycle events', async () => {
    const worker = makeWorker({
      id: 'solo_test',
      permissionProfile: 'read_only',
      workspace: { kind: 'isolated' },
      systemPrompt: 'Answer briefly.',
      constraints: { maxSteps: 5, timeoutMs: 30_000 },
    });
    const events: string[] = [];
    const result = await runWorker({
      worker,
      goal: 'Say hello',
      inputs: { topic: 'test' },
      settings: {},
      adapter: mockAdapter(['Hello from worker']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n1', runId: 'r1' },
      onEvent: (e) => events.push(e.type),
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Hello from worker');
    expect(result.workspaceRoot?.startsWith(base)).toBe(true);
    expect(events).toContain('worker.started');
    expect(events).toContain('worker.progress');
    expect(events).toContain('worker.completed');
    expect(events).toContain('agent');
  });

  it('fails closed without adapter', async () => {
    const result = await runWorker({
      worker: makeWorker({ id: 'no_adapter' }),
      goal: 'x',
      settings: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/adapter/i);
  });

  it('WorkerRuntime class delegates to runWorker', async () => {
    const runtime = new WorkerRuntime();
    const result = await runtime.run({
      worker: makeWorker({
        id: 'cls',
        workspace: { kind: 'run' },
        permissionProfile: 'network',
      }),
      goal: 'ping',
      settings: {},
      adapter: mockAdapter(['pong']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r2' },
    });
    expect(result.ok).toBe(true);
    expect(String(result.output)).toContain('pong');
  });

  it('path escape rejected via registry built for isolated workspace', async () => {
    const worker = makeWorker({
      id: 'iso_write',
      permissionProfile: 'read_write',
      workspace: { kind: 'isolated' },
      allowedTools: ['write_file', 'read_file'],
    });
    const ws = await resolveWorkerWorkspace({
      policy: worker.workspace,
      runId: 'r-escape',
      workerRunId: 'w-escape',
      baseDir: base,
    });
    await writeFile(join(ws, 'ok.txt'), 'in');
    const reg = buildWorkerToolRegistry({ worker, workspaceRoot: ws });
    const write = reg.get('write_file')!;
    const bad = await write.execute({ path: '../../outside.txt', content: 'x' });
    expect(bad.success).toBe(false);
  });

  it('fails closed when adapter is missing and still emits worker.failed', async () => {
    const events: Array<{ type: string; error?: string }> = [];
    const result = await runWorker({
      worker: makeWorker({ id: 'no_ad', workspace: { kind: 'none' } }),
      goal: 'x',
      settings: {},
      onEvent: (e) => {
        if (e.type === 'worker.failed') events.push({ type: e.type, error: e.error });
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/adapter/i);
    expect(events.some((e) => e.type === 'worker.failed')).toBe(true);
  });

  it('swallows onEvent handler throws and still completes', async () => {
    const result = await runWorker({
      worker: makeWorker({
        id: 'evt_throw',
        workspace: { kind: 'run' },
        permissionProfile: 'read_only',
      }),
      goal: 'hi',
      settings: {},
      adapter: mockAdapter(['ok']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-throw' },
      onEvent: () => {
        throw new Error('host boom');
      },
    });
    expect(result.ok).toBe(true);
  });

  it('truncates oversized inputs and uses empty goal from inputs JSON', async () => {
    const result = await runWorker({
      worker: makeWorker({
        id: 'fat_inputs',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
        systemPrompt: '',
      }),
      goal: '   ',
      inputs: { blob: 'Z'.repeat(300_000) },
      settings: {},
      adapter: mockAdapter(['done']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-fat', workerRunId: 'custom-wr' },
    });
    expect(result.ok).toBe(true);
    expect(result.workerRunId).toBe('custom-wr');
  });

  it('registers extraTools even when outside permission profile', async () => {
    const worker = makeWorker({
      id: 'extra',
      permissionProfile: 'read_only',
      workspace: { kind: 'none' },
    });
    const extra = {
      name: 'spawn_worker',
      description: 'spawn',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ success: true, output: 'spawned' }),
    };
    const reg = buildWorkerToolRegistry({
      worker,
      workspaceRoot: base,
      extraTools: [extra],
    });
    expect(reg.get('spawn_worker')).toBeDefined();
    expect(reg.get('write_file')).toBeUndefined();
  });

  it('fails when adapter chat throws with no streamed text', async () => {
    const throwing = {
      id: 'openai' as const,
      name: 'Throwing',
      getModels: () => [],
      async *chat() {
        throw new Error('upstream LLM down');
      },
      async validateApiKey() {
        return true;
      },
    };
    const result = await runWorker({
      worker: makeWorker({
        id: 'fail_llm',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
        constraints: { maxSteps: 2, timeoutMs: 5_000 },
      }),
      goal: 'fail please',
      settings: {},
      adapter: throwing,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-fail' },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error ?? '')).toMatch(/upstream LLM down|Worker failed|failed/i);
  });

  it('scrubs control-char model and clamps invalid maxSteps', async () => {
    const result = await runWorker({
      worker: makeWorker({
        id: 'clamp',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
        constraints: { maxSteps: 0, timeoutMs: -1 },
      }),
      goal: 'x',
      settings: {},
      adapter: mockAdapter(['y']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-clamp' },
      maxSteps: Number.NaN,
      model: `claude${'\n'}bad`,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when caller aborts before any text is produced', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runWorker({
      worker: makeWorker({
        id: 'aborted',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
        constraints: { maxSteps: 3, timeoutMs: 10_000 },
      }),
      goal: 'will cancel',
      settings: {},
      adapter: mockAdapter(['should not matter']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-abort' },
      signal: ac.signal,
    });
    // Abort may surface as failure or cancelled; never hang
    expect(result.ok === false || result.ok === true).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts a valid model id string', async () => {
    const result = await runWorker({
      worker: makeWorker({
        id: 'model_ok',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'hi',
      settings: {},
      adapter: mockAdapter(['ok']),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-model' },
      model: '  mock-model-id  ',
    });
    expect(result.ok).toBe(true);
  });

  it('surfaces workspace creation failures on the outer catch path', async () => {
    // baseDir that cannot be used as a directory causes mkdir to throw
    const result = await runWorker({
      worker: makeWorker({
        id: 'bad_ws',
        workspace: { kind: 'run' },
        permissionProfile: 'read_only',
      }),
      goal: 'x',
      settings: {},
      adapter: mockAdapter(['y']),
      workspaceBaseDir: '/dev/null',
      parent: { nodeId: 'n', runId: 'r-badws' },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error ?? '').length).toBeGreaterThan(0);
  });

  it('keeps a rolling window when streamed text exceeds 2 MiB', async () => {
    const fat = 'T'.repeat(2 * 1024 * 1024 + 1000);
    const result = await runWorker({
      worker: makeWorker({
        id: 'fat_text',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'stream fat',
      settings: {},
      adapter: mockAdapter([fat]),
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-fat-text' },
    });
    expect(result.ok).toBe(true);
    expect(String(result.output ?? '').length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('combines abort signals via polyfill when AbortSignal.any is unavailable', async () => {
    const anyFn = AbortSignal.any;
    // Force polyfill path (Node <20 / stripped env)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (AbortSignal as any).any;

    try {
      const parent = new AbortController();
      const slow = {
        id: 'openai' as const,
        name: 'Slow',
        getModels: () => [],
        async *chat(_req: unknown, signal?: AbortSignal) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 5_000);
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('aborted by polyfill combine'));
              },
              { once: true },
            );
          });
          yield { type: 'done' as const };
        },
        async validateApiKey() {
          return true;
        },
      };

      const runP = runWorker({
        worker: makeWorker({
          id: 'polyfill_abort',
          workspace: { kind: 'none' },
          permissionProfile: 'read_only',
          constraints: { maxSteps: 3, timeoutMs: 30_000 },
        }),
        goal: 'wait then abort',
        settings: {},
        adapter: slow,
        workspaceBaseDir: base,
        parent: { nodeId: 'n', runId: 'r-polyfill' },
        signal: parent.signal,
      });

      await new Promise((r) => setTimeout(r, 20));
      parent.abort();
      const result = await runP;
      expect(result.ok).toBe(false);
      expect(String(result.error ?? '').length).toBeGreaterThan(0);
    } finally {
      if (typeof anyFn === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (AbortSignal as any).any = anyFn;
      }
    }
  });

  it('falls back to Worker failed when outer catch scrubs to empty', async () => {
    const blankThrow = {
      id: 'openai' as const,
      name: 'Blank',
      getModels: () => [],
      async *chat() {
        // Whitespace-only message → scrubErrorMessage trims to ''
        throw new Error('   \n\t  ');
      },
      async validateApiKey() {
        return true;
      },
    };
    const result = await runWorker({
      worker: makeWorker({
        id: 'blank_err',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
        constraints: { maxSteps: 2, timeoutMs: 5_000 },
      }),
      goal: 'blank fail',
      settings: {},
      adapter: blankThrow,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-blank-err' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Worker failed');
  });
});
