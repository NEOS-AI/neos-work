/**
 * Workflow preflight — structural + settings readiness checks (plan polish).
 * Used by POST /api/workflow/:id/preflight before a run.
 */

import { isValidDeployProjectName } from '@neos-work/shared';

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

const DISCORD_WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';

/** Treat missing or whitespace-only secret values as unset. */
function secret(secrets: Record<string, string>, key: string): string {
  return String(secrets[key] ?? '').trim();
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
    const source = typeof edge.source === 'string' ? edge.source.trim() : '';
    const target = typeof edge.target === 'string' ? edge.target.trim() : '';
    if (!source || !target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      // Also treat blank endpoints as dangling (executor skips them, but graph is invalid)
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        message: 'Edge points to a missing node.',
      });
    }
  }

  for (const node of nodes) {
    const config = node.config ?? {};

    if (node.type === 'web_search' && !secret(secrets, 'TAVILY_API_KEY')) {
      issues.push({
        code: 'missing_tavily_key',
        severity: 'error',
        nodeId: node.id,
        message: 'Web Search requires TAVILY_API_KEY in settings.',
      });
    }

    if (node.type === 'slack_message' && !secret(secrets, 'SLACK_BOT_TOKEN')) {
      issues.push({
        code: 'missing_slack_token',
        severity: 'error',
        nodeId: node.id,
        message: 'Slack node requires SLACK_BOT_TOKEN in settings.',
      });
    }

    if (node.type === 'discord_message') {
      const webhook = secret(secrets, 'DISCORD_WEBHOOK_URL');
      if (!webhook) {
        issues.push({
          code: 'missing_discord_webhook',
          severity: 'error',
          nodeId: node.id,
          message: 'Discord node requires DISCORD_WEBHOOK_URL in settings.',
        });
      } else if (!webhook.toLowerCase().startsWith(DISCORD_WEBHOOK_PREFIX)) {
        // Align with DiscordMessageNode SSRF allow-list (case-insensitive)
        issues.push({
          code: 'invalid_discord_webhook',
          severity: 'error',
          nodeId: node.id,
          message: 'Discord webhook URL must start with https://discord.com/api/webhooks/.',
        });
      }
    }

    if (node.type === 'media' && !secret(secrets, 'OPENAI_API_KEY')) {
      issues.push({
        code: 'missing_openai_key',
        severity: 'error',
        nodeId: node.id,
        message: 'Media node requires OPENAI_API_KEY in settings.',
      });
    }

    if (node.type === 'deploy') {
      // Match DeployNode runtime: trim/lower-case; unknown/missing defaults to vercel
      const providerRaw =
        typeof config.provider === 'string' ? config.provider.trim().toLowerCase() : '';
      const provider = providerRaw === 'cloudflare' ? 'cloudflare' : 'vercel';
      if (provider === 'vercel' && !secret(secrets, 'VERCEL_API_TOKEN')) {
        issues.push({
          code: 'missing_vercel_token',
          severity: 'error',
          nodeId: node.id,
          message: 'Deploy (Vercel) requires VERCEL_API_TOKEN in settings.',
        });
      }
      if (
        provider === 'cloudflare'
        && (!secret(secrets, 'CLOUDFLARE_API_TOKEN') || !secret(secrets, 'CLOUDFLARE_ACCOUNT_ID'))
      ) {
        issues.push({
          code: 'missing_cloudflare_creds',
          severity: 'error',
          nodeId: node.id,
          message: 'Deploy (Cloudflare) requires API token and account id in settings.',
        });
      }
      const projectName =
        typeof config.projectName === 'string' ? config.projectName.trim() : '';
      // Blank projectName falls back to neos-deploy at runtime — only flag non-empty invalid names
      if (projectName && !isValidDeployProjectName(projectName)) {
        issues.push({
          code: 'invalid_deploy_project',
          severity: 'error',
          nodeId: node.id,
          message:
            'Deploy project name must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63).',
        });
      }
    }

    if (node.type === 'agent_finance' || node.type === 'agent_coding') {
      // Align with AgentNode: trim + lower-case so " OpenAI " / " CLI-Claude " match
      const rawProvider = config.provider ?? config.llmProvider ?? secrets.llmProvider ?? 'anthropic';
      const provider =
        typeof rawProvider === 'string'
          ? rawProvider.trim().toLowerCase() || 'anthropic'
          : 'anthropic';
      if (provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex') {
        // CLI path — runtime detect; soft warning only
        continue;
      }
      if (provider === 'ollama') {
        // Local Ollama — no cloud API key required
        continue;
      }
      if (provider === 'openai' && !secret(secrets, 'OPENAI_API_KEY')) {
        issues.push({
          code: 'missing_openai_key',
          severity: 'error',
          nodeId: node.id,
          message: 'OpenAI agent requires OPENAI_API_KEY in settings.',
        });
      } else if (provider === 'google' && !secret(secrets, 'GOOGLE_API_KEY')) {
        issues.push({
          code: 'missing_google_key',
          severity: 'error',
          nodeId: node.id,
          message: 'Google agent requires GOOGLE_API_KEY in settings.',
        });
      } else if (provider === 'anthropic' || !provider) {
        if (!secret(secrets, 'ANTHROPIC_API_KEY')) {
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
