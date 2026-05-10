/**
 * Workflow types shared between frontend and backend.
 */

// ── 노드 타입 ──────────────────────────────────────────────

export type NodeType =
  | 'trigger'
  | 'agent_finance'
  | 'agent_coding'
  | 'block'
  | 'gate_and'
  | 'gate_or'
  | 'web_search'
  | 'slack_message'
  | 'discord_message'
  | 'output';

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

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  domain: 'finance' | 'coding' | 'general';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
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

// ── 에이전트 하네스 ────────────────────────────────────────

export interface AgentHarness {
  id: string;
  name: string;
  domain: 'finance' | 'coding' | 'general';
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  outputSchema?: Record<string, unknown>;
  constraints?: {
    maxSteps?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
  isBuiltIn?: boolean;
  meta?: Record<string, unknown>;
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
  domain: 'finance' | 'coding' | 'general';
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
