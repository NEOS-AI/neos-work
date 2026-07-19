/**
 * Infer which settings secrets a workflow template needs based on node types/config.
 */

export function inferRequiredSettings(template: {
  nodes: Array<{ type: string; config?: Record<string, unknown> }>;
}): string[] {
  const keys = new Set<string>();
  for (const node of template.nodes) {
    if (node.type === 'web_search') keys.add('TAVILY_API_KEY');
    if (node.type === 'slack_message') keys.add('SLACK_BOT_TOKEN');
    if (node.type === 'discord_message') keys.add('DISCORD_WEBHOOK_URL');
    if (node.type === 'block') {
      keys.add('KIS_APP_KEY');
      keys.add('KIS_APP_SECRET');
    }
    // Media nodes call OpenAI DALL·E / TTS via server (plan Task 7)
    if (node.type === 'media') keys.add('OPENAI_API_KEY');
    // Deploy nodes need provider tokens (plan Task 8)
    if (node.type === 'deploy') {
      const provider =
        typeof node.config?.provider === 'string' ? node.config.provider : 'vercel';
      if (provider === 'cloudflare') {
        keys.add('CLOUDFLARE_API_TOKEN');
        keys.add('CLOUDFLARE_ACCOUNT_ID');
      } else {
        keys.add('VERCEL_API_TOKEN');
      }
    }
  }
  return [...keys];
}
