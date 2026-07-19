import type { WorkflowBlock } from '../../lib/engine.js';
import {
  DISCORD_CONTENT_MAX_LENGTH,
  isMediaImageSize,
  isMediaVoice,
  isValidDeployProjectName,
} from '../../lib/media-node-options.js';

export type WorkflowValidationSeverity = 'error' | 'warning';

export interface WorkflowValidationIssue {
  code: string;
  severity: WorkflowValidationSeverity;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface WorkflowValidationSummary {
  total: number;
  errors: number;
  warnings: number;
}

/** Count errors vs warnings for toolbar badges. */
export function summarizeValidationIssues(
  issues: WorkflowValidationIssue[],
): WorkflowValidationSummary {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { total: issues.length, errors, warnings };
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

  if (nodeIds.size !== input.nodes.length) {
    const seen = new Set<string>();
    for (const node of input.nodes) {
      if (seen.has(node.id)) {
        issues.push({
          code: 'duplicate_node_id',
          severity: 'error',
          nodeId: node.id,
          message: `Duplicate node id "${node.id}".`,
        });
      }
      seen.add(node.id);
    }
  }

  // Non-empty labels shared by multiple nodes (confusing in logs / history)
  const labelsByNormalized = new Map<string, DraftNode[]>();
  for (const node of input.nodes) {
    const key = node.label.trim().toLowerCase();
    if (!key) continue;
    const group = labelsByNormalized.get(key) ?? [];
    group.push(node);
    labelsByNormalized.set(key, group);
  }
  for (const group of labelsByNormalized.values()) {
    if (group.length < 2) continue;
    for (const node of group) {
      issues.push({
        code: 'duplicate_node_label',
        severity: 'warning',
        nodeId: node.id,
        message: `Node label "${node.label.trim()}" is used more than once.`,
      });
    }
  }

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
      // Blocks typically need upstream context when the graph has more than one node
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      if (!hasIncoming && input.nodes.length > 1) {
        issues.push({
          code: 'block_no_upstream',
          severity: 'warning',
          nodeId: node.id,
          message: 'Block node has no upstream connection.',
        });
      }
    }

    if (node.type === 'agent_finance' || node.type === 'agent_coding') {
      const provider = (config.provider ?? config.llmProvider) as string | undefined;
      const isCli =
        provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex';
      // CLI agents do not require a harness (plan Task 3)
      // Treat empty / whitespace harnessId as missing (HarnessSelector can clear selection)
      const harnessId =
        typeof config.harnessId === 'string' ? config.harnessId.trim() : '';
      if (!isCli && !harnessId) {
        issues.push({
          code: 'missing_harness_id',
          severity: 'warning',
          nodeId: node.id,
          message: 'Agent node has no harness selected.',
        });
      }
      // Agents typically need upstream context when the graph has more than one node
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      if (!hasIncoming && input.nodes.length > 1) {
        issues.push({
          code: 'agent_no_upstream',
          severity: 'warning',
          nodeId: node.id,
          message: 'Agent node has no upstream connection.',
        });
      }
      if (config.maxSteps !== undefined && config.maxSteps !== null && config.maxSteps !== '') {
        const n = typeof config.maxSteps === 'number' ? config.maxSteps : Number(config.maxSteps);
        if (!Number.isInteger(n) || n < 1) {
          issues.push({
            code: 'invalid_agent_max_steps',
            severity: 'warning',
            nodeId: node.id,
            message: 'Agent max steps should be a positive integer.',
          });
        }
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
      // NodeConfig Max results is 1–20 (Tavily clamp)
      if (config.maxResults !== undefined && config.maxResults !== null && config.maxResults !== '') {
        const n = typeof config.maxResults === 'number'
          ? config.maxResults
          : Number(config.maxResults);
        if (!Number.isInteger(n) || n < 1 || n > 20) {
          issues.push({
            code: 'invalid_web_search_max_results',
            severity: 'warning',
            nodeId: node.id,
            message: 'Web Search max results should be an integer from 1 to 20.',
          });
        }
      }
    }

    if (node.type === 'slack_message') {
      if (typeof config.channel !== 'string' || config.channel.trim().length === 0) {
        issues.push({
          code: 'missing_slack_channel',
          severity: 'error',
          nodeId: node.id,
          message: 'Slack node requires a channel.',
        });
      }
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      const hasTemplate =
        (typeof config.textTemplate === 'string' && config.textTemplate.trim().length > 0)
        || (typeof config.content === 'string' && config.content.trim().length > 0)
        || (typeof config.text === 'string' && config.text.trim().length > 0);
      if (!hasIncoming && !hasTemplate) {
        issues.push({
          code: 'missing_slack_content',
          severity: 'warning',
          nodeId: node.id,
          message: 'Slack node has no text template or upstream input.',
        });
      }
    }

    if (node.type === 'discord_message') {
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      // NodeConfigPanel stores template as textTemplate (also accept content/text)
      const hasStatic =
        (typeof config.textTemplate === 'string' && config.textTemplate.trim().length > 0)
        || (typeof config.content === 'string' && config.content.trim().length > 0)
        || (typeof config.text === 'string' && config.text.trim().length > 0);
      if (!hasIncoming && !hasStatic) {
        issues.push({
          code: 'missing_discord_content',
          severity: 'warning',
          nodeId: node.id,
          message: 'Discord node has no text template or upstream input.',
        });
      }
      const staticBody =
        (typeof config.textTemplate === 'string' && config.textTemplate)
        || (typeof config.content === 'string' && config.content)
        || (typeof config.text === 'string' && config.text)
        || '';
      if (typeof staticBody === 'string' && staticBody.length > DISCORD_CONTENT_MAX_LENGTH) {
        issues.push({
          code: 'discord_content_too_long',
          severity: 'warning',
          nodeId: node.id,
          message: `Discord content exceeds ${DISCORD_CONTENT_MAX_LENGTH} characters.`,
        });
      }
    }

    if (node.type === 'media') {
      const mediaType = config.mediaType;
      if (
        mediaType !== undefined
        && mediaType !== null
        && mediaType !== ''
        && mediaType !== 'image'
        && mediaType !== 'audio'
      ) {
        issues.push({
          code: 'invalid_media_type',
          severity: 'error',
          nodeId: node.id,
          message: 'Media type must be image or audio.',
        });
      }
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      const isAudio = config.mediaType === 'audio';
      // Image uses `prompt`; TTS audio uses `text` (NodeConfigPanel)
      const hasBody = isAudio
        ? typeof config.text === 'string' && config.text.trim().length > 0
        : typeof config.prompt === 'string' && config.prompt.trim().length > 0;
      if (!hasBody && !hasIncoming) {
        issues.push({
          code: 'missing_media_prompt',
          severity: 'warning',
          nodeId: node.id,
          message: isAudio
            ? 'Media audio node has no text or upstream input.'
            : 'Media node has no prompt or upstream input.',
        });
      }
      // Image size / TTS voice must match NodeConfigPanel allow-lists when set
      if (!isAudio && config.size !== undefined && config.size !== null && config.size !== '') {
        if (!isMediaImageSize(config.size)) {
          issues.push({
            code: 'invalid_media_size',
            severity: 'warning',
            nodeId: node.id,
            message: 'Media image size must be 1024x1024, 1792x1024, or 1024x1792.',
          });
        }
      }
      if (isAudio && config.voice !== undefined && config.voice !== null && config.voice !== '') {
        if (!isMediaVoice(config.voice)) {
          issues.push({
            code: 'invalid_media_voice',
            severity: 'warning',
            nodeId: node.id,
            message: 'Media audio voice is not a supported OpenAI TTS voice.',
          });
        }
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
      const projectName =
        typeof config.projectName === 'string' ? config.projectName.trim() : '';
      if (!projectName) {
        issues.push({
          code: 'missing_deploy_project',
          severity: 'warning',
          nodeId: node.id,
          message: 'Deploy node has no project name.',
        });
      } else if (!isValidDeployProjectName(projectName)) {
        issues.push({
          code: 'invalid_deploy_project',
          severity: 'warning',
          nodeId: node.id,
          message:
            'Deploy project name should start with a letter or digit and use only letters, digits, hyphens, or underscores.',
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

    // Parallel / gate structural checks (plan Task 11)
    // Support both palette aliases: or_gate + gate_or, gate_and
    if (node.type === 'or_gate' || node.type === 'gate_or') {
      const incoming = input.edges.filter((edge) => edge.target === node.id).length;
      if (incoming < 2) {
        issues.push({
          code: 'or_gate_underconnected',
          severity: 'warning',
          nodeId: node.id,
          message: 'OR gate should have at least two upstream branches.',
        });
      }
    }

    if (node.type === 'gate_and') {
      const incoming = input.edges.filter((edge) => edge.target === node.id).length;
      if (incoming < 2) {
        issues.push({
          code: 'gate_and_underconnected',
          severity: 'warning',
          nodeId: node.id,
          message: 'AND gate should join at least two upstream branches.',
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

  const pairCounts = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge.source === edge.target) {
      issues.push({
        code: 'self_loop',
        severity: 'error',
        edgeId: edge.id,
        message: 'Edge cannot connect a node to itself.',
      });
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        edgeId: edge.id,
        message: 'Edge points to a missing node.',
      });
    }
    const pairKey = `${edge.source}\0${edge.target}`;
    const list = pairCounts.get(pairKey) ?? [];
    list.push(edge.id);
    pairCounts.set(pairKey, list);
  }

  // Duplicate parallel edges (same source→target) confuse fan-out semantics
  for (const edgeIds of pairCounts.values()) {
    if (edgeIds.length < 2) continue;
    for (const edgeId of edgeIds) {
      issues.push({
        code: 'duplicate_edge',
        severity: 'warning',
        edgeId,
        message: 'Multiple edges connect the same source and target.',
      });
    }
  }

  // Duplicate / missing edge ids (graph corruption / bad import)
  if (input.edges.length > 0) {
    const seenEdgeIds = new Set<string>();
    for (const edge of input.edges) {
      const edgeId = typeof edge.id === 'string' ? edge.id.trim() : '';
      if (!edgeId) {
        issues.push({
          code: 'missing_edge_id',
          severity: 'error',
          edgeId: edge.id,
          message: 'Edge is missing an id.',
        });
        continue;
      }
      if (seenEdgeIds.has(edgeId)) {
        issues.push({
          code: 'duplicate_edge_id',
          severity: 'error',
          edgeId: edge.id,
          message: `Duplicate edge id "${edgeId}".`,
        });
      }
      seenEdgeIds.add(edgeId);
    }
  }

  if (hasCycle(input.nodes, input.edges)) {
    issues.push({ code: 'cycle', severity: 'error', message: 'Workflow graph contains a cycle.' });
  }
  const triggerCount = input.nodes.filter((node) => node.type === 'trigger').length;
  if (triggerCount === 0) {
    issues.push({ code: 'no_trigger', severity: 'warning', message: 'Workflow has no trigger node.' });
  } else if (triggerCount > 1) {
    issues.push({
      code: 'multiple_triggers',
      severity: 'warning',
      message: `Workflow has ${triggerCount} trigger nodes; only one start trigger is recommended.`,
    });
  }
  const outputCount = input.nodes.filter((node) => node.type === 'output').length;
  if (outputCount === 0) {
    issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
  } else if (outputCount > 1) {
    issues.push({
      code: 'multiple_outputs',
      severity: 'warning',
      message: `Workflow has ${outputCount} output nodes; a single terminal output is recommended.`,
    });
  }

  // parallel_start without a join (parallel_end / or_gate / gate_or / gate_and) is a structural warning
  const hasParallelStart = input.nodes.some((n) => n.type === 'parallel_start');
  const hasJoin = input.nodes.some(
    (n) =>
      n.type === 'parallel_end' ||
      n.type === 'or_gate' ||
      n.type === 'gate_or' ||
      n.type === 'gate_and',
  );
  if (hasParallelStart && !hasJoin) {
    issues.push({
      code: 'parallel_missing_join',
      severity: 'warning',
      message: 'Parallel Start is present but no Parallel End / gate join node was found.',
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

  // Trigger with no downstream when other nodes exist
  for (const node of input.nodes) {
    if (node.type !== 'trigger') continue;
    const outgoing = input.edges.some((e) => e.source === node.id);
    if (!outgoing && input.nodes.length > 1) {
      issues.push({
        code: 'trigger_no_downstream',
        severity: 'warning',
        nodeId: node.id,
        message: 'Trigger node has no downstream connection.',
      });
    }
  }

  return issues;
}
