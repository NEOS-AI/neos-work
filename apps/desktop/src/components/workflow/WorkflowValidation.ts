import type { WorkflowBlock } from '../../lib/engine.js';

export type WorkflowValidationSeverity = 'error' | 'warning';

export interface WorkflowValidationIssue {
  code: string;
  severity: WorkflowValidationSeverity;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

interface DraftNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface DraftEdge {
  id: string;
  source: string;
  target: string;
}

function hasCycle(nodes: Array<{ id: string }>, edges: Array<{ source: string; target: string }>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) outgoing.set(node.id, []);
  for (const edge of edges) outgoing.get(edge.source)?.push(edge.target);

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return nodes.some((node) => visit(node.id));
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function validateWorkflowDraft(input: {
  nodes: DraftNode[];
  edges: DraftEdge[];
  blocks: Pick<WorkflowBlock, 'id' | 'paramDefs'>[];
}): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const blockMap = new Map(input.blocks.map((block) => [block.id, block]));

  for (const node of input.nodes) {
    const config = node.config ?? {};

    if (!node.label.trim()) {
      issues.push({
        code: 'missing_node_label',
        severity: 'error',
        nodeId: node.id,
        message: 'Node label is required.',
      });
    }

    if (node.type === 'block') {
      const blockId = config.blockId;
      if (typeof blockId !== 'string' || blockId.length === 0) {
        issues.push({
          code: 'missing_block_id',
          severity: 'error',
          nodeId: node.id,
          message: 'Block node requires a block selection.',
        });
      } else {
        const block = blockMap.get(blockId);
        const params = (config.params ?? {}) as Record<string, unknown>;
        for (const param of block?.paramDefs ?? []) {
          if (param.default === undefined && isBlank(params[param.key])) {
            issues.push({
              code: 'missing_required_block_param',
              severity: 'error',
              nodeId: node.id,
              message: `Block parameter "${param.key}" is required.`,
            });
          }
        }
      }
    }

    if (node.type === 'agent_finance' || node.type === 'agent_coding') {
      const provider = (config.provider ?? config.llmProvider) as string | undefined;
      const isCli =
        provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex';
      // CLI agents do not require a harness (plan Task 3)
      if (!isCli && typeof config.harnessId !== 'string') {
        issues.push({
          code: 'missing_harness_id',
          severity: 'warning',
          nodeId: node.id,
          message: 'Agent node has no harness selected.',
        });
      }
    }

    if (node.type === 'web_search') {
      const hasQuery = typeof config.query === 'string' && config.query.trim().length > 0;
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      if (!hasQuery && !hasIncoming) {
        issues.push({
          code: 'missing_search_query',
          severity: 'warning',
          nodeId: node.id,
          message: 'Web Search has no query or upstream input.',
        });
      }
    }

    if (node.type === 'slack_message' && (typeof config.channel !== 'string' || config.channel.trim().length === 0)) {
      issues.push({
        code: 'missing_slack_channel',
        severity: 'error',
        nodeId: node.id,
        message: 'Slack node requires a channel.',
      });
    }

    if (node.type === 'discord_message') {
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      const hasStatic =
        (typeof config.content === 'string' && config.content.trim().length > 0)
        || (typeof config.text === 'string' && config.text.trim().length > 0);
      if (!hasIncoming && !hasStatic) {
        issues.push({
          code: 'missing_discord_content',
          severity: 'warning',
          nodeId: node.id,
          message: 'Discord node has no content/text or upstream input.',
        });
      }
    }

    if (node.type === 'media') {
      const hasPrompt = typeof config.prompt === 'string' && config.prompt.trim().length > 0;
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      if (!hasPrompt && !hasIncoming) {
        issues.push({
          code: 'missing_media_prompt',
          severity: 'warning',
          nodeId: node.id,
          message: 'Media node has no prompt or upstream input.',
        });
      }
    }

    if (node.type === 'deploy') {
      const provider = config.provider;
      if (provider !== 'vercel' && provider !== 'cloudflare') {
        issues.push({
          code: 'missing_deploy_provider',
          severity: 'error',
          nodeId: node.id,
          message: 'Deploy node requires provider (vercel or cloudflare).',
        });
      }
      const hasContent =
        (typeof config.content === 'string' && config.content.trim().length > 0)
        || input.edges.some((edge) => edge.target === node.id);
      if (!hasContent) {
        issues.push({
          code: 'missing_deploy_content',
          severity: 'warning',
          nodeId: node.id,
          message: 'Deploy node has no content or upstream input.',
        });
      }
    }

    // Parallel / OR structural checks (plan Task 11)
    if (node.type === 'or_gate') {
      const incoming = input.edges.filter((edge) => edge.target === node.id).length;
      if (incoming < 2) {
        issues.push({
          code: 'or_gate_underconnected',
          severity: 'warning',
          nodeId: node.id,
          message: 'OR gate should have at least two upstream branches to race.',
        });
      }
    }

    if (node.type === 'parallel_start') {
      const outgoing = input.edges.filter((edge) => edge.source === node.id).length;
      if (outgoing < 2) {
        issues.push({
          code: 'parallel_start_underconnected',
          severity: 'warning',
          nodeId: node.id,
          message: 'Parallel Start should fan out to at least two branches.',
        });
      }
    }

    if (node.type === 'parallel_end') {
      const incoming = input.edges.filter((edge) => edge.target === node.id).length;
      if (incoming < 2) {
        issues.push({
          code: 'parallel_end_underconnected',
          severity: 'warning',
          nodeId: node.id,
          message: 'Parallel End should join at least two upstream branches.',
        });
      }
    }
  }

  for (const edge of input.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        edgeId: edge.id,
        message: 'Edge points to a missing node.',
      });
    }
  }

  if (hasCycle(input.nodes, input.edges)) {
    issues.push({ code: 'cycle', severity: 'error', message: 'Workflow graph contains a cycle.' });
  }
  if (!input.nodes.some((node) => node.type === 'trigger')) {
    issues.push({ code: 'no_trigger', severity: 'warning', message: 'Workflow has no trigger node.' });
  }
  if (!input.nodes.some((node) => node.type === 'output')) {
    issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
  }

  // parallel_start without a join (parallel_end or or_gate) is a structural warning
  const hasParallelStart = input.nodes.some((n) => n.type === 'parallel_start');
  const hasJoin = input.nodes.some((n) => n.type === 'parallel_end' || n.type === 'or_gate');
  if (hasParallelStart && !hasJoin) {
    issues.push({
      code: 'parallel_missing_join',
      severity: 'warning',
      message: 'Parallel Start is present but no Parallel End / OR Gate join node was found.',
    });
  }

  // Isolated nodes (not connected to any edge) — skip single-node graphs
  if (input.nodes.length > 1) {
    for (const node of input.nodes) {
      const connected = input.edges.some((e) => e.source === node.id || e.target === node.id);
      if (!connected) {
        issues.push({
          code: 'isolated_node',
          severity: 'warning',
          nodeId: node.id,
          message: `Node "${node.label || node.id}" is not connected to the graph.`,
        });
      }
    }
  }

  // Output with no upstream when other nodes exist
  for (const node of input.nodes) {
    if (node.type !== 'output') continue;
    const incoming = input.edges.some((e) => e.target === node.id);
    if (!incoming && input.nodes.length > 1) {
      issues.push({
        code: 'output_no_upstream',
        severity: 'warning',
        nodeId: node.id,
        message: 'Output node has no upstream connection.',
      });
    }
  }

  return issues;
}
