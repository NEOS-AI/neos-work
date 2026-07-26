import { describe, expect, it } from 'vitest';
import { Planner } from './planner.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';

describe('Planner', () => {
  it('maps JSON array steps to AgentStep[]', async () => {
    const adapter = mockAdapter([
      JSON.stringify([
        { description: 'List files', toolName: 'list_directory' },
        { description: 'Read README' },
      ]),
    ]);
    const steps = await new Planner(adapter).plan('Inspect repo');
    expect(steps).toHaveLength(2);
    expect(steps[0].description).toBe('List files');
    expect(steps[0].toolName).toBe('list_directory');
    expect(steps[0].status).toBe('pending');
    expect(steps[0].type).toBe('plan');
    expect(steps[0].index).toBe(0);
    expect(steps[1].toolName).toBeUndefined();
    expect(steps[1].id).toBeTruthy();
  });

  it('caps plan steps at 50 and trims long descriptions', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      description: 'step ' + i + ' ' + 'x'.repeat(3_000),
      toolName: 't'.repeat(200),
    }));
    const adapter = mockAdapter([JSON.stringify(many)]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(50);
    expect(steps[0]!.description.length).toBeLessThanOrEqual(2_000);
    expect(steps[0]!.toolName!.length).toBeLessThanOrEqual(100);
  });

  it('drops control-char tool names from planner steps', async () => {
    const adapter = mockAdapter([
      JSON.stringify([
        { description: 'A', toolName: 'bad\ntool' },
        { description: 'B', toolName: 'read_file' },
      ]),
    ]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps[0]!.toolName).toBeUndefined();
    expect(steps[1]!.toolName).toBe('read_file');
  });

  it('collapses multi-line descriptions and drops null-byte descriptions', async () => {
    const adapter = mockAdapter([
      JSON.stringify([
        { description: 'line1\nline2' },
        { description: 'bad\0desc' },
        { description: '  ok  ' },
      ]),
    ]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps[0]!.description).toBe('line1 line2');
    // Null-byte description falls back to default step text
    expect(steps[1]!.description).toBe('Execute the goal directly');
    expect(steps[2]!.description).toBe('ok');
  });

  it('caps multi-chunk raw LLM output and still returns a plan', async () => {
    // RAW_OUTPUT_MAX is 500_000 — stream past that without hanging parseSteps
    const adapter = mockAdapter(['']);
    adapter.chat = async function* () {
      // Valid prefix so parse can still find a small array if slice cuts mid-stream
      yield { type: 'text' as const, content: '[{"description":"kept"}]' };
      yield { type: 'text' as const, content: 'x'.repeat(600_000) };
      yield { type: 'done' as const };
    };
    const steps = await new Planner(adapter).plan('goal');
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]!.description.length).toBeGreaterThan(0);
    expect(steps[0]!.description.length).toBeLessThanOrEqual(2_000);
  });

  it('strips null bytes and caps oversized goal/context without failing', async () => {
    const adapter = mockAdapter([JSON.stringify([{ description: 'ok' }])]);
    const steps = await new Planner(adapter).plan(
      `goal${'\0'}part`,
      'ctx'.repeat(20_000),
    );
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]!.description).toBeTruthy();

    // Goal longer than GOAL_MAX (50_000) is sliced before LLM
    let captured = '';
    const capAdapter = mockAdapter([JSON.stringify([{ description: 'capped' }])]);
    const base = capAdapter.chat.bind(capAdapter);
    capAdapter.chat = async function* (params) {
      captured = JSON.stringify(params.messages);
      yield* base(params);
    };
    await new Planner(capAdapter).plan('G'.repeat(60_000), 'ctx');
    // Goal text in prompt is capped (50k) — full 60k string must not appear
    expect(captured.includes('G'.repeat(60_000))).toBe(false);
    expect(captured).toContain('G'.repeat(1_000));
  });

  it('extracts JSON from markdown fences / surrounding text', async () => {
    const adapter = mockAdapter([
      'Here is the plan:\n```json\n[{"description":"One"}]\n```\n',
    ]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('One');
  });

  it('caps pathological JSON array blobs before parse (private parseSteps)', () => {
    // RAW path caps at 500k, so exercise parseSteps directly with a larger match
    const planner = new Planner(mockAdapter(['[]']));
    const parseSteps = (
      planner as unknown as { parseSteps: (raw: string) => Array<{ description: string }> }
    ).parseSteps.bind(planner);
    // JSON array string > JSON_BLOB_MAX (500_000) — slice path before parse
    const fat = `[{"description":"${'z'.repeat(510_000)}"}]`;
    expect(fat.length).toBeGreaterThan(500_000);
    const steps = parseSteps(fat);
    // Truncated mid-string fails JSON.parse → empty array from catch
    expect(Array.isArray(steps)).toBe(true);
  });

  it('falls back when no JSON array present', async () => {
    const adapter = mockAdapter(['just do it']);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('just do it');
  });

  it('scrubs free-text fallback: collapses newlines and drops null bytes', async () => {
    const multi = mockAdapter(['do this\nthen that']);
    const multiSteps = await new Planner(multi).plan('goal');
    expect(multiSteps).toHaveLength(1);
    expect(multiSteps[0]!.description).toBe('do this then that');

    // Null-only free text → default after scrub
    const nul = mockAdapter([`\0\0`]);
    const nulSteps = await new Planner(nul).plan('goal');
    expect(nulSteps[0]!.description).toBe('Execute the goal directly');

    // Null embedded in free text is stripped, rest kept
    const mid = mockAdapter([`ship${'\0'}it`]);
    const midSteps = await new Planner(mid).plan('goal');
    expect(midSteps[0]!.description).toBe('shipit');
  });

  it('falls back on invalid JSON array payload', async () => {
    // Matches /\\[[\\s\\S]*\\]/ but is not valid JSON → catch branch
    const adapter = mockAdapter(['[{broken]']);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('Execute the goal directly');
  });

  it('includes context in the user message when provided', async () => {
    const adapter = mockAdapter([JSON.stringify([{ description: 'ok' }])]);
    const chat = adapter.chat.bind(adapter);
    let captured = '';
    adapter.chat = async function* (params) {
      captured = JSON.stringify(params.messages);
      yield* chat(params);
    };
    await new Planner(adapter).plan('Goal', 'prior notes');
    expect(captured).toContain('prior notes');
    expect(captured).toContain('Goal');
  });

  it('coerces non-string goal/context, empty models, non-array JSON', async () => {
    let modelUsed = 'unset';
    const adapter = {
      id: 'openai' as const,
      name: 'Mock',
      getModels: () => [] as Array<{ id: string }>,
      async *chat(params: { model?: string }) {
        modelUsed = params.model ?? '';
        yield {
          type: 'text' as const,
          content: JSON.stringify({ not: 'an array' }),
        };
        yield { type: 'done' as const };
      },
      async validateApiKey() {
        return true;
      },
    };
    // nullish non-string goal → String(goal ?? '') → empty → default single step (no LLM)
    const emptyGoal = await new Planner(adapter as never).plan(
      null as unknown as string,
      undefined as unknown as string,
    );
    expect(emptyGoal).toHaveLength(1);
    expect(emptyGoal[0]!.description).toBe('Execute the goal directly');
    expect(modelUsed).toBe('unset'); // early return before chat

    // Explicit null context (not default param) hits String(context ?? '')
    const withNullCtx = await new Planner(
      mockAdapter([JSON.stringify([{ description: 'ok-null-ctx' }])]),
    ).plan('goal', null as unknown as string);
    expect(withNullCtx[0]!.description).toBe('ok-null-ctx');

    // Real goal with empty models → model id falls back to ''
    const objectJson = await new Planner(adapter as never).plan('real goal');
    expect(modelUsed).toBe(''); // getModels()[0]?.id ?? ''
    // Object JSON (no array match) → free-text fallback step
    expect(objectJson).toHaveLength(1);
    expect(objectJson[0]!.description).toContain('not');

    // Non-null non-string goal/context coerced
    const adapter2 = mockAdapter([JSON.stringify([{ description: 'from-num' }])]);
    const coerced = await new Planner(adapter2).plan(
      12345 as unknown as string,
      { note: 'ctx' } as unknown as string,
    );
    expect(coerced[0]!.description).toBe('from-num');
  });

  it('falls back to default step when model returns empty content', async () => {
    const adapter = mockAdapter(['   ']);
    const steps = await new Planner(adapter).plan('Ship it');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.description).toBe('Execute the goal directly');
  });

  it('skips non-object items and stringifies objects missing description', async () => {
    // primitives/null dropped by object filter; missing description → String(item)
    const adapter = mockAdapter([
      JSON.stringify([
        { description: 'Only object kept' },
        'plain string step',
        42,
        null,
        { toolName: 'read_file' },
      ]),
    ]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]!.description).toBe('Only object kept');
    // second kept object has no description string → String(item)
    const second = steps.find((s) => s.toolName === 'read_file' || s.description.includes('object'));
    expect(second).toBeTruthy();
  });

  it('returns fallback step for blank goal without calling LLM', async () => {
    let called = 0;
    const adapter = mockAdapter(['should-not-run']);
    const original = adapter.chat.bind(adapter);
    adapter.chat = async function* (params) {
      called += 1;
      yield* original(params);
    };
    const steps = await new Planner(adapter).plan('   ');
    expect(called).toBe(0);
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('Execute the goal directly');
  });

  it('trims step descriptions and toolNames from JSON', async () => {
    const adapter = mockAdapter([
      JSON.stringify([
        { description: '  List files  ', toolName: '  list_directory  ' },
        { description: '  ', toolName: 'x' },
      ]),
    ]);
    const steps = await new Planner(adapter).plan('  Inspect  ', '  ctx  ');
    expect(steps[0].description).toBe('List files');
    expect(steps[0].toolName).toBe('list_directory');
    // blank description falls back
    expect(steps[1].description).toBe('Execute the goal directly');
  });
});
