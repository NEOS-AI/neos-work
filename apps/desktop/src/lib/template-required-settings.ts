/**
 * Infer which settings secrets a workflow template needs based on node types.
 */

export function inferRequiredSettings(template: {
  nodes: Array<{ type: string }>;
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
  }
  return [...keys];
}
