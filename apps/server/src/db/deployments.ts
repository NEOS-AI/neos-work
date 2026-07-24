/**
 * Deployment history CRUD — read/write the `deployments` table.
 */

import { getDb } from './schema.js';
import { safeDeployHostUrl } from '../lib/deploy.js';

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
    status: normalizeDeployStatus(row.status, 'pending'),
    statusMessage: row.status_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


const DEPLOY_STATUSES = new Set(['pending', 'deploying', 'success', 'failed']);

function normalizeDeployStatus(raw: unknown, fallback: Deployment['status'] = 'pending'): Deployment['status'] {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return DEPLOY_STATUSES.has(s) ? (s as Deployment['status']) : fallback;
}

function normalizeDeployProvider(raw: unknown): string {
  const p = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  // Only vercel | cloudflare are supported (defense-in-depth for direct DB callers)
  if (p === 'cloudflare' || p === 'vercel') return p;
  return '';
}

/** Cap remote deployment id / status message fields. */
export const DEPLOY_ID_MAX_CHARS = 200;
export const DEPLOY_STATUS_MESSAGE_MAX_CHARS = 4_000;
export const DEPLOY_PROJECT_NAME_MAX_CHARS = 63;

function capOptionalString(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return raw == null ? null : null;
  const s = raw.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const provider = normalizeDeployProvider(input.provider);
  if (!provider) throw new Error('provider is required');
  const workflowId =
    typeof input.workflowId === 'string' ? input.workflowId.trim() || null : (input.workflowId ?? null);
  const runId =
    typeof input.runId === 'string' ? input.runId.trim() || null : (input.runId ?? null);
  let projectName =
    typeof input.projectName === 'string'
      ? input.projectName.trim() || null
      : (input.projectName ?? null);
  if (projectName && projectName.length > DEPLOY_PROJECT_NAME_MAX_CHARS) {
    projectName = projectName.slice(0, DEPLOY_PROJECT_NAME_MAX_CHARS);
  }
  // Only persist http(s) deployment URLs (drop file:/javascript: etc.)
  const url =
    input.url !== undefined ? (safeDeployHostUrl(input.url) ?? null) : null;
  const deploymentId = capOptionalString(input.deploymentId, DEPLOY_ID_MAX_CHARS);
  const statusMessage = capOptionalString(input.statusMessage, DEPLOY_STATUS_MESSAGE_MAX_CHARS);
  const status = normalizeDeployStatus(input.status, 'pending');
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
      ? (safeDeployHostUrl(patch.url) ?? null)
      : (existing.url ?? null);
  const deploymentId =
    patch.deploymentId !== undefined
      ? capOptionalString(patch.deploymentId, DEPLOY_ID_MAX_CHARS)
      : (existing.deploymentId ?? null);
  const status =
    patch.status !== undefined
      ? normalizeDeployStatus(patch.status, existing.status)
      : existing.status;
  const statusMessage =
    patch.statusMessage !== undefined
      ? capOptionalString(patch.statusMessage, DEPLOY_STATUS_MESSAGE_MAX_CHARS)
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
