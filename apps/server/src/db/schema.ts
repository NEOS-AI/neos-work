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

    -- Legacy name kept for first-boot on older code paths; migrated to workers below (v0.4 Q1)
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

    -- Canonical custom worker table (v0.4.0 / PLAN_FOR_V0_4_0 Task 7)
    CREATE TABLE IF NOT EXISTS workers (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      domain              TEXT NOT NULL DEFAULT 'general',
      description         TEXT NOT NULL DEFAULT '',
      system_prompt       TEXT NOT NULL DEFAULT '',
      allowed_tools_json  TEXT NOT NULL DEFAULT '[]',
      constraints_json    TEXT NOT NULL DEFAULT '{}',
      permission_profile  TEXT DEFAULT 'full',
      workspace_json      TEXT,
      default_mode        TEXT DEFAULT 'solo',
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

    -- Design Project tables (v0.5.0 M1 / PLAN_FOR_V0_5_0 Task 1)
    CREATE TABLE IF NOT EXISTS projects (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      base_dir          TEXT NOT NULL,
      entry_file        TEXT,
      design_system_id  TEXT,
      meta_json         TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_conversations (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_messages (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL REFERENCES project_conversations(id) ON DELETE CASCADE,
      role             TEXT NOT NULL,
      content          TEXT NOT NULL,
      agent_id         TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS file_revisions (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path          TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      content       TEXT,
      source        TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS preview_comments (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path   TEXT NOT NULL,
      selector    TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
    CREATE INDEX IF NOT EXISTS idx_project_conversations_project_id ON project_conversations(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_messages_conversation_id ON project_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_file_revisions_project_path ON file_revisions(project_id, path);
    CREATE INDEX IF NOT EXISTS idx_preview_comments_project_id ON preview_comments(project_id);

    -- Live artifacts (v0.5.15 / PLAN Task 9)
    CREATE TABLE IF NOT EXISTS live_artifacts (
      id                 TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name               TEXT NOT NULL,
      source_template    TEXT,
      inputs_json        TEXT,
      content            TEXT,
      content_type       TEXT NOT NULL DEFAULT 'text/html',
      sidecar_path       TEXT,
      refresh_count      INTEGER NOT NULL DEFAULT 0,
      last_refreshed_at  TEXT,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS live_artifact_refreshes (
      id            TEXT PRIMARY KEY,
      artifact_id   TEXT NOT NULL REFERENCES live_artifacts(id) ON DELETE CASCADE,
      status        TEXT NOT NULL,
      content_hash  TEXT,
      error         TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_live_artifacts_project_id ON live_artifacts(project_id);
    CREATE INDEX IF NOT EXISTS idx_live_artifact_refreshes_artifact_id ON live_artifact_refreshes(artifact_id);
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
  // v0.4.0 Q2 optional — multi-pack editor filter
  if (!workflowCols.includes('domain_pack_ids_json')) {
    db.exec('ALTER TABLE workflow ADD COLUMN domain_pack_ids_json TEXT');
  }

  // v0.3.4 — routine timezone (DST via IANA zone for node-cron)
  const routineCols = (db.prepare("PRAGMA table_info(routine)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!routineCols.includes('timezone')) {
    db.exec("ALTER TABLE routine ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
  }

  // v0.4.0 — custom_harness → workers rename + DomainWorker columns (Q1 locked)
  const tableNames = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  ).map((t) => t.name);
  if (tableNames.includes('custom_harness') && tableNames.includes('workers')) {
    // Fresh schema created both: copy any legacy rows then drop custom_harness
    const legacyCount = (
      db.prepare('SELECT COUNT(*) AS c FROM custom_harness').get() as { c: number }
    ).c;
    const workersCount = (db.prepare('SELECT COUNT(*) AS c FROM workers').get() as { c: number }).c;
    if (legacyCount > 0 && workersCount === 0) {
      db.exec(`
        INSERT INTO workers (id, name, domain, description, system_prompt, allowed_tools_json, constraints_json, created_at, updated_at)
        SELECT id, name, domain, description, system_prompt, allowed_tools_json, constraints_json, created_at, updated_at
        FROM custom_harness
      `);
    }
    db.exec('DROP TABLE IF EXISTS custom_harness');
  } else if (tableNames.includes('custom_harness') && !tableNames.includes('workers')) {
    db.exec('ALTER TABLE custom_harness RENAME TO workers');
  }

  const workerCols = (
    db.prepare('PRAGMA table_info(workers)').all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (workerCols.length > 0) {
    if (!workerCols.includes('permission_profile')) {
      db.exec("ALTER TABLE workers ADD COLUMN permission_profile TEXT DEFAULT 'full'");
    }
    if (!workerCols.includes('workspace_json')) {
      db.exec('ALTER TABLE workers ADD COLUMN workspace_json TEXT');
    }
    if (!workerCols.includes('default_mode')) {
      db.exec("ALTER TABLE workers ADD COLUMN default_mode TEXT DEFAULT 'solo'");
    }
  }
}
