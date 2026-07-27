export type {
  AgentCliDef,
  AgentDetectResult,
  BuildLaunchResult,
  DetectedAgent,
  LaunchMode,
  LaunchPolicy,
  MissingAgent,
  PathOverrides,
  RuntimeRunEvent,
  RuntimeRunEventType,
  RuntimeRunRecord,
  RuntimeRunStatus,
  StreamFormat,
} from './types.js';

export {
  AGENT_CLI_DEFS,
  getDefById,
  settingKeyMap,
} from './defs/catalog.js';

export {
  defaultWhich,
  defaultVersionProbe,
  detectAgent,
  detectAllAgents,
  detectAvailableAgents,
  resolveBinaryPath,
  type WhichFn,
  type VersionFn,
} from './detection.js';

export { buildLaunchArgs, buildLaunchForId, PROMPT_MAX_CHARS } from './launch.js';
export { requestCancel, escalateKill } from './cancel.js';

export {
  createTextParseState,
  feedTextChunk,
  type TextParseState,
} from './parsers/text.js';
export {
  createJsonlParseState,
  feedJsonlChunk,
  type JsonlParseState,
} from './parsers/jsonl.js';

export {
  RunRegistry,
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
  type RunRegistryOptions,
} from './run-registry.js';

export { assembleEditContextPrompt } from './edit-context.js';
