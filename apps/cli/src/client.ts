/**
 * Thin HTTP client for the NEOS Work daemon.
 */

import { EXIT, exitCodeFromHttp, type ExitCode } from './exit-codes.js';
import type { CliConfig } from './config.js';
import { CLI_VERSION } from './commands/version.js';

export class CliHttpError extends Error {
  constructor(
    message: string,
    public readonly exitCode: ExitCode,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CliHttpError';
  }
}

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: unknown;
}

export type FetchLike = typeof fetch;

export class NeosApiClient {
  constructor(
    private readonly config: CliConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get baseUrl(): string {
    return this.config.serverUrl;
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `neos-cli/${CLI_VERSION}`,
    };
    if (json) h['Content-Type'] = 'application/json';
    if (this.config.authToken) {
      h.Authorization = `Bearer ${this.config.authToken}`;
    }
    return h;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined> },
  ): Promise<ApiEnvelope<T>> {
    let url = `${this.config.serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (opts?.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v != null && v !== '') qs.set(k, v);
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: this.headers(opts?.body !== undefined),
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      let envelope: ApiEnvelope<T>;
      try {
        const json: unknown = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          envelope = json as ApiEnvelope<T>;
        } else {
          envelope = { ok: res.ok, data: json as T };
        }
      } catch {
        envelope = {
          ok: res.ok,
          error: res.ok ? undefined : `HTTP ${res.status}`,
        };
      }

      if (!res.ok || envelope.ok === false) {
        const msg =
          (typeof envelope.error === 'string' && envelope.error.trim())
          || `HTTP ${res.status}`;
        throw new CliHttpError(
          msg.replace(/[\0\r\n]+/g, ' ').slice(0, 500),
          exitCodeFromHttp(res.status),
          res.status,
          envelope,
        );
      }
      return envelope;
    } catch (err) {
      if (err instanceof CliHttpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliHttpError('Request timed out', EXIT.NETWORK);
      }
      const msg = err instanceof Error ? err.message : 'Network error';
      // connection refused etc.
      if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(msg)) {
        throw new CliHttpError(
          `Daemon unreachable at ${this.config.serverUrl}`,
          EXIT.DAEMON_DOWN,
        );
      }
      throw new CliHttpError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 500), EXIT.NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ApiEnvelope<{ status: string; version?: string; uptime?: number }>> {
    // Health returns a bare HealthResponse (no { ok, data } envelope).
    const url = `${this.config.serverUrl}/api/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': `neos-cli/${CLI_VERSION}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new CliHttpError(`HTTP ${res.status}`, exitCodeFromHttp(res.status), res.status);
      }
      const json = (await res.json()) as { status?: string; version?: string; uptime?: number };
      return {
        ok: true,
        data: {
          status: json.status ?? 'ok',
          version: json.version,
          uptime: json.uptime,
        },
      };
    } catch (err) {
      if (err instanceof CliHttpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliHttpError('Request timed out', EXIT.NETWORK);
      }
      const msg = err instanceof Error ? err.message : 'Network error';
      if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(msg)) {
        throw new CliHttpError(
          `Daemon unreachable at ${this.config.serverUrl}`,
          EXIT.DAEMON_DOWN,
        );
      }
      throw new CliHttpError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 500), EXIT.NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }

  listProjects(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/projects');
  }

  createProject(input: { name: string; baseDir?: string }): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/projects', { body: input });
  }

  getProject(id: string): Promise<ApiEnvelope<unknown>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(id)}`);
  }

  listProjectFiles(projectId: string): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files`);
  }

  readProjectFile(projectId: string, filePath: string): Promise<ApiEnvelope<{ content?: string; path?: string }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`);
  }

  writeProjectFile(
    projectId: string,
    filePath: string,
    content: string,
    opts?: {
      /** When set (e.g. agent/MCP), uses source=agent + collab bind (v0.11). */
      source?: 'user' | 'agent';
      sessionId?: string;
      runId?: string;
    },
  ): Promise<ApiEnvelope<unknown>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const source = opts?.source === 'agent' ? 'agent' : 'user';
    const body: Record<string, unknown> = { content, source };
    if (opts?.sessionId && !/[\0\r\n]/.test(opts.sessionId)) {
      const s = opts.sessionId.trim();
      if (s && s.length <= 64) body.sessionId = s;
    }
    if (opts?.runId && !/[\0\r\n]/.test(opts.runId)) {
      const r = opts.runId.trim();
      if (r && r.length <= 100) body.runId = r;
    }
    return this.request('PUT', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`, {
      body,
    });
  }

  createRun(input: {
    projectId: string;
    prompt: string;
    agentId?: string;
    dryRun?: boolean;
    editContext?: unknown;
  }): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/runs', { body: input });
  }

  getRun(id: string): Promise<ApiEnvelope<unknown>> {
    return this.request('GET', `/api/runs/${encodeURIComponent(id)}`);
  }

  cancelRun(id: string): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', `/api/runs/${encodeURIComponent(id)}/cancel`);
  }

  listMedia(limit = 50): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/media/files', { query: { limit: String(limit) } });
  }

  listPlugins(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/plugins');
  }

  listDeployments(opts?: { projectId?: string; workflowId?: string }): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/deploy', {
      query: { projectId: opts?.projectId, workflowId: opts?.workflowId },
    });
  }

  listSkills(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/skills');
  }

  scanSkills(): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/skills/scan', { body: {} });
  }

  listDesignSystems(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/design-systems');
  }

  listMemories(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/memory');
  }

  createMemory(input: {
    name: string;
    type: string;
    content: string;
    enabled?: boolean;
  }): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/memory', { body: input });
  }

  /**
   * GET /api/memory/export — Markdown export of enabled memories (text body, not JSON envelope).
   */
  async exportMemoriesMarkdown(): Promise<string> {
    const url = `${this.config.serverUrl}/api/memory/export`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1',
          Authorization: `Bearer ${this.config.authToken}`,
          'User-Agent': `neos-cli/${CLI_VERSION}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new CliHttpError(`HTTP ${res.status}`, exitCodeFromHttp(res.status), res.status);
      }
      return await res.text();
    } catch (err) {
      if (err instanceof CliHttpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliHttpError('Request timed out', EXIT.NETWORK);
      }
      const msg = err instanceof Error ? err.message : 'Network error';
      if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(msg)) {
        throw new CliHttpError(
          `Daemon unreachable at ${this.config.serverUrl}`,
          EXIT.DAEMON_DOWN,
        );
      }
      throw new CliHttpError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 500), EXIT.NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }

  listMcpServers(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/mcp-servers');
  }

  mcpInstallInfo(query?: {
    projectId?: string;
    neosBin?: string;
  }): Promise<ApiEnvelope<unknown>> {
    return this.request('GET', '/api/mcp/install-info', {
      query: {
        projectId: query?.projectId,
        neosBin: query?.neosBin,
      },
    });
  }

  listLiveArtifacts(projectId: string): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/live-artifacts', {
      query: { projectId },
    });
  }

  createLiveArtifact(input: {
    projectId: string;
    name: string;
    sourceTemplate?: string | null;
    contentType?: string;
  }): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/live-artifacts', { body: input });
  }

  refreshLiveArtifact(
    projectId: string,
    artifactId: string,
  ): Promise<ApiEnvelope<unknown>> {
    return this.request(
      'POST',
      `/api/live-artifacts/${encodeURIComponent(artifactId)}/refresh`,
      { query: { projectId }, body: {} },
    );
  }

  listPluginAtoms(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/plugins/atoms');
  }

  generateMedia(input: {
    surface: 'image' | 'audio' | 'video';
    prompt?: string;
    text?: string;
    provider?: string;
    model?: string;
    size?: string;
    quality?: string;
    voice?: string;
  }): Promise<ApiEnvelope<unknown>> {
    return this.request('POST', '/api/media/generate', { body: input });
  }

  mediaConfig(): Promise<ApiEnvelope<unknown>> {
    return this.request('GET', '/api/media/config');
  }

  /** GET /api/cli-agents — detected available agents (default). */
  listCliAgents(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/cli-agents');
  }

  /** GET /api/cli-agents/catalog — agent defs only (no host detection). */
  listCliAgentsCatalog(): Promise<ApiEnvelope<unknown[]>> {
    return this.request('GET', '/api/cli-agents/catalog');
  }
}
