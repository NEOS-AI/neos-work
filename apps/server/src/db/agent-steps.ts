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

export function createAgentStep(params: {
  sessionId: string;
  stepIndex: number;
  type: AgentStepType;
  data?: unknown;
}): AgentStepRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const dataStr = params.data !== undefined ? JSON.stringify(params.data) : null;
  db.prepare(
    `INSERT INTO agent_step (id, session_id, step_index, type, status, data)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, params.sessionId, params.stepIndex, params.type, dataStr);
  return getAgentStep(id)!;
}

export function getAgentStep(id: string): AgentStepRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_step WHERE id = ?').get(id) as AgentStepRow | undefined;
}

export function listAgentSteps(sessionId: string): AgentStepRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM agent_step WHERE session_id = ? ORDER BY step_index ASC')
    .all(sessionId) as AgentStepRow[];
}

export function updateAgentStep(
  id: string,
  updates: { status?: AgentStepStatus; data?: unknown; error?: string },
): boolean {
  const db = getDb();
  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.data !== undefined) {
    fields.push('data = ?');
    values.push(JSON.stringify(updates.data));
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    values.push(updates.error);
  }

  values.push(id);
  const result = db
    .prepare(`UPDATE agent_step SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return result.changes > 0;
}

export function deleteAgentSteps(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM agent_step WHERE session_id = ?').run(sessionId);
}
