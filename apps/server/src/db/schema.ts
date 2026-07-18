/**
 * SQLite database initialization and schema.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DB_DIR = path.join(os.homedir(), '.neos-work');
const DB_PATH = path.join(DB_DIR, 'data.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT,
      type        TEXT NOT NULL DEFAULT 'local',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      title         TEXT,
      provider      TEXT DEFAULT 'anthropic',
      model         TEXT DEFAULT 'claude-sonnet-4-5-20250929',
      thinking_mode TEXT DEFAULT 'none',
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS setting (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_step (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      step_index  INTEGER NOT NULL,
      type        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      data        TEXT,
      error       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      key          TEXT NOT NULL,
      content      TEXT NOT NULL,
      tags         TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(workspace_id, key)
    );

    CREATE TABLE IF NOT EXISTS skill (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL UNIQUE,
      description  TEXT,
      source       TEXT NOT NULL,
      path         TEXT NOT NULL,
      version      TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT,
      installed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_server (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      transport  TEXT NOT NULL,
      command    TEXT,
      args       TEXT,
      url        TEXT,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_session_workspace_id ON session(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_session_updated_at ON session(updated_at);
    CREATE INDEX IF NOT EXISTS idx_message_session_id ON message(session_id);
    CREATE INDEX IF NOT EXISTS idx_message_created_at ON message(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_step_session_id ON agent_step(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_step_status ON agent_step(status);
    CREATE INDEX IF NOT EXISTS idx_memory_workspace_id ON memory(workspace_id);

    -- Seed a default workspace if none exists
    INSERT OR IGNORE INTO workspace (id, name, path, type)
    VALUES ('default', 'Starter', NULL, 'local');
  `);

  // Workflow tables (v0.2.0)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      domain      TEXT NOT NULL DEFAULT 'general',
      nodes_json  TEXT NOT NULL DEFAULT '[]',
      edges_json  TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_run (
      id                TEXT PRIMARY KEY,
      workflow_id       TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
      status            TEXT NOT NULL DEFAULT 'running',
      node_results_json TEXT NOT NULL DEFAULT '{}',
      started_at        TEXT DEFAULT (datetime('now')),
      completed_at      TEXT,
      error             TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_harness (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      domain              TEXT NOT NULL DEFAULT 'general',
      description         TEXT NOT NULL DEFAULT '',
      system_prompt       TEXT NOT NULL DEFAULT '',
      allowed_tools_json  TEXT NOT NULL DEFAULT '[]',
      constraints_json    TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_block (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      domain              TEXT NOT NULL DEFAULT 'general',
      category            TEXT NOT NULL DEFAULT 'custom',
      description         TEXT NOT NULL DEFAULT '',
      implementation_type TEXT NOT NULL,
      param_defs_json     TEXT NOT NULL DEFAULT '[]',
      input_description   TEXT NOT NULL DEFAULT '',
      output_description  TEXT NOT NULL DEFAULT '',
      prompt_template     TEXT,
      skill_id            TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_run_workflow_id ON workflow_run(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_updated_at ON workflow(updated_at);

    -- v0.3.0 tables
    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
      run_id       TEXT,
      name         TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content      TEXT,
      file_path    TEXT,
      node_id      TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_revisions (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
      snapshot    TEXT NOT NULL,
      label       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_workflow_id ON artifacts(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_revision_workflow_id ON workflow_revisions(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_revision_created_at ON workflow_revisions(created_at);

    -- Automation Routine tables (v0.3.0)
    CREATE TABLE IF NOT EXISTS routine (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      workflow_id  TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
      schedule     TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      inputs_json  TEXT NOT NULL DEFAULT '{}',
      last_run_at  TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routine_run (
      id          TEXT PRIMARY KEY,
      routine_id  TEXT NOT NULL REFERENCES routine(id) ON DELETE CASCADE,
      run_id      TEXT,
      status      TEXT NOT NULL DEFAULT 'running',
      started_at  TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      error       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_routine_workflow_id ON routine(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_routine_run_routine_id ON routine_run(routine_id);

    -- Deploy history (v0.3.1 / plan Task 8)
    CREATE TABLE IF NOT EXISTS deployments (
      id              TEXT PRIMARY KEY,
      workflow_id     TEXT,
      run_id          TEXT,
      provider        TEXT NOT NULL,
      project_name    TEXT,
      url             TEXT,
      deployment_id   TEXT,
      status          TEXT NOT NULL,
      status_message  TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_deployments_workflow_id ON deployments(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
  `);

  // Migrations for older schemas
  const skillCols = (db.prepare("PRAGMA table_info(skill)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!skillCols.includes('manifest_json')) {
    db.exec("ALTER TABLE skill ADD COLUMN manifest_json TEXT");
  }

  // v0.3.0 migrations
  const workflowCols = (db.prepare("PRAGMA table_info(workflow)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!workflowCols.includes('webhook_secret')) {
    db.exec("ALTER TABLE workflow ADD COLUMN webhook_secret TEXT");
  }
  if (!workflowCols.includes('design_system_id')) {
    db.exec("ALTER TABLE workflow ADD COLUMN design_system_id TEXT");
  }

  // v0.3.4 — routine timezone (DST via IANA zone for node-cron)
  const routineCols = (db.prepare("PRAGMA table_info(routine)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!routineCols.includes('timezone')) {
    db.exec("ALTER TABLE routine ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
  }
}
