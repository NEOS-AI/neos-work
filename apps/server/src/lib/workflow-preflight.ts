/**
 * Workflow preflight — structural + settings readiness checks (plan polish).
 * Used by POST /api/workflow/:id/preflight before a run.
 */

import { isDiscordWebhookUrl, isValidDeployProjectName } from '@neos-work/shared';

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
  // Accept raw + trimmed ids so padded edge endpoints still resolve (matches desktop validation)
  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (typeof n.id === 'string' && n.id) nodeIds.add(n.id);
    const trimmed = typeof n.id === 'string' ? n.id.trim() : '';
    if (trimmed) nodeIds.add(trimmed);
  }

  if (!nodes.some((n) => n.type === 'trigger')) {
    issues.push({ code: 'no_trigger', severity: 'error', message: 'Workflow has no trigger node.' });
  }
  if (!nodes.some((n) => n.type === 'output')) {
    issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
  }

  // Graph size bounds (align with workflow-engine topologicalSort caps)
  if (nodes.length > 2_000) {
    issues.push({
      code: 'too_many_nodes',
      severity: 'error',
      message: 'Workflow exceeds max nodes (2000).',
    });
  }
  if (edges.length > 10_000) {
    issues.push({
      code: 'too_many_edges',
      severity: 'error',
      message: 'Workflow exceeds max edges (10000).',
    });
  }

  // Blank / whitespace-only node ids are unusable at runtime
  for (const n of nodes) {
    const rawId = typeof n.id === 'string' ? n.id : '';
    // Control-char check before trim (trim strips leading/trailing \r\n)
    if (rawId && /[\0\r\n]/.test(rawId)) {
      issues.push({
        code: 'invalid_node_id',
        severity: 'error',
        nodeId: rawId.replace(/[\0\r\n]/g, '?').slice(0, 80),
        message: 'Workflow has a node with an invalid id.',
      });
      break;
    }
    const id = rawId.trim();
    if (!id) {
      issues.push({
        code: 'blank_node_id',
        severity: 'error',
        message: 'Workflow has a node with a blank id.',
      });
      break;
    }
    if (id.length > 200) {
      issues.push({
        code: 'invalid_node_id',
        severity: 'error',
        nodeId: id.slice(0, 80),
        message: 'Workflow has a node with an invalid id.',
      });
      break;
    }
  }

  for (const edge of edges) {
    const sourceRaw = typeof edge.source === 'string' ? edge.source : '';
    const targetRaw = typeof edge.target === 'string' ? edge.target : '';
    // Control-char check before trim
    if (/[\0\r\n]/.test(sourceRaw) || /[\0\r\n]/.test(targetRaw)) {
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        message: 'Edge points to a missing node.',
      });
      continue;
    }
    const source = sourceRaw.trim();
    const target = targetRaw.trim();
    // Invalid edge endpoints (overlong / missing) count as dangling
    const sourceOk = !!source && source.length <= 200 && nodeIds.has(source);
    const targetOk = !!target && target.length <= 200 && nodeIds.has(target);
    if (!sourceOk || !targetOk) {
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
      } else if (!isDiscordWebhookUrl(webhook)) {
        // Align with DiscordMessageNode SSRF allow-list (URL host/path)
        issues.push({
          code: 'invalid_discord_webhook',
          severity: 'error',
          nodeId: node.id,
          message: 'Discord webhook URL must be an https://discord.com (or discordapp.com) /api/webhooks/ URL.',
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
      // Control-char provider → treat as default vercel
      const providerRaw =
        typeof config.provider === 'string' && !/[\0\r\n]/.test(config.provider)
          ? config.provider.trim().toLowerCase()
          : '';
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
      let projectName = '';
      if (typeof config.projectName === 'string') {
        // Control-char project names are invalid (check before trim)
        if (/[\0\r\n]/.test(config.projectName)) {
          issues.push({
            code: 'invalid_deploy_project',
            severity: 'error',
            nodeId: node.id,
            message:
              'Deploy project name must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63).',
          });
        } else {
          projectName = config.projectName.trim();
        }
      }
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
      // Align with AgentNode: trim + lower-case so " OpenAI " / " CLI-Claude " match.
      // Control-char provider → anthropic default (check before trim).
      const rawProvider = config.provider ?? config.llmProvider ?? secrets.llmProvider ?? 'anthropic';
      const provider =
        typeof rawProvider === 'string' && !/[\0\r\n]/.test(rawProvider)
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
