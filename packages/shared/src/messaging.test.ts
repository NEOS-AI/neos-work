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
    expect(isDiscordWebhookUrl('   ')).toBe(false);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://evil.example.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://cdn.discord.com/api/webhooks/1/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/api/channels/1')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/API/WEBHOOKS/1/abc')).toBe(true); // path case-insensitive
    expect(isDiscordWebhookUrl('not a url')).toBe(false);
    expect(isDiscordWebhookUrl(`https://discord.com/api/webhooks/1/${'a'.repeat(3_000)}`)).toBe(
      false,
    );
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/1/abc\n')).toBe(false);
  });

  it('rejects control-char and overlong webhook URLs', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/1/ab\nc')).toBe(false);
    expect(
      isDiscordWebhookUrl(`https://discord.com/api/webhooks/1/${'a'.repeat(3_000)}`),
    ).toBe(false);
  });

  it('rejects non-string URLs and unparseable values', () => {
    expect(isDiscordWebhookUrl(null as unknown as string)).toBe(false);
    expect(isDiscordWebhookUrl(undefined as unknown as string)).toBe(false);
    expect(isDiscordWebhookUrl(123 as unknown as string)).toBe(false);
    // URL constructor throws for some edge forms after length/control gates pass
    expect(isDiscordWebhookUrl('https://')).toBe(false);
  });
});

