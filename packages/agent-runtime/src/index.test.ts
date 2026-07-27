import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_CLI_DEFS,
  assembleEditContextPrompt,
  buildLaunchArgs,
  buildLaunchForId,
  detectAllAgents,
  detectAvailableAgents,
  detectAgent,
  getDefById,
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
  settingKeyMap,
  createTextParseState,
  feedTextChunk,
  createJsonlParseState,
  feedJsonlChunk,
  requestCancel,
  escalateKill,
  RunRegistry,
  resolveBinaryPath,
  PROMPT_MAX_CHARS,
} from './index.js';

describe('@neos-work/agent-runtime', () => {
  it('registers at least 12 CLI defs', () => {
    expect(AGENT_CLI_DEFS.length).toBeGreaterThanOrEqual(12);
    expect(getDefById('cli-claude')?.launch.binary).toBe('claude');
    expect(getDefById('nope')).toBeUndefined();
    expect(Object.keys(settingKeyMap()).length).toBe(AGENT_CLI_DEFS.length);
  });

  it('builds launch args for classic three CLIs', () => {
    const claude = getDefById('cli-claude')!;
    const a = buildLaunchArgs(claude, 'hello world');
    expect(a.bin).toBe('claude');
    expect(a.args).toEqual(['--print', 'hello world']);

    const gemini = getDefById('cli-gemini')!;
    expect(buildLaunchArgs(gemini, 'p').args).toEqual(['-p', 'p']);

    const codex = getDefById('cli-codex')!;
    expect(buildLaunchArgs(codex, 'p').args).toEqual(['exec', 'p']);
  });

  it('detects with mock which/version overrides', async () => {
    const results = await detectAllAgents(
      { 'cli-claude': '/opt/claude' },
      {
        which: async (cmd) => (cmd === 'gemini' ? '/usr/bin/gemini' : null),
        version: async () => '1.2.3',
      },
    );
    expect(results.length).toBe(AGENT_CLI_DEFS.length);
    const gemini = results.find((r) => r.id === 'cli-gemini');
    expect(gemini?.available).toBe(true);
    if (gemini?.available) {
      expect(gemini.path).toBe('/usr/bin/gemini');
      expect(gemini.version).toBe('1.2.3');
    }
  });

  it('run registry create, events, cancel, editContext assemble', () => {
    resetGlobalRunRegistry();
    const reg = getGlobalRunRegistry();
    const run = reg.create({
      projectId: 'p1',
      agentId: 'cli-claude',
      prompt: 'hi',
      editContext: {
        filePath: 'index.html',
        mode: 'patch',
        selection: { selector: 'h1' },
        snippet: '<h1>x</h1>',
      },
    });
    expect(run.status).toBe('queued');
    reg.setStatus(run.id, 'running');
    reg.appendEvent(run.id, 'run.started');
    reg.appendEvent(run.id, 'run.stdout', { chunk: 'hello' });
    expect(reg.eventsAfter(run.id).length).toBe(2);
    const firstId = reg.eventsAfter(run.id)[0]!.id;
    expect(reg.eventsAfter(run.id, firstId).length).toBe(1);
    expect(reg.cancel(run.id)).toBe(true);
    expect(reg.get(run.id)?.status).toBe('canceled');

    const { prompt, editContext } = assembleEditContextPrompt('Do thing', {
      filePath: 'a.html',
      mode: 'replace-selection',
      selection: { startLine: 1, endLine: 3 },
    });
    expect(editContext?.mode).toBe('replace-selection');
    expect(prompt).toContain('Edit context');
    expect(prompt).toContain('a.html');

    const ac = new AbortController();
    expect(requestCancel(ac)).toBe(true);
    expect(requestCancel(ac)).toBe(false);
    expect(requestCancel(null)).toBe(false);
  });

  it('text and jsonl parsers', () => {
    const t = createTextParseState();
    expect(feedTextChunk(t, 'ab').accumulated).toBe('ab');
    expect(feedTextChunk(t, 'c').accumulated).toBe('abc');
    // non-string chunk ignored
    expect(feedTextChunk(t, 42 as unknown as string).accumulated).toBe('abc');

    const j = createJsonlParseState();
    const { lines } = feedJsonlChunk(j, '{"a":1}\n{"b":2}\npartial');
    expect(lines).toEqual([{ a: 1 }, { b: 2 }]);
    const more = feedJsonlChunk(j, '\n');
    expect(more.lines[0]).toEqual({ raw: 'partial' });
    // invalid json line
    const bad = feedJsonlChunk(createJsonlParseState(), 'not-json\n');
    expect(bad.lines[0]).toEqual({ raw: 'not-json' });
  });
});

describe('launch sanitize + stdin mode', () => {
  it('buildLaunchArgs rejects null-byte and blank prompts; truncates huge', () => {
    const claude = getDefById('cli-claude')!;
    expect(() => buildLaunchArgs(claude, 'a\0b')).toThrow(/control characters/i);
    expect(() => buildLaunchArgs(claude, '   ')).toThrow(/required/i);
    // non-string is treated as empty prompt and still yields argv with empty substitution
    const emptyish = buildLaunchArgs(claude, null as unknown as string);
    expect(emptyish.args[1]).toBe('');
    const big = buildLaunchArgs(claude, 'x'.repeat(500_000));
    expect(big.args[1]!.length).toBeLessThan(500_000);
    expect(big.args[1]).toMatch(/truncated/i);
    expect(PROMPT_MAX_CHARS).toBeGreaterThan(100_000);

    const withBin = buildLaunchArgs(claude, 'hi', '/custom/claude');
    expect(withBin.bin).toBe('/custom/claude');
    expect(buildLaunchArgs(claude, 'hi', 'bad\nbin').bin).toBe('claude');
    expect(buildLaunchArgs(claude, 'hi', '   ').bin).toBe('claude');
  });

  it('buildLaunchArgs supports synthetic stdin mode', () => {
    const stdinDef = {
      ...getDefById('cli-claude')!,
      launch: {
        binary: 'stdin-cli',
        mode: 'stdin' as const,
        argsTemplate: ['--mode', '{prompt}'],
        versionFlag: '--version',
      },
    };
    const launch = buildLaunchArgs(stdinDef, 'payload here');
    expect(launch.mode).toBe('stdin');
    expect(launch.stdinPayload).toBe('payload here');
    expect(launch.bin).toBe('stdin-cli');
  });

  it('buildLaunchForId rejects unknown agent', async () => {
    await expect(buildLaunchForId('cli-nope', 'x')).rejects.toThrow(/Unknown agent/i);
    const launch = await buildLaunchForId('cli-gemini', 'hi');
    expect(launch.def.id).toBe('cli-gemini');
    expect(launch.bin).toBeTruthy();
  });
});

describe('detection helpers', () => {
  it('resolveBinaryPath falls through when override not executable', async () => {
    const def = getDefById('cli-claude')!;
    const path = await resolveBinaryPath(
      def,
      { 'cli-claude': '/not/real/override' },
      async () => '/usr/bin/claude',
    );
    expect(path).toBe('/usr/bin/claude');

    const path2 = await resolveBinaryPath(
      def,
      { 'cli-claude': 'bad\npath' },
      async () => '/bin/claude',
    );
    expect(path2).toBe('/bin/claude');
  });

  it('detectAgent returns unavailable when which null', async () => {
    const def = getDefById('cli-aider')!;
    const result = await detectAgent(def, undefined, {
      which: async () => null,
    });
    expect(result.available).toBe(false);
    expect(result.binary).toBe('aider');
  });

  it('detectAvailableAgents filters to available only', async () => {
    const available = await detectAvailableAgents(undefined, {
      which: async (cmd) => (cmd === 'claude' ? '/bin/claude' : null),
      version: async () => '9.9.9',
      defs: AGENT_CLI_DEFS.filter((d) => d.id === 'cli-claude' || d.id === 'cli-gemini'),
    });
    expect(available).toHaveLength(1);
    expect(available[0]!.id).toBe('cli-claude');
    expect(available[0]!.version).toBe('9.9.9');
  });
});

describe('run registry list/gc/maxEvents', () => {
  it('filters by projectId and status; caps events; gcs old terminal runs', () => {
    resetGlobalRunRegistry();
    const reg = getGlobalRunRegistry();
    const a = reg.create({ projectId: 'p-a', agentId: 'cli-claude', prompt: 'a' });
    const b = reg.create({ projectId: 'p-b', agentId: 'cli-gemini', prompt: 'b' });
    reg.setStatus(a.id, 'running');
    reg.setStatus(b.id, 'succeeded');

    expect(reg.list({ projectId: 'p-a' }).map((r) => r.id)).toEqual([a.id]);
    expect(reg.list({ status: 'succeeded' }).map((r) => r.id)).toEqual([b.id]);
    expect(reg.get('bad\nid')).toBeUndefined();
    expect(reg.get('  ')).toBeUndefined();
    expect(reg.setStatus('missing', 'failed')).toBe(false);
    expect(reg.cancel('missing')).toBe(false);
    expect(reg.cancel(b.id)).toBe(false);
    expect(reg.appendEvent('missing', 'run.failed')).toBeUndefined();
    expect(reg.eventsAfter('missing')).toEqual([]);
    expect(reg.eventsAfter(a.id, 'no-such-event').length).toBeGreaterThanOrEqual(0);

    const small = new RunRegistry({ maxEvents: 3, ttlMs: 1 });
    const r = small.create({ prompt: 'cap' });
    for (let i = 0; i < 5; i++) small.appendEvent(r.id, 'run.stdout', { i });
    expect(small.get(r.id)!.events.length).toBe(3);

    small.setStatus(r.id, 'failed', 'x');
    const rec = small.get(r.id)!;
    rec.completedAt = new Date(Date.now() - 10_000).toISOString();
    expect(small.gc(Date.now())).toBe(1);
    expect(small.size).toBe(0);
    small.clear();
    expect(small.size).toBe(0);
  });
});

describe('edit context modes', () => {
  it('replace-file note vs patch preference and selector selection', () => {
    const replace = assembleEditContextPrompt('Go', {
      filePath: 'x.html',
      mode: 'replace-file',
    });
    expect(replace.prompt).toMatch(/full-file replace/i);

    const patch = assembleEditContextPrompt('Go', {
      filePath: 'x.html',
      mode: 'patch',
      selection: { startLine: 2, endLine: 4 },
      snippet: 'body',
    });
    expect(patch.prompt).toMatch(/minimal patch/i);
    expect(patch.prompt).toContain('2-4');
    expect(patch.prompt).toContain('body');

    const sel = assembleEditContextPrompt('Go', {
      filePath: 'x.html',
      mode: 'patch',
      selection: { selector: '.hero' },
    });
    expect(sel.prompt).toContain('.hero');

    const none = assembleEditContextPrompt('plain', null);
    expect(none.editContext).toBeNull();
    expect(none.prompt).toBe('plain');
  });
});

describe('escalateKill', () => {
  it('no-ops for invalid pids and swallows ESRCH', () => {
    escalateKill(undefined);
    escalateKill(0);
    escalateKill(-1);
    // unlikely pid — should not throw
    escalateKill(999_999_999);
  });
});
