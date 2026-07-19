import { describe, expect, it } from 'vitest';
import { inferRequiredSettings } from './template-required-settings.js';

function tpl(...types: string[]) {
  return { nodes: types.map((type, i) => ({ type, id: `n${i}` })) };
}

describe('inferRequiredSettings', () => {
  it('returns empty for templates without secret-backed nodes', () => {
    expect(inferRequiredSettings(tpl('trigger', 'output', 'agent_coding'))).toEqual([]);
  });

  it('maps web_search to TAVILY_API_KEY', () => {
    expect(inferRequiredSettings(tpl('web_search'))).toEqual(['TAVILY_API_KEY']);
  });

  it('maps slack and discord message nodes', () => {
    const keys = inferRequiredSettings(tpl('slack_message', 'discord_message'));
    expect(keys).toEqual(expect.arrayContaining(['SLACK_BOT_TOKEN', 'DISCORD_WEBHOOK_URL']));
    expect(keys).toHaveLength(2);
  });

  it('maps block nodes to KIS app key pair', () => {
    const keys = inferRequiredSettings(tpl('block'));
    expect(keys).toEqual(expect.arrayContaining(['KIS_APP_KEY', 'KIS_APP_SECRET']));
    expect(keys).toHaveLength(2);
  });

  it('maps media to OPENAI_API_KEY', () => {
    expect(inferRequiredSettings(tpl('media'))).toEqual(['OPENAI_API_KEY']);
  });

  it('maps deploy to vercel token by default and cloudflare pair when configured', () => {
    expect(
      inferRequiredSettings({
        nodes: [{ type: 'deploy', config: {} }],
      }),
    ).toEqual(['VERCEL_API_TOKEN']);
    expect(
      inferRequiredSettings({
        nodes: [{ type: 'deploy', config: { provider: 'vercel' } }],
      }),
    ).toEqual(['VERCEL_API_TOKEN']);
    expect(
      inferRequiredSettings({
        nodes: [{ type: 'deploy', config: { provider: 'cloudflare' } }],
      }),
    ).toEqual(expect.arrayContaining(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']));
    // unknown provider treated as vercel default
    expect(
      inferRequiredSettings({
        nodes: [{ type: 'deploy', config: { provider: 'netlify' } }],
      }),
    ).toEqual(['VERCEL_API_TOKEN']);
  });

  it('unions media and deploy secrets without duplicating openai key', () => {
    const keys = inferRequiredSettings({
      nodes: [
        { type: 'media' },
        { type: 'media' },
        { type: 'deploy', config: { provider: 'vercel' } },
      ],
    });
    expect(keys.filter((k) => k === 'OPENAI_API_KEY')).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'VERCEL_API_TOKEN']));
    expect(keys).toHaveLength(2);
  });

  it('dedupes keys when multiple nodes share a secret', () => {
    const keys = inferRequiredSettings(tpl('web_search', 'web_search', 'block', 'block'));
    expect(keys.filter((k) => k === 'TAVILY_API_KEY')).toHaveLength(1);
    expect(keys.filter((k) => k === 'KIS_APP_KEY')).toHaveLength(1);
    expect(keys).toHaveLength(3);
  });

  it('unions secrets across mixed node types', () => {
    const keys = inferRequiredSettings(
      tpl('trigger', 'web_search', 'slack_message', 'block', 'media', 'output'),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'TAVILY_API_KEY',
        'SLACK_BOT_TOKEN',
        'KIS_APP_KEY',
        'KIS_APP_SECRET',
        'OPENAI_API_KEY',
      ]),
    );
    expect(keys).not.toContain('DISCORD_WEBHOOK_URL');
    expect(keys).toHaveLength(5);
  });
});
