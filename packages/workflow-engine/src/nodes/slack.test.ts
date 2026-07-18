import { describe, expect, it } from 'vitest';
import { SlackMessageNode } from './slack.js';
import type { NodeContext } from '../types.js';

function ctx(settings: Record<string, string>, config?: Record<string, unknown>, inputs: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'slack',
    inputs,
    settings,
    config,
  };
}

describe('SlackMessageNode', () => {
  const node = new SlackMessageNode();

  it('requires bot token', async () => {
    const result = await node.execute(ctx({}, { channel: '#general' }, { text: 'hi' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SLACK_BOT_TOKEN/);
  });

  it('requires channel', async () => {
    const result = await node.execute(ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, {}, { text: 'hi' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/channel/);
  });
});
