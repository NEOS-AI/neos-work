/**
 * migrateWorkflowV1ToV2 — pure v1 → v2 workflow document migration.
 *
 * PLAN_FOR_V0_4_0 Task 2 / BC-1–BC-3 / BC-7:
 * - schemaVersion = 2
 * - domain → primaryDomain (+ domain column value preserved)
 * - agent_finance / agent_coding → agent + workerId defaults
 * - harnessId → workerId
 * - provider → llmProvider
 */

import type { NodeType, Workflow, WorkflowNode } from './types/workflow.js';

export interface MigrationReport {
  /** Node ids whose type was rewritten (agent_* → agent). */
  renamedNodes: string[];
  warnings: string[];
  /** True when any field/type changed. */
  changed: boolean;
}

export interface MigrateWorkflowResult {
  workflow: Workflow;
  report: MigrationReport;
}

const DEFAULT_WORKER_BY_LEGACY_TYPE: Record<string, string> = {
  agent_finance: 'finance_analyst',
  agent_coding: 'coding_reviewer',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/[\0\r\n]/.test(value)) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function migrateNode(node: WorkflowNode, packSet: Set<string>, report: MigrationReport): WorkflowNode {
  const next: WorkflowNode = {
    ...node,
    config: asRecord(node.config),
    position: { ...node.position },
  };
  const config = next.config;

  // BC-1: legacy agent types → agent
  if (next.type === 'agent_finance' || next.type === 'agent_coding') {
    const legacyType = next.type;
    const defaultWorker = DEFAULT_WORKER_BY_LEGACY_TYPE[legacyType] ?? 'general_generalist';
    next.type = 'agent';
    if (!safeString(config['workerId']) && !safeString(config['harnessId'])) {
      config['workerId'] = defaultWorker;
    }
    if (legacyType === 'agent_finance' || defaultWorker.startsWith('finance')) {
      packSet.add('finance');
    }
    if (legacyType === 'agent_coding' || defaultWorker.startsWith('coding')) {
      packSet.add('coding');
    }
    report.renamedNodes.push(next.id);
    report.changed = true;
  }

  // BC-4 / harnessId → workerId (workerId wins if both present)
  const harnessId = safeString(config['harnessId']);
  const workerId = safeString(config['workerId']);
  if (harnessId || workerId) {
    const resolved = workerId ?? harnessId!;
    if (config['workerId'] !== resolved) {
      config['workerId'] = resolved;
      report.changed = true;
    }
    if ('harnessId' in config) {
      delete config['harnessId'];
      report.changed = true;
    }
    // Infer pack from worker id prefix when possible
    if (resolved.startsWith('finance')) packSet.add('finance');
    else if (resolved.startsWith('coding')) packSet.add('coding');
    else if (resolved.startsWith('research')) packSet.add('research');
    else if (resolved.startsWith('general')) packSet.add('general');
  }

  // BC-7: provider → llmProvider (llmProvider wins)
  const provider = safeString(config['provider']);
  const llmProvider = safeString(config['llmProvider']);
  if (provider || llmProvider) {
    const resolved = llmProvider ?? provider!;
    if (config['llmProvider'] !== resolved) {
      config['llmProvider'] = resolved;
      report.changed = true;
    }
    if ('provider' in config) {
      delete config['provider'];
      report.changed = true;
    }
  }

  // Default worker for bare `agent` nodes missing workerId
  if (next.type === 'agent' && !safeString(config['workerId'])) {
    config['workerId'] = 'general_generalist';
    packSet.add('general');
    report.warnings.push(`node ${next.id}: missing workerId; defaulted to general_generalist`);
    report.changed = true;
  }

  return next;
}

/**
 * Migrate a workflow document to schemaVersion 2.
 * Idempotent for already-v2 documents (still normalizes legacy keys if present).
 */
export function migrateWorkflowV1ToV2(
  input: Workflow | (Partial<Workflow> & { nodes?: WorkflowNode[] }),
): MigrateWorkflowResult {
  const report: MigrationReport = {
    renamedNodes: [],
    warnings: [],
    changed: false,
  };

  const rawDomain =
    safeString((input as Workflow).primaryDomain) ??
    safeString((input as Workflow).domain) ??
    'general';

  const packSet = new Set<string>();
  packSet.add(rawDomain);

  const nodesIn = Array.isArray(input.nodes) ? input.nodes : [];
  const nodes = nodesIn.map((n) => {
    const node: WorkflowNode = {
      id: typeof n.id === 'string' ? n.id : '',
      type: (n.type as NodeType) ?? 'output',
      label: typeof n.label === 'string' ? n.label : '',
      position: {
        x: Number(n.position?.x) || 0,
        y: Number(n.position?.y) || 0,
      },
      config: asRecord(n.config),
    };
    return migrateNode(node, packSet, report);
  });

  const edges = Array.isArray(input.edges)
    ? input.edges.map((e) => ({ ...e }))
    : [];

  const prevVersion = input.schemaVersion;
  if (prevVersion !== 2) {
    report.changed = true;
  }

  // domainPackIds: start from primary + any inferred from nodes; keep prior extras
  const priorPacks = Array.isArray(input.domainPackIds)
    ? input.domainPackIds
        .map((p) => safeString(p))
        .filter((p): p is string => Boolean(p))
    : [];
  for (const p of priorPacks) packSet.add(p);

  const domainPackIds = [...packSet];
  // Omit domainPackIds when only primary general (plan: general only → optional omit)
  const onlyGeneral =
    domainPackIds.length === 1 && domainPackIds[0] === 'general';

  const workflow: Workflow = {
    id: typeof input.id === 'string' ? input.id : '',
    name: typeof input.name === 'string' ? input.name : '',
    description: typeof input.description === 'string' ? input.description : undefined,
    schemaVersion: 2,
    domain: rawDomain,
    primaryDomain: rawDomain,
    domainPackIds: onlyGeneral ? undefined : domainPackIds,
    nodes,
    edges,
    webhookSecret:
      typeof input.webhookSecret === 'string' ? input.webhookSecret : undefined,
    designSystemId:
      typeof input.designSystemId === 'string' ? input.designSystemId : undefined,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
  };

  return { workflow, report };
}

/** True when the document should be run through migrate before persist/execute. */
export function needsWorkflowMigration(input: { schemaVersion?: number } | null | undefined): boolean {
  if (!input) return true;
  return input.schemaVersion !== 2;
}
