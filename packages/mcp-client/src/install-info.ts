/**
 * MCP install snippets for connecting external agents to NEOS (OD §14.3).
 */

export const NEOS_MCP_CONFIG_NAME = 'neos-work';

export interface McpInstallInfoInput {
  /** Absolute path to the `neos` binary (or node + script). */
  neosBin: string;
  /** Daemon base URL, e.g. http://127.0.0.1:3000 */
  serverUrl: string;
  /** Optional daemon bearer token (NEOS_AUTH_TOKEN). */
  authToken?: string | null;
  /** Optional default Design Project id. */
  projectId?: string | null;
  /** Optional project directory hint. */
  projectDir?: string | null;
  /** Optional browser UI base URL for deep links. */
  webBaseUrl?: string | null;
  /** Args after the binary (default: ['mcp', 'serve']). */
  args?: string[];
  /** Extra env vars merged into the MCP server process env. */
  extraEnv?: Record<string, string>;
}

export interface McpInstallInfo {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Claude Desktop / Cursor style mcpServers fragment */
  claudeDesktop: {
    mcpServers: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
  };
  /** One-liner for Codex CLI */
  codexAddCommand: string;
  codexRemoveCommand: string;
  /** Generic shell export + run */
  shellSnippet: string;
  /** Optional studio/web deep link */
  webDeepLink: string | null;
}

function clean(raw: unknown, max = 2000): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > max) return '';
  return s;
}

function cleanPath(raw: unknown): string {
  const s = clean(raw, 4096);
  if (!s) return '';
  // Reject obvious injection in paths used in shell snippets
  if (/[`"';$]/.test(s)) return '';
  return s;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

function joinPath(base: string, rel: string): string {
  const b = base.replace(/[/\\]+$/, '');
  const r = rel.replace(/^[/\\]+/, '');
  const sep = b.includes('\\') && !b.includes('/') ? '\\' : '/';
  return `${b}${sep}${r}`;
}

/**
 * Resolve a best-effort absolute path for the neos binary.
 * Prefers explicit path; falls back to argv1 / execPath when provided.
 */
export function resolveNeosBinPath(opts?: {
  explicit?: string | null;
  argv1?: string | null;
  execPath?: string | null;
  cwd?: string;
}): string {
  const explicit = cleanPath(opts?.explicit ?? '');
  if (explicit) {
    if (isAbsolutePath(explicit)) return explicit;
    const cwd = cleanPath(opts?.cwd ?? '') || '.';
    return joinPath(cwd, explicit);
  }
  const argv1 = cleanPath(opts?.argv1 ?? '');
  if (argv1) {
    if (isAbsolutePath(argv1)) return argv1;
    const cwd = cleanPath(opts?.cwd ?? '') || '.';
    return joinPath(cwd, argv1);
  }
  const execPath = cleanPath(opts?.execPath ?? '');
  return execPath || 'neos';
}

export function buildMcpInstallInfo(input: McpInstallInfoInput): McpInstallInfo {
  const command = cleanPath(input.neosBin) || 'neos';
  const args =
    Array.isArray(input.args) && input.args.length > 0
      ? input.args
          .map((a) => clean(a, 200))
          .filter(Boolean)
          .slice(0, 20)
      : ['mcp', 'serve'];

  const serverUrl = clean(input.serverUrl, 500) || 'http://127.0.0.1:3000';
  const env: Record<string, string> = {
    NEOS_SERVER_URL: serverUrl,
  };
  const token = clean(input.authToken ?? '', 500);
  if (token) env.NEOS_AUTH_TOKEN = token;
  const projectId = clean(input.projectId ?? '', 100);
  if (projectId) env.NEOS_PROJECT_ID = projectId;
  const projectDir = cleanPath(input.projectDir ?? '');
  if (projectDir) env.NEOS_PROJECT_DIR = projectDir;

  if (input.extraEnv && typeof input.extraEnv === 'object') {
    for (const [k, v] of Object.entries(input.extraEnv)) {
      const key = clean(k, 64);
      const val = clean(v, 500);
      if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (!val) continue;
      if (key === 'PATH' && val.length > 2000) continue;
      env[key] = val;
    }
  }

  const serverEntry = {
    command,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };

  const claudeDesktop = {
    mcpServers: {
      [NEOS_MCP_CONFIG_NAME]: serverEntry,
    },
  };

  const envFlags = Object.entries(env)
    .map(([k, v]) => `--env ${shellQuote(`${k}=${v}`)}`)
    .join(' ');
  const codexAddCommand = [
    'codex',
    'mcp',
    'add',
    NEOS_MCP_CONFIG_NAME,
    envFlags,
    '--',
    shellQuote(command),
    ...args.map(shellQuote),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const codexRemoveCommand = `codex mcp remove ${NEOS_MCP_CONFIG_NAME}`;

  const exportLines = Object.entries(env)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join('\n');
  const shellSnippet = `${exportLines}\n${shellQuote(command)} ${args.map(shellQuote).join(' ')}`.trim();

  let webDeepLink: string | null = null;
  const web = clean(input.webBaseUrl ?? '', 500);
  if (web) {
    try {
      const u = new URL(web);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        webDeepLink = `${u.origin}/settings?focus=mcp-expose`;
      }
    } catch {
      webDeepLink = null;
    }
  }

  return {
    serverName: NEOS_MCP_CONFIG_NAME,
    command,
    args,
    env,
    claudeDesktop,
    codexAddCommand,
    codexRemoveCommand,
    shellSnippet,
    webDeepLink,
  };
}
