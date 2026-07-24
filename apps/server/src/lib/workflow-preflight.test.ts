import { describe, expect, it } from 'vitest';
import { assessWorkflowPreflight } from './workflow-preflight.js';

const base = {
  nodes: [
    { id: 't', type: 'trigger', config: {} },
    { id: 'o', type: 'output', config: {} },
  ],
  edges: [{ id: 'e1', source: 't', target: 'o' }],
};

describe('assessWorkflowPreflight', () => {
  it('passes a minimal trigger→output graph', () => {
    const r = assessWorkflowPreflight(base, {});
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('accepts edge endpoints with surrounding whitespace', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: base.nodes,
        edges: [{ id: 'e1', source: '  t  ', target: '  o  ' }],
      },
      {},
    );
    expect(r.issues.some((i) => i.code === 'dangling_edge')).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('flags blank edge endpoints as dangling', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: base.nodes,
        edges: [{ id: 'e1', source: '   ', target: 'o' }],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'dangling_edge')).toBe(true);
  });

  it('errors when web_search lacks Tavily key', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          ...base.nodes,
          { id: 's', type: 'web_search', config: { query: 'x' } },
        ],
        edges: [
          { id: 'e1', source: 't', target: 's' },
          { id: 'e2', source: 's', target: 'o' },
        ],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_tavily_key')).toBe(true);
  });

  it('errors for media without OpenAI key', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'm', type: 'media', config: { mediaType: 'image', prompt: 'a' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'm' },
          { id: 'e2', source: 'm', target: 'o' },
        ],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_openai_key')).toBe(true);
  });

  it('skips API key checks for CLI agent providers', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_coding', config: { provider: 'cli-claude' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(r.issues.some((i) => i.code === 'missing_anthropic_key')).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('requires Vercel token for vercel deploy', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: 'vercel' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_vercel_token')).toBe(true);
  });

  it('flags invalid deploy project names when non-empty', () => {
    const bad = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: 'vercel', projectName: '-bad' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      { VERCEL_API_TOKEN: 'tok' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'invalid_deploy_project')).toBe(true);

    const blankOk = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: 'vercel', projectName: '   ' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      { VERCEL_API_TOKEN: 'tok' },
    );
    // Blank falls back to neos-deploy at runtime — not an invalid_deploy_project error
    expect(blankOk.issues.some((i) => i.code === 'invalid_deploy_project')).toBe(false);
  });

  it('defaults missing or unknown deploy provider to vercel for token checks', () => {
    for (const config of [{}, { provider: 'netlify' }] as const) {
      const r = assessWorkflowPreflight(
        {
          nodes: [
            { id: 't', type: 'trigger', config: {} },
            { id: 'd', type: 'deploy', config },
            { id: 'o', type: 'output', config: {} },
          ],
          edges: [
            { id: 'e1', source: 't', target: 'd' },
            { id: 'e2', source: 'd', target: 'o' },
          ],
        },
        {},
      );
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.code === 'missing_vercel_token')).toBe(true);
    }

    const withToken = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: 'netlify' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      { VERCEL_API_TOKEN: 'v' },
    );
    expect(withToken.issues.some((i) => i.code === 'missing_vercel_token')).toBe(false);
  });

  it('skips cloud API key checks for ollama agents', () => {
    for (const config of [
      { llmProvider: 'ollama' },
      { provider: 'ollama' },
    ]) {
      const r = assessWorkflowPreflight(
        {
          nodes: [
            { id: 't', type: 'trigger', config: {} },
            { id: 'a', type: 'agent_coding', config },
            { id: 'o', type: 'output', config: {} },
          ],
          edges: [
            { id: 'e1', source: 't', target: 'a' },
            { id: 'e2', source: 'a', target: 'o' },
          ],
        },
        {},
      );
      expect(r.issues.some((i) => i.code === 'missing_anthropic_key')).toBe(false);
      expect(r.issues.some((i) => i.code === 'missing_openai_key')).toBe(false);
      expect(r.ok).toBe(true);
    }
  });

  it('requires OpenAI key for openai agents', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_finance', config: { llmProvider: 'openai' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_openai_key')).toBe(true);
  });

  it('trims/lowercases agent provider so padded OpenAI and CLI match', () => {
    const missing = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_coding', config: { llmProvider: '  OpenAI  ' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => i.code === 'missing_openai_key')).toBe(true);

    const cli = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_coding', config: { provider: '  CLI-Claude  ' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(cli.issues.some((i) => i.code === 'missing_openai_key')).toBe(false);
    expect(cli.issues.some((i) => i.code === 'missing_anthropic_key')).toBe(false);
  });

  it('requires Cloudflare credentials for cloudflare deploy', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: 'cloudflare' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      { CLOUDFLARE_API_TOKEN: 'only-token' },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_cloudflare_creds')).toBe(true);

    // padded provider still treated as cloudflare
    const padded = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'deploy', config: { provider: '  CloudFlare  ' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      {},
    );
    expect(padded.issues.some((i) => i.code === 'missing_cloudflare_creds')).toBe(true);
    expect(padded.issues.some((i) => i.code === 'missing_vercel_token')).toBe(false);
  });

  it('requires Slack and Discord secrets when those nodes exist', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'sl', type: 'slack_message', config: { channel: '#x' } },
          { id: 'di', type: 'discord_message', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'sl' },
          { id: 'e2', source: 'sl', target: 'di' },
          { id: 'e3', source: 'di', target: 'o' },
        ],
      },
      {},
    );
    expect(r.issues.some((i) => i.code === 'missing_slack_token')).toBe(true);
    expect(r.issues.some((i) => i.code === 'missing_discord_webhook')).toBe(true);
  });

  it('requires Anthropic key for default agent and Google for google provider', () => {
    const noKey = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_finance', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(noKey.issues.some((i) => i.code === 'missing_anthropic_key')).toBe(true);

    const google = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_coding', config: { llmProvider: 'google' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      {},
    );
    expect(google.issues.some((i) => i.code === 'missing_google_key')).toBe(true);
  });

  it('passes when required secrets are present', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 's', type: 'web_search', config: {} },
          { id: 'm', type: 'media', config: { mediaType: 'image' } },
          { id: 'a', type: 'agent_coding', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 's' },
          { id: 'e2', source: 's', target: 'm' },
          { id: 'e3', source: 'm', target: 'a' },
          { id: 'e4', source: 'a', target: 'o' },
        ],
      },
      {
        TAVILY_API_KEY: 'tv',
        OPENAI_API_KEY: 'sk',
        ANTHROPIC_API_KEY: 'ant',
      },
    );
    expect(r.ok).toBe(true);
  });

  it('flags missing trigger and dangling edges', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [{ id: 'o', type: 'output', config: {} }],
        edges: [{ id: 'e1', source: 'missing', target: 'o' }],
      },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'no_trigger')).toBe(true);
    expect(r.issues.some((i) => i.code === 'dangling_edge')).toBe(true);

    const blankEdge = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [{ id: 'e1', source: '  ', target: 'o' }],
      },
      {},
    );
    expect(blankEdge.issues.some((i) => i.code === 'dangling_edge')).toBe(true);
  });

  it('treats whitespace-only secrets as missing', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 's', type: 'web_search', config: {} },
          { id: 'sl', type: 'slack_message', config: { channel: '#x' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 's' },
          { id: 'e2', source: 's', target: 'sl' },
          { id: 'e3', source: 'sl', target: 'o' },
        ],
      },
      { TAVILY_API_KEY: '   ', SLACK_BOT_TOKEN: '\t' },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_tavily_key')).toBe(true);
    expect(r.issues.some((i) => i.code === 'missing_slack_token')).toBe(true);
  });

  it('flags invalid Discord webhook URLs (SSRF allow-list)', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'di', type: 'discord_message', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'di' },
          { id: 'e2', source: 'di', target: 'o' },
        ],
      },
      { DISCORD_WEBHOOK_URL: 'https://evil.example.com/hooks/1' },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'invalid_discord_webhook')).toBe(true);
    expect(r.issues.some((i) => i.code === 'missing_discord_webhook')).toBe(false);
  });

  it('accepts a valid Discord webhook prefix', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'di', type: 'discord_message', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'di' },
          { id: 'e2', source: 'di', target: 'o' },
        ],
      },
      { DISCORD_WEBHOOK_URL: '  https://discord.com/api/webhooks/1/token  ' },
    );
    expect(r.issues.some((i) => i.code === 'invalid_discord_webhook')).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_discord_webhook')).toBe(false);
  });

  it('accepts case-insensitive Discord webhook prefix', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'd', type: 'discord_message', config: {} },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'd' },
          { id: 'e2', source: 'd', target: 'o' },
        ],
      },
      { DISCORD_WEBHOOK_URL: 'HTTPS://Discord.com/api/webhooks/1/token' },
    );
    expect(r.issues.some((i) => i.code === 'invalid_discord_webhook')).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_discord_webhook')).toBe(false);
  });

  it('treats whitespace-only agent API keys as missing', () => {
    const r = assessWorkflowPreflight(
      {
        nodes: [
          { id: 't', type: 'trigger', config: {} },
          { id: 'a', type: 'agent_coding', config: { llmProvider: 'google' } },
          { id: 'o', type: 'output', config: {} },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'o' },
        ],
      },
      { GOOGLE_API_KEY: '  \t  ' },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'missing_google_key')).toBe(true);
  });
});
