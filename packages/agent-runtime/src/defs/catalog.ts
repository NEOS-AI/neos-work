import type { AgentCliDef } from '../types.js';

/**
 * Built-in coding-agent CLI definitions (≥ 12).
 * Detection is best-effort; missing binaries are graceful skips.
 */
export const AGENT_CLI_DEFS: readonly AgentCliDef[] = [
  {
    id: 'cli-claude',
    name: 'Claude Code',
    family: 'anthropic',
    settingKey: 'CLI_PATH_CLAUDE',
    streamFormat: 'text',
    enabledByDefault: true,
    launch: {
      binary: 'claude',
      mode: 'argv',
      argsTemplate: ['--print', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-codex',
    name: 'OpenAI Codex CLI',
    family: 'openai',
    settingKey: 'CLI_PATH_CODEX',
    streamFormat: 'text',
    enabledByDefault: true,
    launch: {
      binary: 'codex',
      mode: 'argv',
      argsTemplate: ['exec', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-gemini',
    name: 'Gemini CLI',
    family: 'google',
    settingKey: 'CLI_PATH_GEMINI',
    streamFormat: 'text',
    enabledByDefault: true,
    launch: {
      binary: 'gemini',
      mode: 'argv',
      argsTemplate: ['-p', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-opencode',
    name: 'OpenCode',
    family: 'opencode',
    settingKey: 'CLI_PATH_OPENCODE',
    streamFormat: 'text',
    launch: {
      binary: 'opencode',
      mode: 'argv',
      argsTemplate: ['run', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-cursor',
    name: 'Cursor Agent',
    family: 'cursor',
    settingKey: 'CLI_PATH_CURSOR',
    streamFormat: 'text',
    launch: {
      binary: 'cursor-agent',
      mode: 'argv',
      argsTemplate: ['-p', '{prompt}', '--print'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-aider',
    name: 'Aider',
    family: 'aider',
    settingKey: 'CLI_PATH_AIDER',
    streamFormat: 'text',
    launch: {
      binary: 'aider',
      mode: 'argv',
      argsTemplate: ['--message', '{prompt}', '--yes'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-copilot',
    name: 'GitHub Copilot CLI',
    family: 'github',
    settingKey: 'CLI_PATH_COPILOT',
    streamFormat: 'text',
    launch: {
      binary: 'copilot',
      mode: 'argv',
      argsTemplate: ['-p', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-qwen',
    name: 'Qwen Code',
    family: 'alibaba',
    settingKey: 'CLI_PATH_QWEN',
    streamFormat: 'text',
    launch: {
      binary: 'qwen',
      mode: 'argv',
      argsTemplate: ['--prompt', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-kimi',
    name: 'Kimi CLI',
    family: 'moonshot',
    settingKey: 'CLI_PATH_KIMI',
    streamFormat: 'text',
    launch: {
      binary: 'kimi',
      mode: 'argv',
      argsTemplate: ['-p', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-grok',
    name: 'Grok Build / xAI CLI',
    family: 'xai',
    settingKey: 'CLI_PATH_GROK',
    streamFormat: 'text',
    launch: {
      binary: 'grok',
      mode: 'argv',
      argsTemplate: ['--prompt', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-devin',
    name: 'Devin CLI',
    family: 'cognition',
    settingKey: 'CLI_PATH_DEVIN',
    streamFormat: 'text',
    launch: {
      binary: 'devin',
      mode: 'argv',
      argsTemplate: ['run', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-amp',
    name: 'Amp / Sourcegraph Amp',
    family: 'sourcegraph',
    settingKey: 'CLI_PATH_AMP',
    streamFormat: 'text',
    launch: {
      binary: 'amp',
      mode: 'argv',
      argsTemplate: ['-m', '{prompt}'],
      versionFlag: '--version',
    },
  },
  {
    id: 'cli-continue',
    name: 'Continue CLI',
    family: 'continue',
    settingKey: 'CLI_PATH_CONTINUE',
    streamFormat: 'text',
    launch: {
      binary: 'cn',
      mode: 'argv',
      argsTemplate: ['-p', '{prompt}'],
      versionFlag: '--version',
    },
  },
] as const;

export function getDefById(id: string): AgentCliDef | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const key = id.trim();
  return AGENT_CLI_DEFS.find((d) => d.id === key);
}

/** Map settingKey → def id for path override loading. */
export function settingKeyMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of AGENT_CLI_DEFS) {
    out[d.id] = d.settingKey;
  }
  return out;
}
