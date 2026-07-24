import { describe, expect, it } from 'vitest';
import {
  DISCORD_CONTENT_MAX_LENGTH,
  isDiscordWebhookUrl,
  SLACK_CONTENT_MAX_LENGTH,
} from './messaging.js';

describe('messaging content limits', () => {
  it('exports Discord/Slack hard limits used by validation and runtime nodes', () => {
    expect(DISCORD_CONTENT_MAX_LENGTH).toBe(2000);
    expect(SLACK_CONTENT_MAX_LENGTH).toBe(4000);
  });
});

describe('isDiscordWebhookUrl', () => {
  it('accepts https discord.com / discordapp.com webhook paths (case-insensitive)', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/1/abc')).toBe(true);
    expect(isDiscordWebhookUrl('  HTTPS://Discord.com/api/webhooks/1/abc  ')).toBe(true);
    expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/9/xyz')).toBe(true);
  });

  it('rejects non-https, wrong host, or non-webhook paths', () => {
    expect(isDiscordWebhookUrl('')).toBe(false);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://evil.example.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/api/channels/1')).toBe(false);
    expect(isDiscordWebhookUrl('not a url')).toBe(false);
  });
});
