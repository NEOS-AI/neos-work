import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, ts: '1.234', channel: 'C123' }),
);

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage };
  },
}));

import { SlackMessageNode } from './slack.js';
import type { NodeContext } from '../types.js';

function ctx(
  settings: Record<string, string>,
  config?: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
): NodeContext {
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

  beforeEach(() => {
    postMessage.mockClear();
    postMessage.mockResolvedValue({ ok: true, ts: '1.234', channel: 'C123' });
  });

  it('requires bot token', async () => {
    const result = await node.execute(ctx({}, { channel: '#general' }, { text: 'hi' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SLACK_BOT_TOKEN/);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('requires channel', async () => {
    const result = await node.execute(ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, {}, { text: 'hi' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/channel/);
  });

  it('rejects whitespace-only channel', async () => {
    const result = await node.execute(
      ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '   ' }, { text: 'hi' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/channel/);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('rejects empty message when no template or inputs', async () => {
    const result = await node.execute(ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '#x' }, {}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('posts textTemplate with interpolated inputs', async () => {
    const result = await node.execute(
      ctx(
        { SLACK_BOT_TOKEN: 'xoxb-test' },
        { channel: '#alerts', textTemplate: 'Status: {{status}}' },
        { status: 'green' },
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ ts: '1.234', channel: 'C123' });
    expect(postMessage).toHaveBeenCalledWith({
      channel: '#alerts',
      text: 'Status: green',
    });
  });

  it('falls back to inputs.text when no template', async () => {
    const result = await node.execute(
      ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '#general' }, { text: 'plain' }),
    );
    expect(result.ok).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ channel: '#general', text: 'plain' });
  });

  it('surfaces Slack API failures', async () => {
    postMessage.mockRejectedValueOnce(new Error('rate limited'));
    const result = await node.execute(
      ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '#x' }, { text: 'hi' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/);
  });

  it('fails when Slack returns ok=false without throwing', async () => {
    postMessage.mockResolvedValueOnce({ ok: false, ts: undefined, channel: undefined });
    const result = await node.execute(
      ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '#x' }, { text: 'hi' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ok=false/);
  });

  it('rejects content longer than 4000 characters', async () => {
    const result = await node.execute(
      ctx(
        { SLACK_BOT_TOKEN: 'xoxb-test' },
        { channel: '#x', textTemplate: 'z'.repeat(4001) },
        {},
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/4000/);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('allows content at the 4000 character limit', async () => {
    const body = 'w'.repeat(4000);
    const result = await node.execute(
      ctx({ SLACK_BOT_TOKEN: 'xoxb-test' }, { channel: '#x', textTemplate: body }, {}),
    );
    expect(result.ok).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ channel: '#x', text: body });
  });
});
