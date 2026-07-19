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

  it('dedupes keys when multiple nodes share a secret', () => {
    const keys = inferRequiredSettings(tpl('web_search', 'web_search', 'block', 'block'));
    expect(keys.filter((k) => k === 'TAVILY_API_KEY')).toHaveLength(1);
    expect(keys.filter((k) => k === 'KIS_APP_KEY')).toHaveLength(1);
    expect(keys).toHaveLength(3);
  });

  it('unions secrets across mixed node types', () => {
    const keys = inferRequiredSettings(
      tpl('trigger', 'web_search', 'slack_message', 'block', 'output'),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'TAVILY_API_KEY',
        'SLACK_BOT_TOKEN',
        'KIS_APP_KEY',
        'KIS_APP_SECRET',
      ]),
    );
    expect(keys).not.toContain('DISCORD_WEBHOOK_URL');
    expect(keys).toHaveLength(4);
  });
});
