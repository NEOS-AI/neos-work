/**
 * Workflow preflight — structural + settings readiness checks (plan polish).
 * Used by POST /api/workflow/:id/preflight before a run.
 */

export interface PreflightIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

export interface WorkflowLike {
  nodes: Array<{ id: string; type: string; label?: string; config?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

/**
 * Assess whether a workflow is ready to run given available secrets/settings.
 */
export function assessWorkflowPreflight(
  workflow: WorkflowLike,
  secrets: Record<string, string>,
): { ok: boolean; issues: PreflightIssue[] } {
  const issues: PreflightIssue[] = [];
  const nodes = workflow.nodes ?? [];
  const edges = workflow.edges ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  if (!nodes.some((n) => n.type === 'trigger')) {
    issues.push({ code: 'no_trigger', severity: 'error', message: 'Workflow has no trigger node.' });
  }
  if (!nodes.some((n) => n.type === 'output')) {
    issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        message: 'Edge points to a missing node.',
      });
    }
  }

  for (const node of nodes) {
    const config = node.config ?? {};

    if (node.type === 'web_search' && !secrets.TAVILY_API_KEY) {
      issues.push({
        code: 'missing_tavily_key',
        severity: 'error',
        nodeId: node.id,
        message: 'Web Search requires TAVILY_API_KEY in settings.',
      });
    }

    if (node.type === 'slack_message' && !secrets.SLACK_BOT_TOKEN) {
      issues.push({
        code: 'missing_slack_token',
        severity: 'error',
        nodeId: node.id,
        message: 'Slack node requires SLACK_BOT_TOKEN in settings.',
      });
    }

    if (node.type === 'discord_message' && !secrets.DISCORD_WEBHOOK_URL) {
      issues.push({
        code: 'missing_discord_webhook',
        severity: 'error',
        nodeId: node.id,
        message: 'Discord node requires DISCORD_WEBHOOK_URL in settings.',
      });
    }

    if (node.type === 'media' && !secrets.OPENAI_API_KEY) {
      issues.push({
        code: 'missing_openai_key',
        severity: 'error',
        nodeId: node.id,
        message: 'Media node requires OPENAI_API_KEY in settings.',
      });
    }

    if (node.type === 'deploy') {
      // Match DeployNode runtime: unknown/missing provider defaults to vercel
      const provider = config.provider === 'cloudflare' ? 'cloudflare' : 'vercel';
      if (provider === 'vercel' && !secrets.VERCEL_API_TOKEN) {
        issues.push({
          code: 'missing_vercel_token',
          severity: 'error',
          nodeId: node.id,
          message: 'Deploy (Vercel) requires VERCEL_API_TOKEN in settings.',
        });
      }
      if (provider === 'cloudflare' && (!secrets.CLOUDFLARE_API_TOKEN || !secrets.CLOUDFLARE_ACCOUNT_ID)) {
        issues.push({
          code: 'missing_cloudflare_creds',
          severity: 'error',
          nodeId: node.id,
          message: 'Deploy (Cloudflare) requires API token and account id in settings.',
        });
      }
    }

    if (node.type === 'agent_finance' || node.type === 'agent_coding') {
      const provider = (config.provider ?? config.llmProvider ?? secrets.llmProvider ?? 'anthropic') as string;
      if (provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex') {
        // CLI path — runtime detect; soft warning only
        continue;
      }
      if (provider === 'ollama') {
        // Local Ollama — no cloud API key required
        continue;
      }
      if (provider === 'openai' && !secrets.OPENAI_API_KEY) {
        issues.push({
          code: 'missing_openai_key',
          severity: 'error',
          nodeId: node.id,
          message: 'OpenAI agent requires OPENAI_API_KEY in settings.',
        });
      } else if (provider === 'google' && !secrets.GOOGLE_API_KEY) {
        issues.push({
          code: 'missing_google_key',
          severity: 'error',
          nodeId: node.id,
          message: 'Google agent requires GOOGLE_API_KEY in settings.',
        });
      } else if (provider === 'anthropic' || !provider) {
        if (!secrets.ANTHROPIC_API_KEY) {
          issues.push({
            code: 'missing_anthropic_key',
            severity: 'error',
            nodeId: node.id,
            message: 'Anthropic agent requires ANTHROPIC_API_KEY in settings.',
          });
        }
      }
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return { ok: !hasError, issues };
}
