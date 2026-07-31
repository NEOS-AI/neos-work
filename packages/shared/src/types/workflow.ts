/**
 * Workflow types shared between frontend and backend.
 *
 * v0.4.0 foundation (PLAN_FOR_V0_4_0 Task 1):
 * - unified `agent` node type (+ legacy agent_* aliases for load-time migrate)
 * - schemaVersion / primaryDomain / domainPackIds
 * - DomainWorker supersedes AgentHarness
 * - typed ports MVP (PortDef)
 */

// ── 노드 타입 ──────────────────────────────────────────────

/**
 * Graph node kinds.
 * - `agent` is the v2 canonical agent node (config.workerId + mode).
 * - `agent_finance` / `agent_coding` are **deprecated** v1 aliases; migrateWorkflowV1ToV2
 *   rewrites them to `agent` on load. They remain in the union so pre-migrate code
 *   and fixtures still typecheck during the v0.4 rollout.
 */
export type NodeType =
  | 'trigger'
  | 'agent'
  /** @deprecated v1 — use `agent` + workerId `finance_*` */
  | 'agent_finance'
  /** @deprecated v1 — use `agent` + workerId `coding_*` */
  | 'agent_coding'
  | 'block'
  | 'gate_and'
  | 'gate_or'
  | 'parallel_start'
  | 'parallel_end'
  | 'or_gate'
  | 'media'
  | 'deploy'
  | 'web_search'
  | 'slack_message'
  | 'discord_message'
  | 'output';

// ── Typed ports MVP (Task 9 foundation types) ──────────────

/** Port contract on a workflow node (optional; used for editor warnings / strictPorts). */
export interface PortDef {
  key: string;
  label?: string;
  /** JSON-schema-ish subset or omit for any */
  schema?: Record<string, unknown>;
  required?: boolean;
}

// ── 워크플로우 그래프 모델 ─────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** Workflow document schema version. Stored workflows always become 2 after migrate. */
export type WorkflowSchemaVersion = 1 | 2;

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  /**
   * Schema version. Missing / undefined is treated as 1 and migrated on load.
   * After migrate / save, always 2.
   */
  schemaVersion?: WorkflowSchemaVersion;
  /**
   * Primary domain pack id.
   * Q2 locked: DB column remains `domain`; API/JSON v2 prefers `primaryDomain`
   * (same value). Kept required for DB row mapping compatibility.
   */
  domain: string;
  /**
   * v2 preferred name for the primary pack id (mirrors `domain` after migrate).
   */
  primaryDomain?: string;
  /**
   * Extra packs whose workers/blocks appear in this workflow's editor.
   */
  domainPackIds?: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  webhookSecret?: string;
  designSystemId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── 워크플로우 실행 상태 ───────────────────────────────────

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  nodeResults: Record<string, NodeRunResult>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface NodeRunResult {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

// ── Domain Worker (v0.4) ───────────────────────────────────

export type WorkerMode = 'solo' | 'coordinator';

export type WorkspacePolicy =
  | { kind: 'none' }
  | { kind: 'run'; subdir?: string }
  | { kind: 'isolated' };

export type ToolPermissionProfile =
  | 'read_only'
  | 'read_write'
  | 'execute'
  | 'network'
  | 'full';

/**
 * First-class domain worker definition (v0.4).
 * Superset of the former AgentHarness shape.
 */
export interface DomainWorker {
  id: string;
  name: string;
  /** Domain pack id (e.g. finance | coding | research | general). */
  domain: string;
  description: string;
  systemPrompt: string;
  /** Explicit tool allowlist; empty/undefined → profile defaults at runtime. */
  allowedTools?: string[];
  permissionProfile?: ToolPermissionProfile;
  workspace?: WorkspacePolicy;
  outputSchema?: Record<string, unknown>;
  constraints?: {
    maxSteps?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** Coordinator only — hard cap applied at runtime. */
    maxSpawnedWorkers?: number;
  };
  /** solo = direct work; coordinator = spawn_worker tools. */
  defaultMode?: WorkerMode;
  isBuiltIn?: boolean;
  preferredBlockIds?: string[];
  meta?: Record<string, unknown>;
}

/**
 * @deprecated Use {@link DomainWorker}. Kept as a type alias for v0.4.x compatibility.
 */
export type AgentHarness = DomainWorker;

// ── Domain Pack ────────────────────────────────────────────

export interface DomainPack {
  id: string;
  name: string;
  description: string;
  workers: DomainWorker[];
  /** Block ids owned by this pack (registry remains global; pack filters UI). */
  blockIds: string[];
  icon?: string;
  isBuiltIn: boolean;
  /** Semver-ish version from pack manifest (custom packs). */
  version?: string;
  /** When false, pack is installed but workers/blocks are not registered. */
  enabled?: boolean;
  /** Absolute install path on the host (custom packs only). */
  sourcePath?: string;
}

/** Manifest schema id for custom Domain Packs (PLAN_FOR_V0_5_0 Task 15). */
export const DOMAIN_PACK_MANIFEST_SCHEMA = 'neos-domain-pack/v1' as const;
export type DomainPackManifestSchema = typeof DOMAIN_PACK_MANIFEST_SCHEMA;

// ── Agent node config (v2) ─────────────────────────────────

export type AgentNodeMode = WorkerMode;

export interface AgentNodeConfig {
  /** Required after v1→v2 migrate. */
  workerId: string;
  mode?: AgentNodeMode;
  llmProvider?: string;
  model?: string;
  /** Appended to worker system prompt. */
  systemPrompt?: string;
  maxSteps?: number;
  /** Coordinator: restrict which workers may be spawned. */
  allowedWorkerIds?: string[];
  timeoutMs?: number;
  /** @deprecated v1 — migrated to workerId */
  harnessId?: string;
  /** @deprecated v1 — migrated to llmProvider */
  provider?: string;
}

// ── 도메인 블록 ────────────────────────────────────────────

export type BlockImplementationType = 'native' | 'prompt' | 'skill';

export interface BlockParamDef {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  description?: string;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
}

export interface WorkflowBlock {
  id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  isBuiltIn: boolean;
  implementationType: BlockImplementationType;
  paramDefs: BlockParamDef[];
  inputDescription: string;
  outputDescription: string;
  requiredSettings?: string[];
  promptTemplate?: string;
  skillId?: string;
}
