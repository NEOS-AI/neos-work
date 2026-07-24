/**
 * Shell execution tool — runs system commands within the workspace sandbox.
 * Includes command filtering, cwd sandboxing, and timeout enforcement.
 */

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Tool, ToolResult } from './base.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512_000; // 512 KB

/** Patterns that are never allowed, regardless of context. */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*[/~]/,  // rm -rf on root/home paths
  /\bsudo\b/,
  /\bsu\b\s/,
  /chmod\s+[0-7]*7[0-7]*\s/,                           // world-writable chmod
  /\bdd\b.*\bof\s*=\s*\//,                              // dd writing to root device
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bparted\b/,
  /\bformat\b/,
  /\bifconfig\b/,
  /\bip\s+addr\b/,
  /\biptables\b/,
  /\bsystemctl\b/,
  /\blaunchctl\b/,
  /\bkillall\b\s+(Finder|SystemUIServer|Dock)/i,
  /\bcurl\b.*\|\s*(ba)?sh/,                             // curl pipe to shell
  /\bwget\b.*\|\s*(ba)?sh/,
];

function isForbiddenCommand(command: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(command)) {
      return `Command matches forbidden pattern: ${pattern.source}`;
    }
  }
  return null;
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf-8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf-8');
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function createShellTool(workspaceRoot: string): Tool {
  return {
    name: 'run_command',
    description:
      'Run a shell command within the workspace. Returns stdout, stderr, and exit code. ' +
      'Commands are sandboxed to the workspace directory. Dangerous commands are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: {
          type: 'string',
          description: 'Working directory relative to workspace root (default: workspace root)',
        },
        timeout: {
          type: 'number',
          description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
        },
      },
      required: ['command'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const command =
          typeof input.command === 'string' ? input.command.trim() : String(input.command ?? '').trim();
        if (!command) {
          return { success: false, output: null, error: 'command is required' };
        }
        // Reject null bytes / CR / LF that confuse shell and path APIs
        if (/[\0\r\n]/.test(command)) {
          return { success: false, output: null, error: 'command contains invalid control characters' };
        }
        const timeoutRaw =
          typeof input.timeout === 'number'
            ? input.timeout
            : typeof input.timeout === 'string' && String(input.timeout).trim()
              ? Number(input.timeout)
              : DEFAULT_TIMEOUT_MS;
        const timeoutMs = Math.min(
          Math.max(Number.isFinite(timeoutRaw) ? Math.floor(timeoutRaw) : DEFAULT_TIMEOUT_MS, 1),
          MAX_TIMEOUT_MS,
        );

        // Validate command against forbidden patterns
        const forbidden = isForbiddenCommand(command);
        if (forbidden) {
          return { success: false, output: null, error: forbidden };
        }

        // Resolve and validate cwd
        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        let cwdPath = absoluteRoot;

        if (input.cwd) {
          const cwdRel =
            typeof input.cwd === 'string' ? input.cwd.trim() : String(input.cwd ?? '').trim();
          if (!cwdRel) {
            return { success: false, output: null, error: 'cwd is required when provided' };
          }
          if (/[\0\r\n]/.test(cwdRel)) {
            return { success: false, output: null, error: 'cwd contains invalid control characters' };
          }
          const requestedCwd = resolve(absoluteRoot, cwdRel);
          let realCwd: string;
          try {
            realCwd = realpathSync(requestedCwd);
          } catch {
            return { success: false, output: null, error: `cwd does not exist: ${cwdRel}` };
          }
          if (!realCwd.startsWith(absoluteRoot + '/') && realCwd !== absoluteRoot) {
            return { success: false, output: null, error: `cwd is outside the workspace: ${cwdRel}` };
          }
          cwdPath = realCwd;
        }

        const result = await runCommand(command, cwdPath, timeoutMs);

        // Truncate if output exceeded limit
        const truncated = result.stdout.length >= MAX_OUTPUT_BYTES || result.stderr.length >= MAX_OUTPUT_BYTES;

        return {
          success: result.exitCode === 0,
          output: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            ...(truncated ? { note: 'Output was truncated due to size limit' } : {}),
          },
        };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
