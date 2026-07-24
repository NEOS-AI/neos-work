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

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO deployments (
      id, workflow_id, run_id, provider, project_name, url, deployment_id, status, status_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workflowId ?? null,
    input.runId ?? null,
    input.provider,
    input.projectName ?? null,
    input.url ?? null,
    input.deploymentId ?? null,
    input.status,
    input.statusMessage ?? null,
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

  db.prepare(`
    UPDATE deployments SET
      url = ?,
      deployment_id = ?,
      status = ?,
      status_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    patch.url ?? existing.url ?? null,
    patch.deploymentId ?? existing.deploymentId ?? null,
    patch.status ?? existing.status,
    patch.statusMessage ?? existing.statusMessage ?? null,
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
