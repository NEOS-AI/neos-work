/**
 * SlackMessageNode — sends a message to a Slack channel via Bot Token.
 * SLACK_BOT_TOKEN must be stored encrypted in server settings DB.
 */

import { WebClient } from '@slack/web-api';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveMessageText } from './message-text.js';

export class SlackMessageNode implements ExecutableNode {
  type = 'slack_message' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const token = ctx.settings['SLACK_BOT_TOKEN'];
    if (!token) {
      return { ok: false, output: null, error: 'SLACK_BOT_TOKEN not set', durationMs: 0 };
    }

    const channel = String(ctx.config?.['channel'] ?? ctx.inputs['channel'] ?? '');
    const text = resolveMessageText(ctx.config, ctx.inputs);

    if (!channel) {
      return { ok: false, output: null, error: 'Slack channel not specified', durationMs: 0 };
    }

    if (!text.trim()) {
      return { ok: false, output: null, error: 'Slack message text is empty', durationMs: 0 };
    }

    try {
      const client = new WebClient(token);
      const result = await client.chat.postMessage({ channel, text });

      return {
        ok: Boolean(result.ok),
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
