/**
 * Workflow executor — runs a workflow graph node by node using topological order.
 * Supports parallel fan-out/fan-in (parallel_start/parallel_end) and OR gate.
 */

import type { Workflow, WorkflowSSEEvent } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeType } from './types.js';
import { topologicalSort } from './graph.js';
import { TriggerNode, OutputNode, AndGateNode, OrGateNode, ParallelStartNode, ParallelEndNode, ORGateNode } from './nodes/gate.js';
import { AgentNode } from './nodes/agent.js';
import { BlockNode } from './nodes/block.js';
import { WebSearchNode } from './nodes/web-search.js';
import { SlackMessageNode } from './nodes/slack.js';
import { DiscordMessageNode } from './nodes/discord.js';
import { MediaNode } from './nodes/media.js';
import { DeployNode } from './nodes/deploy.js';

// Maximum serialized size for node_results_json (1 MB)
const MAX_OUTPUT_BYTES = 1_048_576;
/** Cap node.failed error strings in SSE / run logs. */
const MAX_NODE_ERROR_CHARS = 4_000;
/** Cap node.progress SSE payloads (streaming agent text). */
const MAX_PROGRESS_CHUNK_CHARS = 32_000;
const MAX_PROGRESS_ACCUMULATED_CHARS = 256_000;

export interface ExecutorOptions {
  workflow: Workflow;
  settings: Record<string, string>;
  onEvent: (event: WorkflowSSEEvent) => void;
  signal?: AbortSignal;
  runId?: string;
  /** Inputs to inject as the Trigger node's output (runtime parameterisation) */
  triggerInputs?: Record<string, unknown>;
  /** Optional CLI spawn function injected by the server for cli-* providers */
  cliSpawn?: NodeContext['cliSpawn'];
  /** Optional Design System DESIGN.md content injected for agent nodes */
  designSystemContent?: string;
}

/** Run a single node and return its result, emitting SSE events. */
async function runNode(
  node: Workflow['nodes'][number],
  ctx: NodeContext,
  onEvent: (event: WorkflowSSEEvent) => void,
  nodeOutputs: Map<string, unknown>,
  failedNodes: Set<string>,
): Promise<boolean> {
  const nodeIdRaw = typeof node.id === 'string' ? node.id : String(node.id ?? '');
  // Control-char / blank ids are unusable in SSE and result maps
  if (!nodeIdRaw || /[\0\r\n]/.test(nodeIdRaw)) {
    const nodeId = 'invalid';
    onEvent({ type: 'node.started', nodeId, nodeType: node.type });
    onEvent({ type: 'node.failed', nodeId, error: 'Invalid node id' });
    failedNodes.add(nodeId);
    return false;
  }
  const nodeId = nodeIdRaw.trim();
  if (!nodeId || nodeId.length > 200) {
    onEvent({ type: 'node.started', nodeId: 'invalid', nodeType: node.type });
    onEvent({ type: 'node.failed', nodeId: 'invalid', error: 'Invalid node id' });
    failedNodes.add('invalid');
    return false;
  }
  onEvent({ type: 'node.started', nodeId, nodeType: node.type });
  const nodeImpl = resolveNode(node.type, node.config as Record<string, unknown> | undefined);
  const result = await nodeImpl.execute(ctx);

  let output = result.output;
  const serialized = JSON.stringify(output);
  if (serialized.length > MAX_OUTPUT_BYTES) {
    output = { truncated: true, preview: serialized.slice(0, 256) };
  }
  nodeOutputs.set(nodeId, output);

  if (result.ok) {
    onEvent({ type: 'node.completed', nodeId, output, durationMs: result.durationMs });
    return true;
  } else {
    failedNodes.add(nodeId);
    let error = result.error ?? 'Unknown error';
    if (error.length > MAX_NODE_ERROR_CHARS) {
      error = error.slice(0, MAX_NODE_ERROR_CHARS);
    }
    onEvent({ type: 'node.failed', nodeId, error });
    return false;
  }
}

export async function executeWorkflow(options: ExecutorOptions): Promise<void> {
  const { workflow, settings, onEvent, signal } = options;
  const runId = options.runId ?? crypto.randomUUID();
  const triggerInputs = options.triggerInputs ?? {};
  const runStartMs = Date.now();

  onEvent({ type: 'run.started', runId });

  let sorted;
  try {
    sorted = topologicalSort(workflow.nodes, workflow.edges);
  } catch (err) {
    let error = err instanceof Error ? err.message : 'Graph sort failed';
    if (error.length > MAX_NODE_ERROR_CHARS) {
      error = error.slice(0, MAX_NODE_ERROR_CHARS);
    }
    onEvent({
      type: 'run.failed',
      runId,
      error,
    });
    return;
  }

  // Accumulated outputs per node
  const nodeOutputs = new Map<string, unknown>();

  // Track failed nodes to propagate failures downstream
  const failedNodes = new Set<string>();

  // Track in-progress parallel branches: nodeId → AbortController
  const branchControllers = new Map<string, AbortController>();

  for (const node of sorted) {
    if (signal?.aborted) break;

    // topologicalSort normalizes ids; still control-char-check + trim for defense-in-depth
    const nodeIdRaw = typeof node.id === 'string' ? node.id : String(node.id ?? '');
    if (!nodeIdRaw || /[\0\r\n]/.test(nodeIdRaw)) continue;
    const nodeId = nodeIdRaw.trim();
    if (!nodeId) continue;

    // Collect inputs from upstream nodes via edges (exclude failed / blank / control-char endpoints)
    const incomingEdges = workflow.edges.filter(
      (e) =>
        typeof e.target === 'string'
        && !/[\0\r\n]/.test(e.target)
        && e.target.trim() === nodeId
        && typeof e.source === 'string'
        && !/[\0\r\n]/.test(e.source)
        && e.source.trim().length > 0,
    );
    const inputs: Record<string, unknown> = {};
    for (const edge of incomingEdges) {
      const source = edge.source.trim();
      if (!failedNodes.has(source)) {
        inputs[source] = nodeOutputs.get(source) ?? nodeOutputs.get(edge.source);
      }
    }

    // AND gate: fail if ANY upstream node failed (all inputs must succeed)
    if (node.type === 'gate_and') {
      const anyFailed = incomingEdges.some((e) => failedNodes.has(e.source.trim()));
      if (anyFailed) {
        onEvent({ type: 'node.failed', nodeId: nodeId, error: 'AND gate: one or more upstream nodes failed' });
        failedNodes.add(nodeId);
        continue;
      }
    }

    // OR gate (legacy): fail only if ALL upstream nodes failed
    if (node.type === 'gate_or') {
      const allFailed =
        incomingEdges.length > 0
        && incomingEdges.every((e) => failedNodes.has(e.source.trim()));
      if (allFailed) {
        onEvent({ type: 'node.failed', nodeId: nodeId, error: 'OR gate: all upstream nodes failed' });
        failedNodes.add(nodeId);
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

    // parallel_start: fan-out — run all direct successor branches concurrently
    if (node.type === 'parallel_start') {
      // Execute the parallel_start node itself
      const ctx: NodeContext = {
        workflowId: workflow.id,
        runId,
        nodeId,
        inputs,
        settings,
        config: node.config as Record<string, unknown> | undefined,
        signal,
      };
      await runNode(node, ctx, onEvent, nodeOutputs, failedNodes);
      continue;
    }

    // parallel_end: fan-in — wait for all predecessor branches (already done sequentially via topological sort)
    if (node.type === 'parallel_end') {
      const ctx: NodeContext = {
        workflowId: workflow.id,
        runId,
        nodeId,
        inputs,
        settings,
        config: node.config as Record<string, unknown> | undefined,
        signal,
      };
      await runNode(node, ctx, onEvent, nodeOutputs, failedNodes);
      continue;
    }

    // or_gate: Promise.race — run all predecessor branches concurrently, take first winner
    if (node.type === 'or_gate') {
      // Find all direct predecessor nodes (branches competing)
      const predecessorIds = incomingEdges.map((e) => e.source.trim());
      const pendingPredecessors = predecessorIds.filter((id) => !nodeOutputs.has(id) && !failedNodes.has(id));

      // If all predecessors already resolved (sequential execution path), pick first successful
      if (pendingPredecessors.length === 0) {
        const allFailed = predecessorIds.every((id) => failedNodes.has(id));
        if (allFailed) {
          onEvent({ type: 'node.failed', nodeId: nodeId, error: 'OR gate: all upstream nodes failed' });
          failedNodes.add(nodeId);
          continue;
        }
        const firstSuccessId = predecessorIds.find((id) => !failedNodes.has(id));
        const winnerInput = firstSuccessId ? { [firstSuccessId]: nodeOutputs.get(firstSuccessId) } : {};
        const ctx: NodeContext = {
          workflowId: workflow.id,
          runId,
          nodeId,
          inputs: winnerInput,
          settings,
          config: node.config as Record<string, unknown> | undefined,
          signal,
        };
        await runNode(node, ctx, onEvent, nodeOutputs, failedNodes);
        continue;
      }

      // Run pending branches concurrently and race
      const branchNodes = sorted.filter((n) => {
        const rawId = typeof n.id === 'string' ? n.id : '';
        if (!rawId || /[\0\r\n]/.test(rawId)) return false;
        const id = rawId.trim();
        return !!id && pendingPredecessors.includes(id);
      });
      const abortControllers = branchNodes.map(() => new AbortController());

      const branchPromises = branchNodes.map(async (branchNode, i) => {
        const branchIdRaw =
          typeof branchNode.id === 'string' ? branchNode.id : String(branchNode.id ?? '');
        if (!branchIdRaw || /[\0\r\n]/.test(branchIdRaw)) {
          return { nodeId: '', ok: false };
        }
        const branchId = branchIdRaw.trim();
        const branchSignal = abortControllers[i].signal;
        const combined = signal
          ? AbortSignal.any([signal, branchSignal])
          : branchSignal;
        const branchInputs: Record<string, unknown> = {};
        for (const edge of workflow.edges.filter(
          (e) =>
            typeof e.target === 'string'
            && !/[\0\r\n]/.test(e.target)
            && e.target.trim() === branchId
            && typeof e.source === 'string'
            && !/[\0\r\n]/.test(e.source)
            && e.source.trim().length > 0,
        )) {
          const source = edge.source.trim();
          if (!failedNodes.has(source)) {
            branchInputs[source] = nodeOutputs.get(source);
          }
        }
        const branchCtx: NodeContext = {
          workflowId: workflow.id,
          runId,
          nodeId: branchId,
          inputs: branchInputs,
          settings,
          config: branchNode.config as Record<string, unknown> | undefined,
          signal: combined,
        };
        const ok = await runNode(branchNode, branchCtx, onEvent, nodeOutputs, failedNodes);
        return { nodeId: branchId, ok };
      });

      const results = await Promise.allSettled(
        branchPromises.map((p, i) =>
          p.then((r) => {
            if (r.ok) {
              // Cancel other branches
              abortControllers.forEach((c, j) => { if (j !== i) c.abort(); });
            }
            return r;
          }),
        ),
      );

      const winner = results
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .find((r) => r?.ok);

      if (!winner) {
        onEvent({ type: 'node.failed', nodeId: nodeId, error: 'OR gate: all branches failed' });
        failedNodes.add(nodeId);
        continue;
      }

      const winnerInput = { [winner.nodeId]: nodeOutputs.get(winner.nodeId) };
      const ctx: NodeContext = {
        workflowId: workflow.id,
        runId,
        nodeId,
        inputs: winnerInput,
        settings,
        config: node.config as Record<string, unknown> | undefined,
        signal,
      };
      await runNode(node, ctx, onEvent, nodeOutputs, failedNodes);
      continue;
    }

    // Skip non-gate nodes whose direct upstream all failed
    if (!['gate_and', 'gate_or', 'trigger'].includes(node.type)) {
      const allUpstreamFailed =
        incomingEdges.length > 0
        && incomingEdges.every((e) => failedNodes.has(e.source.trim()));
      if (allUpstreamFailed) {
        onEvent({ type: 'node.failed', nodeId: nodeId, error: 'Skipped: all upstream nodes failed' });
        failedNodes.add(nodeId);
        continue;
      }
    }

    const nodeImpl = resolveNode(node.type, node.config as Record<string, unknown> | undefined);
    // For trigger nodes, inject triggerInputs as the effective inputs
    const effectiveInputs = node.type === 'trigger' ? triggerInputs : inputs;
    const ctx: NodeContext = {
      workflowId: workflow.id,
      runId,
      nodeId,
      inputs: effectiveInputs,
      settings,
      config: node.config as Record<string, unknown> | undefined,
      signal,
      onProgress: (chunk, accumulated) => {
        let c = typeof chunk === 'string' ? chunk : String(chunk ?? '');
        let a = typeof accumulated === 'string' ? accumulated : String(accumulated ?? '');
        if (c.length > MAX_PROGRESS_CHUNK_CHARS) c = c.slice(0, MAX_PROGRESS_CHUNK_CHARS);
        if (a.length > MAX_PROGRESS_ACCUMULATED_CHARS) {
          a = a.slice(0, MAX_PROGRESS_ACCUMULATED_CHARS);
        }
        onEvent({ type: 'node.progress', nodeId, chunk: c, accumulated: a });
      },
      cliSpawn: options.cliSpawn,
      designSystemContent: options.designSystemContent,
    };

    onEvent({ type: 'node.started', nodeId, nodeType: node.type });
    const result = await nodeImpl.execute(ctx);

    // Truncate large outputs before storing (security/storage limit)
    let output = result.output;
    const serialized = JSON.stringify(output);
    if (serialized.length > MAX_OUTPUT_BYTES) {
      output = { truncated: true, preview: serialized.slice(0, 256) };
    }

    nodeOutputs.set(nodeId, output);

    if (result.ok) {
      onEvent({ type: 'node.completed', nodeId, output, durationMs: result.durationMs });
    } else {
      failedNodes.add(nodeId);
      let error = result.error ?? 'Unknown error';
      if (error.length > MAX_NODE_ERROR_CHARS) {
        error = error.slice(0, MAX_NODE_ERROR_CHARS);
      }
      onEvent({ type: 'node.failed', nodeId, error });
    }
  }

  void branchControllers; // suppress unused warning
  onEvent({ type: 'run.completed', runId, duration: Date.now() - runStartMs });
}

function resolveNode(type: NodeType | string, nodeConfig?: Record<string, unknown>): ExecutableNode {
  // Control-char type → unknown (fail closed)
  const normalized =
    typeof type === 'string' && !/[\0\r\n]/.test(type)
      ? (type.trim().toLowerCase() as NodeType)
      : typeof type === 'string'
        ? ('' as NodeType)
        : type;
  switch (normalized) {
    case 'trigger':         return new TriggerNode();
    case 'agent_finance':   return new AgentNode('agent_finance', nodeConfig);
    case 'agent_coding':    return new AgentNode('agent_coding', nodeConfig);
    case 'block':           return new BlockNode();
    case 'gate_and':        return new AndGateNode();
    case 'gate_or':         return new OrGateNode();
    case 'parallel_start':  return new ParallelStartNode();
    case 'parallel_end':    return new ParallelEndNode();
    case 'or_gate':         return new ORGateNode();
    case 'web_search':      return new WebSearchNode();
    case 'slack_message':   return new SlackMessageNode();
    case 'discord_message': return new DiscordMessageNode();
    case 'output':          return new OutputNode();
    case 'media':           return MediaNode;
    case 'deploy':          return DeployNode;
    default:                throw new Error(`Unknown node type: ${normalized}`);
  }
}
