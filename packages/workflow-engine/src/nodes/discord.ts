/**
 * DiscordMessageNode — sends a message via Discord Webhook.
 * DISCORD_WEBHOOK_URL must be stored encrypted in server settings DB.
 * Only discord.com/api/webhooks/ URLs are allowed (SSRF protection).
 */

import { isDiscordWebhookUrl } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { DISCORD_CONTENT_MAX_LENGTH, resolveMessageText } from './message-text.js';
import { scrubErrorMessage } from '@neos-work/core';

export class DiscordMessageNode implements ExecutableNode {
  type = 'discord_message' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const webhookRaw = String(ctx.settings['DISCORD_WEBHOOK_URL'] ?? '');
    // Control-char / overlong reject before trim (header/SSRF hygiene)
    const WEBHOOK_URL_MAX = 2_048;
    if (/[\0\r\n]/.test(webhookRaw) || webhookRaw.length > WEBHOOK_URL_MAX) {
      return {
        ok: false,
        output: null,
        error: 'Invalid Discord webhook URL',
        durationMs: 0,
      };
    }
    const webhookUrl = webhookRaw.trim();
    if (!webhookUrl) {
      return { ok: false, output: null, error: 'DISCORD_WEBHOOK_URL not set', durationMs: 0 };
    }

    // SSRF protection: https + discord.com/discordapp.com + /api/webhooks/
    if (!isDiscordWebhookUrl(webhookUrl)) {
      return {
        ok: false,
        output: null,
        error: 'Invalid Discord webhook URL',
        durationMs: 0,
      };
    }

    const content = resolveMessageText(ctx.config, ctx.inputs);
    if (!content.trim()) {
      return { ok: false, output: null, error: 'Discord message content is empty', durationMs: 0 };
    }
    // Null bytes confuse Discord webhook JSON payloads / logging
    if (/[\0]/.test(content)) {
      return {
        ok: false,
        output: null,
        error: 'Discord content contains invalid control characters',
        durationMs: 0,
      };
    }
    if (content.length > DISCORD_CONTENT_MAX_LENGTH) {
      return {
        ok: false,
        output: null,
        error: `Discord content exceeds ${DISCORD_CONTENT_MAX_LENGTH} characters`,
        durationMs: 0,
      };
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Scrub control chars from webhook error bodies
        const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
        return {
          ok: false,
          output: null,
          error: detail
            ? `Discord webhook error: ${res.status}: ${detail}`
            : `Discord webhook error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      return { ok: true, output: { sent: true }, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: scrubErrorMessage(err instanceof Error ? err.message : 'Discord send failed') || 'Discord send failed',
        durationMs: Date.now() - start,
      };
    }
  }
}
