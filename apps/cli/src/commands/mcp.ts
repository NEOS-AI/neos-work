/**
 * neos mcp — external MCP server list + NEOS-as-MCP-server (Task 16).
 *
 *   neos mcp list
 *   neos mcp serve              # stdio MCP server for coding agents
 *   neos mcp install-info       # snippets (local or from daemon)
 *   neos mcp live-artifacts     # list live artifacts for NEOS_PROJECT_ID
 */

import {
  buildMcpInstallInfo,
  resolveNeosBinPath,
  runNeosMcpStdio,
  type NeosMcpBackend,
} from '@neos-work/mcp-client';

import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';
import { CLI_VERSION } from './version.js';

function createHttpBackend(client: NeosApiClient, cfg: CliConfig): NeosMcpBackend {
  return {
    async status() {
      const h = await client.health();
      return {
        status: h.data?.status ?? 'ok',
        version: h.data?.version,
        serverUrl: cfg.serverUrl,
      };
    },
    async listProjects() {
      const res = await client.listProjects();
      const list = (res.data ?? []) as Array<Record<string, unknown>>;
      return list.map((p) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? ''),
        baseDir: typeof p.baseDir === 'string' ? p.baseDir : undefined,
        entryFile:
          p.entryFile === null
            ? null
            : typeof p.entryFile === 'string'
              ? p.entryFile
              : undefined,
      }));
    },
    async listFiles(projectId) {
      const res = await client.listProjectFiles(projectId);
      return (res.data ?? []) as Array<{ path: string; name?: string; type?: string; size?: number }>;
    },
    async readFile(projectId, path) {
      const res = await client.readProjectFile(projectId, path);
      const data = res.data ?? {};
      return {
        path: typeof data.path === 'string' ? data.path : path,
        content: typeof data.content === 'string' ? data.content : '',
      };
    },
    async writeFile(projectId, path, content) {
      const res = await client.writeProjectFile(projectId, path, content);
      const data = (res.data ?? {}) as Record<string, unknown>;
      return {
        path,
        bytes: typeof data.bytes === 'number' ? data.bytes : content.length,
        contentHash:
          typeof data.hash === 'string'
            ? data.hash
            : typeof data.contentHash === 'string'
              ? data.contentHash
              : undefined,
      };
    },
    async listLiveArtifacts(projectId) {
      const res = await client.listLiveArtifacts(projectId);
      return (res.data ?? []) as Array<{
        id: string;
        projectId: string;
        name: string;
        contentType?: string;
        refreshCount?: number;
        lastRefreshedAt?: string | null;
        updatedAt?: string;
      }>;
    },
    async createLiveArtifact(input) {
      const res = await client.createLiveArtifact(input);
      return res.data as {
        id: string;
        projectId: string;
        name: string;
        contentType?: string;
      };
    },
    async refreshLiveArtifact(projectId, artifactId) {
      const res = await client.refreshLiveArtifact(projectId, artifactId);
      const data = (res.data ?? {}) as Record<string, unknown>;
      const artifact =
        data.artifact && typeof data.artifact === 'object'
          ? (data.artifact as {
              id: string;
              projectId: string;
              name: string;
            })
          : { id: artifactId, projectId, name: artifactId };
      return { artifact, refresh: data.refresh ?? data };
    },
  };
}

export async function cmdMcp(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
  cfg?: CliConfig,
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listMcpServers();
      const list = (res.data ?? []) as Array<{
        id: string;
        name: string;
        transport?: string;
        enabled?: boolean;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map(
            (m) =>
              `${m.id}\t${m.name}\t${m.transport ?? '?'}\t${m.enabled === false ? 'off' : 'on'}`,
          ),
        );
      }
      return EXIT.OK;
    }

    if (sub === 'serve') {
      if (!cfg) {
        ctx.err('mcp serve requires config');
        return EXIT.INTERNAL;
      }
      // All logs must go to stderr — stdout is the MCP JSON-RPC channel.
      const log = (msg: string) => {
        process.stderr.write(`[neos mcp serve] ${msg}\n`);
      };
      log(`version=${CLI_VERSION} server=${cfg.serverUrl} project=${cfg.projectId ?? '(none)'}`);
      const backend = createHttpBackend(client, cfg);
      await runNeosMcpStdio(backend, {
        version: CLI_VERSION,
        defaultProjectId: cfg.projectId,
      });
      // runNeosMcpStdio resolves when transport closes
      return EXIT.OK;
    }

    if (sub === 'install-info' || sub === 'install_info') {
      if (!cfg) {
        ctx.err('mcp install-info requires config');
        return EXIT.INTERNAL;
      }
      // Prefer daemon API when reachable so token/path stay consistent with server view
      try {
        const res = await client.mcpInstallInfo({
          projectId: cfg.projectId ?? undefined,
        });
        if (ctx.json) printJson(ctx, res.data);
        else {
          const d = res.data as {
            shellSnippet?: string;
            codexAddCommand?: string;
            claudeDesktop?: unknown;
          };
          if (d.shellSnippet) ctx.out(d.shellSnippet);
          if (d.codexAddCommand) {
            ctx.out('');
            ctx.out(`# Codex: ${d.codexAddCommand}`);
          }
          if (d.claudeDesktop) {
            ctx.out('');
            ctx.out('# Claude Desktop mcpServers fragment:');
            ctx.out(JSON.stringify(d.claudeDesktop, null, 2));
          }
        }
        return EXIT.OK;
      } catch {
        // Fall back to local snippet generation
        const neosBin = resolveNeosBinPath({ argv1: process.argv[1], execPath: process.execPath });
        const info = buildMcpInstallInfo({
          neosBin,
          serverUrl: cfg.serverUrl,
          authToken: cfg.authToken,
          projectId: cfg.projectId,
          projectDir: cfg.projectDir,
        });
        if (ctx.json) printJson(ctx, info);
        else {
          ctx.out(info.shellSnippet);
          ctx.out('');
          ctx.out(`# Codex: ${info.codexAddCommand}`);
          ctx.out('');
          ctx.out('# Claude Desktop mcpServers fragment:');
          ctx.out(JSON.stringify(info.claudeDesktop, null, 2));
        }
        return EXIT.OK;
      }
    }

    if (sub === 'live-artifacts' || sub === 'live_artifacts' || sub === 'la') {
      if (!cfg?.projectId) {
        ctx.err('NEOS_PROJECT_ID required for mcp live-artifacts');
        return EXIT.USAGE;
      }
      const res = await client.listLiveArtifacts(cfg.projectId);
      const list = (res.data ?? []) as Array<{ id: string; name: string; contentType?: string }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map((a) => `${a.id}\t${a.name}\t${a.contentType ?? ''}`),
        );
      }
      return EXIT.OK;
    }

    ctx.err('usage: neos mcp list|serve|install-info|live-artifacts');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
