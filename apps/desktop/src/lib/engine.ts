/**
 * Engine client — communicates with the NEOS Work engine server.
 * v0.12: Design Project API on EngineProjectClient; Workflows on EngineWorkflowClient.
 * v0.16: Settings + MCP on EngineSettingsClient.
 * v0.17: Skills + media + live artifacts on EngineMediaClient.
 * v0.18: Sessions on EngineSessionsClient; plugins/workers on EnginePluginsClient.
 * v0.19: Design systems / artifacts / routines / deploy on EngineOpsClient.
 * v0.20: Blocks / templates / memory on EngineCatalogClient; project client split.
 */

export {
  EngineTransport,
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  readHealthResponse,
  scrubApiErrorMessage,
  isActiveRunStatus,
  isTerminalRunStatus,
  normalizeProjectRelPath,
  normalizeRunStatus,
} from './engine-transport.js';
export type { ProjectRunEvent, ProjectRunStatus, ProjectRunSummary } from './engine-transport.js';

export {
  EngineProjectClient,
  EngineProjectCoreClient,
  EngineProjectCollabClient,
  EngineProjectFilesClient,
  type DesignProject,
  type ProjectFileEntry,
  type ProjectFileRevision,
  type ProjectPreviewComment,
  type ProjectConversation,
  type ProjectMessage,
  type PluginChannel,
  type Plugin,
  type PluginListMeta,
  type Artifact,
  type Routine,
  type MediaFileInfo,
  type LiveArtifact,
  type LiveArtifactRefresh,
} from './engine-project.js';

export {
  EngineWorkflowClient,
  type WorkflowNodeType,
  type Workflow,
  type WorkflowRevision,
  type Deployment,
  type WorkflowRun,
  type AgentHarness,
  type DomainWorker,
  type WorkflowSSEEvent,
  type WorkflowBlock,
} from './engine-workflow.js';

export {
  EngineSettingsClient,
  type McpServerData,
  type McpPresetData,
  type TradingViewCdpHealthData,
} from './engine-settings.js';

export {
  EngineMediaClient,
  type SkillData,
  type SkillExampleCard,
  type RemoteSkillHit,
  type RemoteSkillAudit,
  type CatalogSearchResult,
  type CatalogPreviewResult,
  type SkillAmbiguousCandidate,
  type InstallRemoteSkillInput,
  type InstallRemoteSkillResult,
  type DeleteSkillResult,
  type SkillContentResult,
} from './engine-media.js';

export {
  EngineSessionsClient,
  type SessionData,
  type MessageData,
  type AgentStep,
  type AgentTask,
  type AgentChunk,
} from './engine-sessions.js';

export { EnginePluginsClient } from './engine-plugins.js';

export {
  EngineOpsClient,
  type DesignSystem,
  type RoutineRun,
} from './engine-ops.js';

export {
  EngineCatalogClient,
  type MemoryType,
  type MemoryItem,
  type CreateMemoryInput,
  type UpdateMemoryInput,
} from './engine-catalog.js';

import { EngineCatalogClient } from './engine-catalog.js';

/**
 * Public product client. All API methods live on the inheritance chain;
 * this class is the stable entrypoint for app imports.
 */
export class EngineClient extends EngineCatalogClient {}
