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

// Domain packs & workers (v0.4 + Domain Pack SDK v0.5 Task 15)
export {
  resolveWorker,
  listWorkers,
  registerWorker,
  unregisterWorker,
  listPacks,
  resolvePack,
  isBuiltInPackId,
  isRegisteredPackId,
  registerPack,
  registerPackFromManifest,
  unregisterPack,
  setPackEnabled,
  parsePackManifest,
  materializePackFromManifest,
  isSafePackId,
  BUILT_IN_PACK_IDS,
  DOMAIN_PACK_MANIFEST_SCHEMA,
  PACK_MANIFEST_FILENAMES,
} from './packs/index.js';
export type {
  BuiltInPackId,
  RegisterPackResult,
  ParsedPackManifest,
  ParsePackManifestResult,
  PackManifestWorker,
  PackManifestBlock,
} from './packs/index.js';

// Harness registry (deprecated aliases → workers)
export {
  resolveHarness,
  listHarnesses,
  registerHarness,
  unregisterHarness,
} from './harness/index.js';

// Block registry
export {
  registerNativeBlock,
  registerBlockMeta,
  resolveBlock,
  getNativeExecutor,
  listBlocks,
  unregisterBlockMeta,
} from './blocks/registry.js';
export type { NativeBlockExecutor, BlockExecutionContext, BlockResult, BlockParams } from './blocks/types.js';

// Domain block registrars
export { registerFinanceBlocks } from './blocks/finance/index.js';
export { registerCodingBlocks } from './blocks/coding/index.js';

// Nodes (for external use)
export { TriggerNode, OutputNode, AndGateNode, OrGateNode } from './nodes/gate.js';
export { AgentNode, isCliProvider } from './nodes/agent.js';
export { BlockNode } from './nodes/block.js';
export { WebSearchNode } from './nodes/web-search.js';
export { SlackMessageNode } from './nodes/slack.js';
export { DiscordMessageNode } from './nodes/discord.js';
