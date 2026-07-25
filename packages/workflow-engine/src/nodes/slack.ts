/**
 * SlackMessageNode — sends a message to a Slack channel via Bot Token.
 * SLACK_BOT_TOKEN must be stored encrypted in server settings DB.
 */

import { WebClient } from '@slack/web-api';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveMessageText, SLACK_CONTENT_MAX_LENGTH } from './message-text.js';

export class SlackMessageNode implements ExecutableNode {
  type = 'slack_message' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const tokenRaw = String(ctx.settings['SLACK_BOT_TOKEN'] ?? '');
    // Reject control chars before trim (leading \r\n must not strip to a valid token)
    const TOKEN_MAX = 8_192;
    if (/[\0\r\n]/.test(tokenRaw)) {
      return {
        ok: false,
        output: null,
        error: 'SLACK_BOT_TOKEN contains invalid control characters',
        durationMs: 0,
      };
    }
    const token = tokenRaw.trim();
    if (!token) {
      return { ok: false, output: null, error: 'SLACK_BOT_TOKEN not set', durationMs: 0 };
    }
    if (token.length > TOKEN_MAX) {
      return {
        ok: false,
        output: null,
        error: `SLACK_BOT_TOKEN exceeds max length (${TOKEN_MAX})`,
        durationMs: 0,
      };
    }

    const channelRaw = String(ctx.config?.['channel'] ?? ctx.inputs['channel'] ?? '');
    const text = resolveMessageText(ctx.config, ctx.inputs);
    /** Slack channel / conversation id practical bound. */
    const CHANNEL_MAX = 200;

    // Reject control chars before trim (log injection / API confusion)
    if (/[\0\r\n]/.test(channelRaw)) {
      return {
        ok: false,
        output: null,
        error: 'Slack channel contains invalid control characters',
        durationMs: 0,
      };
    }
    const channel = channelRaw.trim();
    if (!channel) {
      return { ok: false, output: null, error: 'Slack channel not specified', durationMs: 0 };
    }
    if (channel.length > CHANNEL_MAX) {
      return {
        ok: false,
        output: null,
        error: `Slack channel exceeds max length (${CHANNEL_MAX})`,
        durationMs: 0,
      };
    }

    if (!text.trim()) {
      return { ok: false, output: null, error: 'Slack message text is empty', durationMs: 0 };
    }
    // Null bytes break chat.postMessage payloads
    if (/[\0]/.test(text)) {
      return {
        ok: false,
        output: null,
        error: 'Slack content contains invalid control characters',
        durationMs: 0,
      };
    }
    if (text.length > SLACK_CONTENT_MAX_LENGTH) {
      return {
        ok: false,
        output: null,
        error: `Slack content exceeds ${SLACK_CONTENT_MAX_LENGTH} characters`,
        durationMs: 0,
      };
    }

    try {
      const client = new WebClient(token);
      const result = await client.chat.postMessage({ channel, text });

      if (!result.ok) {
        const apiError = typeof result.error === 'string' && result.error.trim()
          ? result.error.trim()
          : undefined;
        return {
          ok: false,
          output: null,
          error: apiError ? `Slack API error: ${apiError}` : 'Slack API returned ok=false',
          durationMs: Date.now() - start,
        };
      }

      return {
        ok: true,
        output: { ts: result.ts, channel: result.channel },
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : 'Slack send failed',
        durationMs: Date.now() - start,
      };
    }
  }
}
