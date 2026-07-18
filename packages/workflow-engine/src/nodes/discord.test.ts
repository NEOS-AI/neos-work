import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordMessageNode } from './discord.js';
import type { NodeContext } from '../types.js';

function makeCtx(settings: Record<string, string>, inputs: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'discord',
    inputs,
    settings,
  };
}

describe('DiscordMessageNode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails when webhook URL is missing', async () => {
    const node = new DiscordMessageNode();
    const result = await node.execute(makeCtx({}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DISCORD_WEBHOOK_URL/);
  });

  it('rejects non-discord URLs (SSRF protection)', async () => {
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://evil.example.com/hook' }, { text: 'hi' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid Discord webhook URL/);
  });

  it('posts to a valid discord webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const node = new DiscordMessageNode();
    const url = 'https://discord.com/api/webhooks/123/token';
    const result = await node.execute(makeCtx({ DISCORD_WEBHOOK_URL: url }, { text: 'hello' }));

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ content: 'hello' });
  });

  it('surfaces non-ok HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});
