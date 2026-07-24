/**
 * CRUD operations for the agent_step table.
 * Records each step of an agent execution for auditability and resumability.
 */

import { getDb } from './schema.js';

export type AgentStepType = 'plan' | 'tool_use' | 'tool_result' | 'reasoning' | 'error';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error';

export interface AgentStepRow {
  id: string;
  session_id: string;
  step_index: number;
  type: AgentStepType;
  status: AgentStepStatus;
  data: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STEP_TYPES = new Set<AgentStepType>(['plan', 'tool_use', 'tool_result', 'reasoning', 'error']);
const STEP_STATUSES = new Set<AgentStepStatus>(['pending', 'running', 'completed', 'error']);
/** Cap serialized step data (runaway tool output defense). */
const AGENT_STEP_DATA_MAX_CHARS = 512 * 1024;

function serializeStepData(data: unknown): string | null {
  if (data === undefined) return null;
  const dataStr = JSON.stringify(data);
  if (dataStr.length > AGENT_STEP_DATA_MAX_CHARS) {
    return JSON.stringify({ truncated: true, preview: dataStr.slice(0, 256) });
  }
  return dataStr;
}

export function createAgentStep(params: {
  sessionId: string;
  stepIndex: number;
  type: AgentStepType;
  data?: unknown;
}): AgentStepRow {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
  if (!sessionId) throw new Error('sessionId is required');
  const typeRaw = typeof params.type === 'string' ? params.type.trim().toLowerCase() : '';
  if (!STEP_TYPES.has(typeRaw as AgentStepType)) {
    throw new Error('type must be plan|tool_use|tool_result|reasoning|error');
  }
  const stepIndex = Number(params.stepIndex);
  if (!Number.isFinite(stepIndex) || stepIndex < 0) {
    throw new Error('stepIndex must be a non-negative number');
  }
  const db = getDb();
  const id = crypto.randomUUID();
  const dataStr = serializeStepData(params.data);
  db.prepare(
    `INSERT INTO agent_step (id, session_id, step_index, type, status, data)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, sessionId, Math.floor(stepIndex), typeRaw, dataStr);
  return getAgentStep(id)!;
}

export function getAgentStep(id: string): AgentStepRow | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  return db.prepare('SELECT * FROM agent_step WHERE id = ?').get(trimmed) as AgentStepRow | undefined;
}

export function listAgentSteps(sessionId: string): AgentStepRow[] {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!sid) return [];
  const db = getDb();
  return db
    .prepare('SELECT * FROM agent_step WHERE session_id = ? ORDER BY step_index ASC')
    .all(sid) as AgentStepRow[];
}

export function updateAgentStep(
  id: string,
  updates: { status?: AgentStepStatus; data?: unknown; error?: string },
): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    const status =
      typeof updates.status === 'string' ? updates.status.trim().toLowerCase() : '';
    if (!status || !STEP_STATUSES.has(status as AgentStepStatus)) return false;
    fields.push('status = ?');
    values.push(status);
  }
  if (updates.data !== undefined) {
    fields.push('data = ?');
    values.push(serializeStepData(updates.data));
  }
  if (updates.error !== undefined) {
    // Cap error text (runaway tool dump defense)
    const ERROR_MAX = 4_000;
    let error: string | null =
      typeof updates.error === 'string'
        ? updates.error.trim() || null
        : updates.error == null
          ? null
          : String(updates.error);
    if (error && error.length > ERROR_MAX) {
      error = error.slice(0, ERROR_MAX) + '…[truncated]';
    }
    fields.push('error = ?');
    values.push(error);
  }

  values.push(trimmed);
  const result = db
    .prepare(`UPDATE agent_step SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return result.changes > 0;
}

export function deleteAgentSteps(sessionId: string): void {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!sid) return;
  const db = getDb();
  db.prepare('DELETE FROM agent_step WHERE session_id = ?').run(sid);
}
