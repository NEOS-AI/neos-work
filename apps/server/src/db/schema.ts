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
}
