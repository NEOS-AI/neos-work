/**
 * NEOS Work as an MCP server (PLAN_FOR_V0_5_0 Task 16 / OD §14.1).
 *
 * Exposes project files + live-artifact tools for external coding agents.
 * Backend is injectable so the CLI can proxy to the daemon HTTP API while
 * tests use in-memory fakes.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export const NEOS_MCP_SERVER_NAME = 'neos-work';
export const NEOS_MCP_DEFAULT_VERSION = '0.7.1';

export interface NeosMcpProjectSummary {
  id: string;
  name: string;
  baseDir?: string;
  entryFile?: string | null;
}

export interface NeosMcpFileEntry {
  path: string;
  name?: string;
  type?: 'file' | 'directory' | string;
  size?: number;
}

export interface NeosMcpLiveArtifact {
  id: string;
  projectId: string;
  name: string;
  contentType?: string;
  refreshCount?: number;
  lastRefreshedAt?: string | null;
  updatedAt?: string;
}

/**
 * Capability surface the MCP tools call into.
 * Implementations must enforce path sandbox / auth themselves (daemon does).
 */
export interface NeosMcpBackend {
  status(): Promise<{ status: string; version?: string; serverUrl?: string }>;
  listProjects(): Promise<NeosMcpProjectSummary[]>;
  listFiles(projectId: string): Promise<NeosMcpFileEntry[]>;
  readFile(projectId: string, path: string): Promise<{ path: string; content: string }>;
  writeFile(
    projectId: string,
    path: string,
    content: string,
  ): Promise<{ path: string; bytes?: number; contentHash?: string }>;
  listLiveArtifacts(projectId: string): Promise<NeosMcpLiveArtifact[]>;
  createLiveArtifact(input: {
    projectId: string;
    name: string;
    sourceTemplate?: string | null;
    contentType?: string;
  }): Promise<NeosMcpLiveArtifact>;
  refreshLiveArtifact(
    projectId: string,
    artifactId: string,
  ): Promise<{ artifact: NeosMcpLiveArtifact; refresh?: unknown }>;
  getSheetRange(input: {
    projectId: string;
    path: string;
    a1: string;
    sheet?: string;
  }): Promise<unknown>;
  setSheetRange(input: {
    projectId: string;
    path: string;
    a1: string;
    sheet?: string;
    value?: unknown;
    values?: unknown;
    formula?: unknown;
    formulas?: unknown;
  }): Promise<unknown>;
  evalSheetRange(input: {
    projectId: string;
    path: string;
    a1: string;
    sheet?: string;
  }): Promise<unknown>;
}

export interface NeosMcpServerOptions {
  version?: string;
  /** Default project when tool args omit projectId (from NEOS_PROJECT_ID). */
  defaultProjectId?: string | null;
  instructions?: string;
}

function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

function jsonResult(value: unknown, isError = false): CallToolResult {
  return textResult(JSON.stringify(value, null, 2), isError);
}

function asString(raw: unknown, max = 500): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > max) return '';
  return s;
}

function asPath(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0]/.test(raw)) return '';
  // Allow path separators; reject CRLF injection
  if (/[\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > 1024) return '';
  // Reject absolute paths and parent-segment traversal (not bare "foo..bar")
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) return '';
  const parts = s.replace(/\\/g, '/').split('/');
  if (parts.some((p) => p === '..')) return '';
  return s;
}

function asContent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/\0/.test(raw)) return null;
  if (raw.length > 2 * 1024 * 1024) return null;
  return raw;
}

export function listNeosMcpTools(): Tool[] {
  const projectIdProp = {
    type: 'string' as const,
    description: 'Design project id (defaults to NEOS_PROJECT_ID when set)',
  };
  return [
    {
      name: 'neos_status',
      description: 'Check NEOS Work daemon health and MCP server version',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'neos_projects_list',
      description: 'List Design Projects on the local NEOS daemon',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'neos_files_list',
      description: 'List files in a Design Project workspace (path sandbox enforced)',
      inputSchema: {
        type: 'object',
        properties: { projectId: projectIdProp },
      },
    },
    {
      name: 'neos_files_read',
      description: 'Read a text file from a Design Project',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          path: {
            type: 'string',
            description: 'Project-relative file path (e.g. index.html)',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'neos_files_write',
      description: 'Write a text file into a Design Project (creates parent dirs)',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          path: {
            type: 'string',
            description: 'Project-relative file path',
          },
          content: {
            type: 'string',
            description: 'UTF-8 file content',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'neos_live_artifacts_list',
      description: 'List live artifacts for a Design Project',
      inputSchema: {
        type: 'object',
        properties: { projectId: projectIdProp },
      },
    },
    {
      name: 'neos_live_artifacts_create',
      description: 'Create a live artifact (HTML template + inputs) in a project',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          name: { type: 'string', description: 'Artifact display name' },
          sourceTemplate: {
            type: 'string',
            description: 'Optional HTML/source template',
          },
          contentType: {
            type: 'string',
            description: 'MIME type (default text/html)',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'neos_live_artifacts_refresh',
      description: 'Refresh a live artifact (re-render template with inputs)',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          artifactId: {
            type: 'string',
            description: 'Live artifact id',
          },
        },
        required: ['artifactId'],
      },
    },
    {
      name: 'neos_sheets_get',
      description: 'Read cell values from a .univer.json workbook (A1 notation).',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          path: { type: 'string', description: 'Project-relative .univer.json path' },
          a1: { type: 'string', description: 'A1 range, e.g. A1 or A1:B2' },
          sheet: { type: 'string', description: 'Sheet name. Default: active/first sheet' },
        },
        required: ['path', 'a1'],
      },
    },
    {
      name: 'neos_sheets_set',
      description: 'Write values or formulas into a .univer.json workbook and save via files API.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          path: { type: 'string', description: 'Project-relative .univer.json path' },
          a1: { type: 'string', description: 'A1 without sheet qualifier, e.g. A1 or A1:B2' },
          sheet: { type: 'string' },
          value: { description: 'Scalar CellValue for a single cell' },
          values: { description: '2D CellValue[][] matching A1 bounding box' },
          formula: { type: 'string', description: 'Single-cell formula, e.g. =1+1' },
          formulas: { description: '2D string[][] matching A1 bounding box' },
        },
        required: ['path', 'a1'],
      },
    },
    {
      name: 'neos_sheets_eval',
      description: 'Force formula calculation on a .univer.json range and return computed values.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: projectIdProp,
          path: { type: 'string', description: 'Project-relative .univer.json path' },
          a1: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path', 'a1'],
      },
    },
  ];
}

export function resolveToolProjectId(
  args: Record<string, unknown> | undefined,
  defaultProjectId?: string | null,
): string {
  const fromArgs = asString(args?.projectId, 100);
  if (fromArgs) return fromArgs;
  const d = asString(defaultProjectId ?? '', 100);
  return d;
}

/**
 * Dispatch a tool call against the backend (unit-testable without stdio).
 */
export async function dispatchNeosMcpTool(
  backend: NeosMcpBackend,
  name: string,
  rawArgs: unknown,
  options: NeosMcpServerOptions = {},
): Promise<CallToolResult> {
  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};

  try {
    switch (name) {
      case 'neos_status': {
        const st = await backend.status();
        return jsonResult({
          ...st,
          mcpServer: NEOS_MCP_SERVER_NAME,
          mcpVersion: options.version ?? NEOS_MCP_DEFAULT_VERSION,
          defaultProjectId: options.defaultProjectId ?? null,
          tools: listNeosMcpTools().map((t) => t.name),
        });
      }
      case 'neos_projects_list': {
        const projects = await backend.listProjects();
        return jsonResult({ projects });
      }
      case 'neos_files_list': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        if (!projectId) {
          return textResult('projectId is required (or set NEOS_PROJECT_ID)', true);
        }
        const files = await backend.listFiles(projectId);
        return jsonResult({ projectId, files });
      }
      case 'neos_files_read': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        const path = asPath(args.path);
        if (!projectId) return textResult('projectId is required', true);
        if (!path) return textResult('path is required and must be project-relative', true);
        const file = await backend.readFile(projectId, path);
        return jsonResult(file);
      }
      case 'neos_files_write': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        const path = asPath(args.path);
        const content = asContent(args.content);
        if (!projectId) return textResult('projectId is required', true);
        if (!path) return textResult('path is required and must be project-relative', true);
        if (content === null) return textResult('content is required (string, max 2MiB)', true);
        const written = await backend.writeFile(projectId, path, content);
        return jsonResult({ ok: true, ...written });
      }
      case 'neos_live_artifacts_list': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        if (!projectId) return textResult('projectId is required', true);
        const artifacts = await backend.listLiveArtifacts(projectId);
        return jsonResult({ projectId, artifacts });
      }
      case 'neos_live_artifacts_create': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        const name = asString(args.name, 200);
        if (!projectId) return textResult('projectId is required', true);
        if (!name) return textResult('name is required', true);
        const sourceTemplate =
          args.sourceTemplate === null
            ? null
            : typeof args.sourceTemplate === 'string'
              ? args.sourceTemplate
              : undefined;
        if (typeof sourceTemplate === 'string' && sourceTemplate.length > 2 * 1024 * 1024) {
          return textResult('sourceTemplate too large', true);
        }
        const contentType = asString(args.contentType, 100) || undefined;
        const art = await backend.createLiveArtifact({
          projectId,
          name,
          sourceTemplate,
          contentType,
        });
        return jsonResult({ ok: true, artifact: art });
      }
      case 'neos_live_artifacts_refresh': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        const artifactId = asString(args.artifactId, 100);
        if (!projectId) return textResult('projectId is required', true);
        if (!artifactId) return textResult('artifactId is required', true);
        const result = await backend.refreshLiveArtifact(projectId, artifactId);
        return jsonResult({ ok: true, ...result });
      }
      case 'neos_sheets_get':
      case 'neos_sheets_set':
      case 'neos_sheets_eval': {
        const projectId = resolveToolProjectId(args, options.defaultProjectId);
        const path = asPath(args.path);
        const a1 = asString(args.a1, 200);
        const sheet = asString(args.sheet, 200) || undefined;
        if (!projectId) return textResult('projectId is required', true);
        if (!path) return textResult('path is required and must be project-relative', true);
        if (!a1) return textResult('a1 is required', true);
        const base = { projectId, path, a1, ...(sheet ? { sheet } : {}) };
        if (name === 'neos_sheets_get') {
          return jsonResult(await backend.getSheetRange(base));
        }
        if (name === 'neos_sheets_eval') {
          return jsonResult(await backend.evalSheetRange(base));
        }
        const write: Record<string, unknown> = { ...base };
        for (const key of ['value', 'values', 'formula', 'formulas'] as const) {
          if (args[key] !== undefined) write[key] = args[key];
        }
        return jsonResult(await backend.setSheetRange(write as Parameters<NeosMcpBackend['setSheetRange']>[0]));
      }
      default:
        return textResult(`Unknown tool: ${name}`, true);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 800), true);
  }
}

export function createNeosMcpServer(
  backend: NeosMcpBackend,
  options: NeosMcpServerOptions = {},
): Server {
  const version = options.version ?? NEOS_MCP_DEFAULT_VERSION;
  const server = new Server(
    { name: NEOS_MCP_SERVER_NAME, version },
    {
      capabilities: { tools: {} },
      instructions:
        options.instructions
        ?? 'NEOS Work MCP server. Use neos_sheets_* for cell edits on .univer.json. neos_files_* remains whole-file UTF-8. Prefer project-relative paths; never escape the project root.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listNeosMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    return dispatchNeosMcpTool(backend, name, request.params.arguments, {
      ...options,
      version,
    });
  });

  return server;
}

/**
 * Connect over stdio (for `neos mcp serve` / agent spawns). Logs go to stderr only.
 */
export async function runNeosMcpStdio(
  backend: NeosMcpBackend,
  options: NeosMcpServerOptions = {},
): Promise<void> {
  const server = createNeosMcpServer(backend, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
