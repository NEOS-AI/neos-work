/**
 * @neos-work/workflow-engine — public API
 */

export { executeWorkflow } from './executor.js';
export type { ExecutorOptions } from './executor.js';
export { topologicalSort } from './graph.js';
export type { ExecutableNode, NodeContext, NodeResult, NodeType } from './types.js';

// Typed ports MVP (Task 9)
export {
  parsePortDefs,
  portsFromOutputSchema,
  resolveNodeInputPorts,
  resolveNodeOutputPorts,
  checkEdgePortMismatch,
  validateNodePorts,
  isStrictPortsEnabled,
  typesCompatible,
} from './ports.js';
export type { PortIssue, PortCheckSeverity, ResolvePortsOptions } from './ports.js';

// Domain packs & workers (v0.4)
export {
  resolveWorker,
  listWorkers,
  registerWorker,
  listPacks,
  resolvePack,
  isBuiltInPackId,
  BUILT_IN_PACK_IDS,
} from './packs/index.js';
export type { BuiltInPackId } from './packs/index.js';

// Harness registry (deprecated aliases → workers)
export { resolveHarness, listHarnesses, registerHarness } from './harness/index.js';

// Block registry
export { registerNativeBlock, resolveBlock, getNativeExecutor, listBlocks } from './blocks/registry.js';
export type { NativeBlockExecutor, BlockExecutionContext, BlockResult, BlockParams } from './blocks/types.js';

// Domain block registrars
export { registerFinanceBlocks } from './blocks/finance/index.js';
export { registerCodingBlocks } from './blocks/coding/index.js';

// Nodes (for external use)
export { TriggerNode, OutputNode, AndGateNode, OrGateNode } from './nodes/gate.js';
export { AgentNode } from './nodes/agent.js';
export { BlockNode } from './nodes/block.js';
export { WebSearchNode } from './nodes/web-search.js';
export { SlackMessageNode } from './nodes/slack.js';
export { DiscordMessageNode } from './nodes/discord.js';
