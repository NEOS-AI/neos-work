/**
 * Coding-agent CLI registry types (v0.5 Task 2 / PLAN_FOR_V0_5_0).
 */

import type {
  ProjectRunEvent,
  ProjectRunEventType,
  ProjectRunStatus,
} from '@neos-work/shared';

export type StreamFormat = 'text' | 'jsonl' | 'acp';

export type LaunchMode = 'argv' | 'stdin';

export interface LaunchPolicy {
  mode: LaunchMode;
  /**
   * Argv template. `{prompt}` is replaced with the user prompt (argv mode).
   * Other tokens: `{cwd}` optional.
   */
  argsTemplate: string[];
  /** Binary name on PATH when no override. */
  binary: string;
  /** Flag used for version probe (default --version). */
  versionFlag?: string;
  /** Windows: prefer .cmd / shell (hint only). */
  windowsShell?: boolean;
}

export interface AgentCliDef {
  /** Stable id, e.g. cli-claude */
  id: string;
  name: string;
  description?: string;
  /** Settings key for path override, e.g. CLI_PATH_CLAUDE */
  settingKey: string;
  launch: LaunchPolicy;
  streamFormat: StreamFormat;
  /** When false, never auto-spawn in workflows without explicit enable. */
  enabledByDefault?: boolean;
  /** Vendor / family tag for UI grouping. */
  family?: string;
}

export interface DetectedAgent {
  id: string;
  name: string;
  path: string;
  version?: string;
  streamFormat: StreamFormat;
  settingKey: string;
  available: true;
}

export interface MissingAgent {
  id: string;
  name: string;
  streamFormat: StreamFormat;
  settingKey: string;
  available: false;
  binary: string;
}

export type AgentDetectResult = DetectedAgent | MissingAgent;

export type PathOverrides = Record<string, string>;

export interface BuildLaunchResult {
  bin: string;
  args: string[];
  mode: LaunchMode;
  /** When mode is stdin, the prompt is written to stdin instead of argv. */
  stdinPayload?: string;
}

/**
 * In-memory run status (Task 3 shared with project runs).
 * Alias of shared ProjectRunStatus — single wire vocabulary with FE clients.
 */
export type RuntimeRunStatus = ProjectRunStatus;

/** Alias of shared ProjectRunEventType. */
export type RuntimeRunEventType = ProjectRunEventType;

export type RuntimeRunEvent = ProjectRunEvent;

export interface RuntimeRunRecord {
  id: string;
  status: RuntimeRunStatus;
  agentId?: string | null;
  projectId?: string | null;
  prompt?: string;
  editContext?: unknown;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  events: RuntimeRunEvent[];
  abort?: AbortController;
  /**
   * Collab presence session bound at create (v0.11 M0 / Q35).
   * Used as lock identity for agent writes when hard-enforce is on.
   */
  collabSessionId?: string | null;
}
