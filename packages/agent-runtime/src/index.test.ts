import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_CLI_DEFS,
  assembleEditContextPrompt,
  assemblePreviewCommentsPrompt,
  assembleDesignContextPrompt,
  formatDesignHarnessInner,
  DESIGN_HARNESS_WRAP_MAX,
  DESIGN_MD_INJECT_MAX,
  RULES_MD_INJECT_MAX,
  RULES_MD_INJECT_HEAD,
  RULES_MD_INJECT_TAIL,
  TOKENS_INJECT_MAX,
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
    expect(run.collabSessionId).toBeNull();
    const bound = reg.create({
      agentId: 'cli-claude',
      prompt: 'bound',
      collabSessionId: 'presence-abc',
    });
    expect(bound.collabSessionId).toBe('presence-abc');

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

describe('assemblePreviewCommentsPrompt', () => {
  it('appends numbered annotations', () => {
    const out = assemblePreviewCommentsPrompt('Fix spacing', [
      { filePath: 'index.html', selector: 'h1', body: 'Make larger' },
    ]);
    expect(out).toContain('Preview comments');
    expect(out).toContain('h1');
    expect(out).toContain('Make larger');
  });

  it('returns base when empty', () => {
    expect(assemblePreviewCommentsPrompt('x', [])).toBe('x');
    expect(assemblePreviewCommentsPrompt('x', null as unknown as [])).toBe('x');
  });

  it('skips invalid entries, caps count/body, and drops control-char paths', () => {
    const out = assemblePreviewCommentsPrompt(
      'Base',
      [
        { filePath: 'bad\npath', selector: 'h1', body: 'skip' },
        { filePath: 'a.html', selector: 'x\ny', body: 'skip' },
        { filePath: 'a.html', selector: '.ok', body: 'tok\0en' },
        { filePath: '', selector: 'h1', body: 'skip' },
        { filePath: 'b.html', selector: '', body: 'skip' },
        { filePath: 'c.html', selector: '.btn', body: '  hello  ' },
        { filePath: 'd.html', selector: '.x', body: 'y'.repeat(1000) },
        null as unknown as { filePath: string; selector: string; body: string },
      ],
      { maxComments: 1, maxBodyChars: 10 },
    );
    expect(out).toContain('Preview comments');
    expect(out).toContain('c.html');
    expect(out).toContain('hello');
    // only 1 comment due to maxComments
    expect(out).not.toContain('d.html');
  });
});

describe('defaultWhich / defaultVersionProbe', () => {
  it('defaultWhich rejects blank/control-char and uses mocked execFile', async () => {
    const { defaultWhich, defaultVersionProbe } = await import('./detection.js');
    expect(await defaultWhich('')).toBeNull();
    expect(await defaultWhich('  ')).toBeNull();
    expect(await defaultWhich('bad\ncmd')).toBeNull();
    expect(await defaultWhich(null as unknown as string)).toBeNull();

    // defaultVersionProbe rejects bad paths
    expect(await defaultVersionProbe('')).toBeUndefined();
    expect(await defaultVersionProbe('bad\npath')).toBeUndefined();
    expect(await defaultVersionProbe(null as unknown as string)).toBeUndefined();
  });

  it('defaultWhich/versionProbe hit real node binary paths', async () => {
    const { defaultWhich, defaultVersionProbe, resolveBinaryPath } = await import(
      './detection.js'
    );
    const whichNode = await defaultWhich('node');
    // CI/dev machines almost always have node on PATH
    if (whichNode) {
      expect(whichNode.length).toBeGreaterThan(0);
      const ver = await defaultVersionProbe(whichNode, '--version');
      expect(ver === undefined || ver.length > 0).toBe(true);
    }
    // non-existent binary → undefined
    expect(await defaultVersionProbe('/definitely/not/a/binary-xyz', '--version')).toBeUndefined();
    expect(await defaultWhich('definitely-not-a-cli-binary-xyz-123')).toBeNull();

    // executable override path (node itself)
    const def = getDefById('cli-claude')!;
    const viaOverride = await resolveBinaryPath(def, {
      'cli-claude': process.execPath,
    });
    expect(viaOverride).toBe(process.execPath);
  });

  it('requestCancel and escalateKill edge cases', () => {
    expect(requestCancel(null)).toBe(false);
    expect(requestCancel(undefined)).toBe(false);
    const c = new AbortController();
    expect(requestCancel(c)).toBe(true);
    expect(requestCancel(c)).toBe(false);
    const throwing = {
      signal: { aborted: false },
      abort: () => {
        throw new Error('abort failed');
      },
    };
    expect(requestCancel(throwing as unknown as AbortController)).toBe(false);

    escalateKill(undefined);
    escalateKill(-1);
    escalateKill(Number.NaN);
    // non-existent pid should not throw
    escalateKill(2_147_483_646);
  });

  it('cancel swallows abort errors on registry run', () => {
    resetGlobalRunRegistry();
    const reg = getGlobalRunRegistry();
    const run = reg.create({ projectId: 'p', agentId: 'cli-claude', prompt: 'x' });
    reg.setStatus(run.id, 'running');
    const rec = reg.get(run.id)!;
    rec.abort = {
      abort: () => {
        throw new Error('nope');
      },
      signal: { aborted: false } as AbortSignal,
    } as AbortController;
    expect(reg.cancel(run.id)).toBe(true);
    expect(reg.get(run.id)?.status).toBe('canceled');
  });

  it('text parser truncates when over maxChars', () => {
    const t = createTextParseState();
    const { accumulated } = feedTextChunk(t, 'abcdefghij', 5);
    expect(accumulated.length).toBe(5);
    expect(accumulated).toBe('fghij');
  });

  it('jsonl feed ignores non-string chunks and blank lines', () => {
    const j = createJsonlParseState();
    const empty = feedJsonlChunk(j, 99 as unknown as string);
    expect(empty.lines).toEqual([]);
    const blanks = feedJsonlChunk(j, '\n\n{"ok":true}\n\n');
    expect(blanks.lines).toEqual([{ ok: true }]);
  });
});


describe('assembleDesignContextPrompt', () => {
  it('prepends DESIGN.md block', () => {
    const out = assembleDesignContextPrompt('Fix hero', {
      name: 'neos-default',
      designMd: '# Brand\nPrimary indigo',
      tokensCss: ':root { --c: #6366f1 }',
    });
    expect(out).toContain('DESIGN CONTEXT');
    expect(out).toContain('neos-default');
    expect(out).toContain('Primary indigo');
    expect(out).toContain('tokens.css');
    expect(out).toContain('Fix hero');
    expect(out.indexOf('DESIGN CONTEXT')).toBeLessThan(out.indexOf('Fix hero'));
  });

  it('returns base when empty or null-byte design', () => {
    expect(assembleDesignContextPrompt('x', null)).toBe('x');
    expect(assembleDesignContextPrompt('x', { designMd: '  ' })).toBe('x');
    expect(assembleDesignContextPrompt('x', { designMd: 'a\0b' })).toBe('x');
  });

  it('truncates overlong designMd and tokensCss', () => {
    const designMd = 'D'.repeat(40_000);
    const tokensCss = 'T'.repeat(10_000);
    const out = assembleDesignContextPrompt('task', {
      name: 'big-system',
      designMd,
      tokensCss,
    });
    expect(out).toMatch(/truncated/i);
    expect(out).toContain('tokens.css');
    expect(out).toMatch(/tokens truncated/i);
    expect(out.length).toBeLessThan(designMd.length + tokensCss.length);
    expect(DESIGN_MD_INJECT_MAX).toBe(32_000);
    expect(TOKENS_INJECT_MAX).toBe(8_000);
  });
});

function designContextMarkerPairs(s: string): number {
  const open = s.match(/<!-- DESIGN CONTEXT -->/g)?.length ?? 0;
  const close = s.match(/<!-- \/DESIGN CONTEXT -->/g)?.length ?? 0;
  return open === close ? open : -1;
}

function buildRules20k(): string {
  const prefix = '# Agent rules\n\n## Tools\n';
  const heading = '\n## Corrections\n';
  const source = '<!-- source: editor -->\n';
  const keep = '- 2026-09-21: keep-me\n';
  let pad = 'H'.repeat(Math.max(9_000 - prefix.length, 0));
  let old = '';
  for (let i = 1; i <= 40; i += 1) {
    const label = i === 1 ? 'stale-padding old-01' : `old-${String(i).padStart(2, '0')}`;
    old += `- 2026-01-${String(Math.min(i, 28)).padStart(2, '0')}: ${label} ${'P'.repeat(220)}\n`;
  }
  let rulesMd = prefix + pad + heading + source + old + keep;
  if (rulesMd.length < 20_000) {
    pad += 'H'.repeat(20_000 - rulesMd.length);
    rulesMd = prefix + pad + heading + source + old + keep;
  }
  return rulesMd;
}

const HARNESS_FRAGMENT = {
  name: 'neos-default',
  designMd: '# Brand\nPrimary indigo',
  rulesMd: '# Agent rules\n- never hex',
  tokensCss: ':root { --c: #6366f1 }',
};

describe('formatDesignHarnessInner', () => {
  it('formatDesignHarnessInner omits DESIGN CONTEXT markers', () => {
    const inner = formatDesignHarnessInner(HARNESS_FRAGMENT);
    expect(inner).toContain('Design system: neos-default');
    expect(inner).toContain('Primary indigo');
    expect(inner).toContain('### RULES.md');
    expect(inner).toContain('never hex');
    expect(inner).toContain('### tokens.css');
    expect(inner).toContain('--c');
    expect(inner).not.toMatch(/DESIGN CONTEXT/);
    expect(inner.indexOf('Primary indigo')).toBeLessThan(inner.indexOf('### RULES.md'));
    expect(inner.indexOf('### RULES.md')).toBeLessThan(inner.indexOf('### tokens.css'));
  });

  it('assembleDesignContextPrompt wrap equals formatDesignHarnessInner plus markers', () => {
    const inner = formatDesignHarnessInner(HARNESS_FRAGMENT);
    const out = assembleDesignContextPrompt('Fix hero', HARNESS_FRAGMENT);
    expect(out.startsWith(`<!-- DESIGN CONTEXT -->\n${inner}\n<!-- /DESIGN CONTEXT -->`)).toBe(true);
    expect(inner).not.toMatch(/DESIGN CONTEXT/);
    expect(designContextMarkerPairs(out)).toBe(1);
    expect(out.endsWith('Fix hero') || out.includes('\nFix hero')).toBe(true);
    const close = '<!-- /DESIGN CONTEXT -->';
    expect(out.indexOf(close)).toBeGreaterThan(-1);
    expect(out.slice(out.indexOf(close) + close.length)).toContain('Fix hero');
  });

  it('rulesMd sits after DESIGN.md and before tokens.css', () => {
    const out = assembleDesignContextPrompt('task', {
      designMd: '# D',
      rulesMd: '# R',
      tokensCss: ':root{}',
    });
    expect(out.indexOf('# D')).toBeLessThan(out.indexOf('### RULES.md'));
    expect(out.indexOf('### RULES.md')).toBeLessThan(out.indexOf('# R'));
    expect(out.indexOf('# R')).toBeLessThan(out.indexOf('### tokens.css'));
    expect(out.indexOf('### tokens.css')).toBeLessThan(out.indexOf('task'));
  });

  it('20k RULES.md head 9k + keep-me tail survives K32 split', () => {
    expect(RULES_MD_INJECT_MAX).toBe(16_000);
    expect(RULES_MD_INJECT_HEAD).toBe(8_000);
    expect(RULES_MD_INJECT_TAIL).toBe(8_000);
    const rulesMd = buildRules20k();
    expect(rulesMd.length).toBeGreaterThanOrEqual(20_000);
    const inner = formatDesignHarnessInner({ designMd: '# D', rulesMd });
    expect(inner).toContain('### RULES.md');
    expect(inner).toContain('keep-me');
    expect(inner).toContain('…[rules truncated]');
    expect(inner).toContain('## Corrections');
    expect(inner).not.toContain('<!-- source:');
    expect(inner).not.toContain('stale-padding');
    expect(inner).not.toContain('H'.repeat(8_500));
  });

  it('rules null-byte omits RULES section and keeps DESIGN', () => {
    const inner = formatDesignHarnessInner({
      designMd: '# KeepDesign',
      rulesMd: 'x\0y',
      tokensCss: ':root { --ok: 1 }',
    });
    expect(inner).toContain('KeepDesign');
    expect(inner).toContain('### tokens.css');
    expect(inner).not.toContain('### RULES.md');
  });

  it('empty / whitespace rulesMd omits ### RULES.md header', () => {
    expect(formatDesignHarnessInner({ designMd: '# D', rulesMd: '  \n  ' })).not.toContain(
      '### RULES.md',
    );
    expect(formatDesignHarnessInner({ designMd: '# D' })).not.toContain('### RULES.md');
    expect(formatDesignHarnessInner({ designMd: '# D' })).toContain('# D');
  });

  it('tokens null-byte omits tokens section and keeps DESIGN + RULES', () => {
    const inner = formatDesignHarnessInner({
      designMd: '# D',
      rulesMd: '# Agent rules',
      tokensCss: 'x\0y',
    });
    expect(inner).toContain('# D');
    expect(inner).toContain('### RULES.md');
    expect(inner).not.toContain('### tokens.css');
  });

  it('no Corrections heading slices RULES from the front at 16k', () => {
    const rulesMd = `${'HEAD'.repeat(5_000)}\n- 2026-09-21: keep-me-at-end`;
    expect(rulesMd.length).toBeGreaterThan(RULES_MD_INJECT_MAX);
    expect(rulesMd).not.toMatch(/##\s+Corrections/i);
    const inner = formatDesignHarnessInner({ designMd: '# D', rulesMd });
    expect(inner).toContain('…[rules truncated]');
    expect(inner).not.toContain('keep-me-at-end');
  });

  it('oversized newest Corrections bullet is sliced to RULES_MD_INJECT_TAIL', () => {
    const giant = `- 2026-09-22: ${'G'.repeat(RULES_MD_INJECT_TAIL + 500)}`;
    const rulesMd = `# Agent rules\n\n## Corrections\n- 2026-09-21: old-keep\n${giant}\n`;
    const inner = formatDesignHarnessInner({ designMd: '# D', rulesMd });
    expect(inner).toContain('### RULES.md');
    expect(inner).toContain('…[rules truncated]');
    expect(inner).not.toContain('G'.repeat(RULES_MD_INJECT_TAIL + 1));
    const rulesSection = inner.slice(inner.indexOf('### RULES.md'));
    expect(rulesSection.length).toBeLessThanOrEqual(RULES_MD_INJECT_MAX + '\n\n…[rules truncated]'.length);
  });

  it('barrel does not export assembleDesignHarnessPrompt', async () => {
    const runtime = await import('./index.js');
    expect('assembleDesignHarnessPrompt' in runtime).toBe(false);
    expect('formatDesignHarnessInner' in runtime).toBe(true);
    expect('DESIGN_HARNESS_WRAP_MAX' in runtime).toBe(true);
    expect(DESIGN_HARNESS_WRAP_MAX).toBe(64_000);
  });
});

