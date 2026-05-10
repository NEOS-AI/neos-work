/**
 * DiscordMessageNode — sends a message via Discord Webhook.
 * DISCORD_WEBHOOK_URL must be stored encrypted in server settings DB.
 * Only discord.com/api/webhooks/ URLs are allowed (SSRF protection).
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

const DISCORD_WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';

export class DiscordMessageNode implements ExecutableNode {
  type = 'discord_message' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const webhookUrl = ctx.settings['DISCORD_WEBHOOK_URL'];
    if (!webhookUrl) {
      return { ok: false, output: null, error: 'DISCORD_WEBHOOK_URL not set', durationMs: 0 };
    }

    // SSRF protection: only allow discord.com webhook URLs
    if (!webhookUrl.startsWith(DISCORD_WEBHOOK_PREFIX)) {
      return {
        ok: false,
        output: null,
        error: 'Invalid Discord webhook URL',
        durationMs: 0,
      };
    }

    const content = String(ctx.inputs['text'] ?? JSON.stringify(ctx.inputs));

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          output: null,
          error: `Discord webhook error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      return { ok: true, output: { sent: true }, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : 'Discord send failed',
        durationMs: Date.now() - start,
      };
    }
  }
}
