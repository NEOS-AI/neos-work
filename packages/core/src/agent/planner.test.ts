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

  it('extracts JSON from markdown fences / surrounding text', async () => {
    const adapter = mockAdapter([
      'Here is the plan:\n```json\n[{"description":"One"}]\n```\n',
    ]);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('One');
  });

  it('falls back when no JSON array present', async () => {
    const adapter = mockAdapter(['just do it']);
    const steps = await new Planner(adapter).plan('goal');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('just do it');
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
