/**
 * Workflow executor — runs a workflow graph node by node using topological order.
 */

import type { Workflow, WorkflowSSEEvent } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeType } from './types.js';
import { topologicalSort } from './graph.js';
import { TriggerNode, OutputNode, AndGateNode, OrGateNode } from './nodes/gate.js';
import { AgentNode } from './nodes/agent.js';
import { BlockNode } from './nodes/block.js';
import { WebSearchNode } from './nodes/web-search.js';
import { SlackMessageNode } from './nodes/slack.js';
import { DiscordMessageNode } from './nodes/discord.js';

// Maximum serialized size for node_results_json (1 MB)
const MAX_OUTPUT_BYTES = 1_048_576;

export interface ExecutorOptions {
  workflow: Workflow;
  settings: Record<string, string>;
  onEvent: (event: WorkflowSSEEvent) => void;
  signal?: AbortSignal;
  runId?: string;
}

export async function executeWorkflow(options: ExecutorOptions): Promise<void> {
  const { workflow, settings, onEvent, signal } = options;
  const runId = options.runId ?? crypto.randomUUID();
  const runStartMs = Date.now();

  onEvent({ type: 'run.started', runId });

  let sorted;
  try {
    sorted = topologicalSort(workflow.nodes, workflow.edges);
  } catch (err) {
    onEvent({
      type: 'run.failed',
      runId,
      error: err instanceof Error ? err.message : 'Graph sort failed',
    });
    return;
  }

  // Accumulated outputs per node
  const nodeOutputs = new Map<string, unknown>();

  // Track failed nodes to propagate failures downstream
  const failedNodes = new Set<string>();

  for (const node of sorted) {
    if (signal?.aborted) break;

    // Collect inputs from upstream nodes via edges (exclude failed sources)
    const incomingEdges = workflow.edges.filter((e) => e.target === node.id);
    const inputs: Record<string, unknown> = {};
    for (const edge of incomingEdges) {
      if (!failedNodes.has(edge.source)) {
        inputs[edge.source] = nodeOutputs.get(edge.source);
      }
    }

    // AND gate: fail if ANY upstream node failed (all inputs must succeed)
    if (node.type === 'gate_and') {
      const anyFailed = incomingEdges.some((e) => failedNodes.has(e.source));
      if (anyFailed) {
        onEvent({ type: 'node.failed', nodeId: node.id, error: 'AND gate: one or more upstream nodes failed' });
        failedNodes.add(node.id);
        continue;
      }
    }

    // OR gate: fail only if ALL upstream nodes failed; otherwise use first successful input
    if (node.type === 'gate_or') {
      const allFailed = incomingEdges.length > 0 && incomingEdges.every((e) => failedNodes.has(e.source));
      if (allFailed) {
        onEvent({ type: 'node.failed', nodeId: node.id, error: 'OR gate: all upstream nodes failed' });
        failedNodes.add(node.id);
        continue;
      }
      // Keep only the first successful input
      const firstKey = Object.keys(inputs)[0];
      if (firstKey) {
        for (const k of Object.keys(inputs)) {
          if (k !== firstKey) delete inputs[k];
        }
      }
    }

    // Skip non-gate nodes whose direct upstream all failed
    if (node.type !== 'gate_and' && node.type !== 'gate_or' && node.type !== 'trigger') {
      const allUpstreamFailed =
        incomingEdges.length > 0 && incomingEdges.every((e) => failedNodes.has(e.source));
      if (allUpstreamFailed) {
        onEvent({ type: 'node.failed', nodeId: node.id, error: 'Skipped: all upstream nodes failed' });
        failedNodes.add(node.id);
        continue;
      }
    }

    onEvent({ type: 'node.started', nodeId: node.id, nodeType: node.type });

    const nodeImpl = resolveNode(node.type, node.config as Record<string, unknown> | undefined);
    const ctx: NodeContext = {
      workflowId: workflow.id,
      runId,
      nodeId: node.id,
      inputs,
      settings,
      config: node.config as Record<string, unknown> | undefined,
      signal,
    };

    const result = await nodeImpl.execute(ctx);

    // Truncate large outputs before storing (security/storage limit)
    let output = result.output;
    const serialized = JSON.stringify(output);
    if (serialized.length > MAX_OUTPUT_BYTES) {
      output = { truncated: true, preview: serialized.slice(0, 256) };
    }

    nodeOutputs.set(node.id, output);

    if (result.ok) {
      onEvent({ type: 'node.completed', nodeId: node.id, output });
    } else {
      failedNodes.add(node.id);
      onEvent({ type: 'node.failed', nodeId: node.id, error: result.error ?? 'Unknown error' });
    }
  }

  onEvent({ type: 'run.completed', runId, duration: Date.now() - runStartMs });
}

function resolveNode(type: NodeType, nodeConfig?: Record<string, unknown>): ExecutableNode {
  switch (type) {
    case 'trigger':         return new TriggerNode();
    case 'agent_finance':   return new AgentNode('agent_finance', nodeConfig);
    case 'agent_coding':    return new AgentNode('agent_coding', nodeConfig);
    case 'block':           return new BlockNode();
    case 'gate_and':        return new AndGateNode();
    case 'gate_or':         return new OrGateNode();
    case 'web_search':      return new WebSearchNode();
    case 'slack_message':   return new SlackMessageNode();
    case 'discord_message': return new DiscordMessageNode();
    case 'output':          return new OutputNode();
    default:                throw new Error(`Unknown node type: ${type}`);
  }
}
