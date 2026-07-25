import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordMessageNode } from './discord.js';
import type { NodeContext } from '../types.js';

function makeCtx(
  settings: Record<string, string>,
  inputs: Record<string, unknown> = {},
  config?: Record<string, unknown>,
): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'discord',
    inputs,
    settings,
    config,
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

  it('rejects control-char or overlong webhook URLs', async () => {
    const node = new DiscordMessageNode();
    const ctrl = await node.execute(
      makeCtx(
        { DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/1/ab${'\n'}c` },
        { text: 'hi' },
      ),
    );
    expect(ctrl.ok).toBe(false);
    expect(ctrl.error).toMatch(/Invalid Discord webhook URL/);
    const long = await node.execute(
      makeCtx(
        { DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/1/${'t'.repeat(2_100)}` },
        { text: 'hi' },
      ),
    );
    expect(long.ok).toBe(false);
    expect(long.error).toMatch(/Invalid Discord webhook URL/);
  });

  it('rejects null-byte content', async () => {
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx(
        { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' },
        { text: `hello${'\0'}world` },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/control characters/i);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '  internal boom  ',
    }));
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
    expect(result.error).toMatch(/internal boom/);
  });

  it('scrubs control characters from webhook error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => `invalid\nrequest${'\0'}`,
      }),
    );
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/400/);
    expect(result.error).toContain('invalid request');
    expect(result.error).not.toMatch(/\n/);
    expect(result.error).not.toContain('\0');
  });

  it('truncates long Discord error bodies to 500 chars', async () => {
    const long = 'z'.repeat(800);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => long,
      }),
    );
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    // "Discord webhook error: 429: " + 500 body chars
    expect(result.error).toMatch(/^Discord webhook error: 429: z{500}$/);
  });

  it('uses textTemplate with interpolation for webhook content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const node = new DiscordMessageNode();
    const url = 'https://discord.com/api/webhooks/123/token';
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: url }, { name: 'world' }, { textTemplate: 'Hello {{name}}' }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ content: 'Hello world' });
  });

  it('rejects empty content', async () => {
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, {}),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('trims webhook URL before SSRF check and send', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const node = new DiscordMessageNode();
    const url = 'https://discord.com/api/webhooks/123/token';
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: `  ${url}  ` }, { text: 'padded' }),
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.any(Object));
  });

  it('treats whitespace-only webhook URL as missing', async () => {
    const node = new DiscordMessageNode();
    const result = await node.execute(makeCtx({ DISCORD_WEBHOOK_URL: '   ' }, { text: 'hi' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DISCORD_WEBHOOK_URL/);
  });

  it('rejects content longer than 2000 characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx(
        { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' },
        {},
        { textTemplate: 'x'.repeat(2001) },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/2000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows content at the 2000 character limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const node = new DiscordMessageNode();
    const body = 'y'.repeat(2000);
    const result = await node.execute(
      makeCtx(
        { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' },
        {},
        { textTemplate: body },
      ),
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ content: body });
  });

  it('accepts case-insensitive Discord webhook host prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const node = new DiscordMessageNode();
    const url = 'HTTPS://Discord.com/api/webhooks/123/token';
    const result = await node.execute(makeCtx({ DISCORD_WEBHOOK_URL: url }, { text: 'hi' }));
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(url);
  });

  it('uses status-only error when webhook body is empty after scrub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '\n\r\0  ',
      }),
    );
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Discord webhook error: 503');
  });

  it('surfaces network failures from fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const node = new DiscordMessageNode();
    const result = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('not-an-error'));
    const result2 = await node.execute(
      makeCtx({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc' }, { text: 'x' }),
    );
    expect(result2.ok).toBe(false);
    expect(result2.error).toBe('Discord send failed');
  });
});
