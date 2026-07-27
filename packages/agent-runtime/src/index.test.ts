import { describe, expect, it } from 'vitest';
import {
  AGENT_CLI_DEFS,
  assembleEditContextPrompt,
  buildLaunchArgs,
  detectAllAgents,
  getDefById,
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
  settingKeyMap,
  createTextParseState,
  feedTextChunk,
  createJsonlParseState,
  feedJsonlChunk,
  requestCancel,
} from './index.js';

describe('@neos-work/agent-runtime', () => {
  it('registers at least 12 CLI defs', () => {
    expect(AGENT_CLI_DEFS.length).toBeGreaterThanOrEqual(12);
    expect(getDefById('cli-claude')?.launch.binary).toBe('claude');
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
        // force override path "exists" via which only for non-override — override needs X_OK
        // so mock only gemini PATH; claude override may fail isExecutable in CI
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
  });

  it('text and jsonl parsers', () => {
    const t = createTextParseState();
    expect(feedTextChunk(t, 'ab').accumulated).toBe('ab');
    expect(feedTextChunk(t, 'c').accumulated).toBe('abc');

    const j = createJsonlParseState();
    const { lines } = feedJsonlChunk(j, '{"a":1}\n{"b":2}\npartial');
    expect(lines).toEqual([{ a: 1 }, { b: 2 }]);
    const more = feedJsonlChunk(j, '\n');
    expect(more.lines[0]).toEqual({ raw: 'partial' });
  });
});
