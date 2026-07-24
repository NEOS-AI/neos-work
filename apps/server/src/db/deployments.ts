/**
 * Deployment history CRUD — read/write the `deployments` table.
 */

import { getDb } from './schema.js';

export interface DeploymentRow {
  id: string;
  workflow_id: string | null;
  run_id: string | null;
  provider: string;
  project_name: string | null;
  url: string | null;
  deployment_id: string | null;
  status: string;
  status_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  workflowId?: string;
  runId?: string;
  provider: string;
  projectName?: string;
  url?: string;
  deploymentId?: string;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentInput {
  workflowId?: string;
  runId?: string;
  provider: string;
  projectName?: string;
  url?: string;
  deploymentId?: string;
  status: Deployment['status'];
  statusMessage?: string;
}

function rowToDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    workflowId: row.workflow_id ?? undefined,
    runId: row.run_id ?? undefined,
    provider: row.provider,
    projectName: row.project_name ?? undefined,
    url: row.url ?? undefined,
    deploymentId: row.deployment_id ?? undefined,
    status: row.status as Deployment['status'],
    statusMessage: row.status_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDeployProvider(raw: unknown): string {
  const p = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (p === 'cloudflare' || p === 'vercel') return p;
  return p; // preserve other non-blank for history rows; callers validate at API layer
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const provider = normalizeDeployProvider(input.provider);
  if (!provider) throw new Error('provider is required');
  const workflowId =
    typeof input.workflowId === 'string' ? input.workflowId.trim() || null : (input.workflowId ?? null);
  const runId =
    typeof input.runId === 'string' ? input.runId.trim() || null : (input.runId ?? null);
  const projectName =
    typeof input.projectName === 'string'
      ? input.projectName.trim() || null
      : (input.projectName ?? null);
  const url = typeof input.url === 'string' ? input.url.trim() || null : (input.url ?? null);
  const deploymentId =
    typeof input.deploymentId === 'string'
      ? input.deploymentId.trim() || null
      : (input.deploymentId ?? null);
  const statusMessage =
    typeof input.statusMessage === 'string'
      ? input.statusMessage.trim() || null
      : (input.statusMessage ?? null);
  const status =
    typeof input.status === 'string' ? input.status.trim() || 'pending' : (input.status ?? 'pending');
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO deployments (
      id, workflow_id, run_id, provider, project_name, url, deployment_id, status, status_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workflowId,
    runId,
    provider,
    projectName,
    url,
    deploymentId,
    status,
    statusMessage,
  );
  return getDeployment(id)!;
}

export function getDeployment(id: string): Deployment | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM deployments WHERE id = ?').get(trimmed) as DeploymentRow | undefined;
  return row ? rowToDeployment(row) : undefined;
}

export function listDeployments(opts?: { workflowId?: string; limit?: number }): Deployment[] {
  const db = getDb();
  const limit = Math.min(Math.max(Number(opts?.limit) || 100, 1), 500);
  const workflowId =
    typeof opts?.workflowId === 'string' ? opts.workflowId.trim() || undefined : undefined;
  if (workflowId) {
    const rows = db.prepare(
      'SELECT * FROM deployments WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(workflowId, limit) as DeploymentRow[];
    return rows.map(rowToDeployment);
  }
  const rows = db.prepare(
    'SELECT * FROM deployments ORDER BY created_at DESC LIMIT ?',
  ).all(limit) as DeploymentRow[];
  return rows.map(rowToDeployment);
}

export function updateDeployment(
  id: string,
  patch: Partial<Pick<CreateDeploymentInput, 'url' | 'deploymentId' | 'status' | 'statusMessage'>>,
): Deployment | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const existing = getDeployment(trimmed);
  if (!existing) return undefined;

  const url =
    patch.url !== undefined
      ? (typeof patch.url === 'string' ? patch.url.trim() || null : null)
      : (existing.url ?? null);
  const deploymentId =
    patch.deploymentId !== undefined
      ? (typeof patch.deploymentId === 'string' ? patch.deploymentId.trim() || null : null)
      : (existing.deploymentId ?? null);
  const status =
    patch.status !== undefined
      ? (typeof patch.status === 'string' ? patch.status.trim() || existing.status : existing.status)
      : existing.status;
  const statusMessage =
    patch.statusMessage !== undefined
      ? (typeof patch.statusMessage === 'string' ? patch.statusMessage.trim() || null : null)
      : (existing.statusMessage ?? null);

  db.prepare(`
    UPDATE deployments SET
      url = ?,
      deployment_id = ?,
      status = ?,
      status_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    url,
    deploymentId,
    status,
    statusMessage,
    trimmed,
  );
  return getDeployment(trimmed);
}

export function deleteDeployment(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM deployments WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
