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
  });

  it('canonicalizes legacy tool aliases', () => {
    expect(canonicalizeToolName('list_files')).toBe('list_directory');
    expect(canonicalizeToolName('shell')).toBe('run_command');
    expect(canonicalizeToolName('  read_file  ')).toBe('read_file');
    expect(canonicalizeToolName('bad\nname')).toBe('');
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

  it('kind none returns process.cwd', async () => {
    const dir = await resolveWorkerWorkspace({ policy: { kind: 'none' }, baseDir: base });
    expect(dir).toBe(process.cwd());
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
});
