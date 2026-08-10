/**
 * Design Project core API surface on the desktop engine client.
 * v0.20 Track D: CRUD + zip; base of EngineProjectCollabClient chain.
 */

import {
  type ApiResponse,
} from '@neos-work/shared';
import {
  EngineTransport,
  readApiResponse,
  scrubApiErrorMessage,
} from './engine-transport.js';

/** Design Project (v0.5 Open Design surface). */
export interface DesignProject {
  id: string;
  name: string;
  baseDir: string;
  entryFile: string | null;
  designSystemId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
  isEntry?: boolean;
}

export interface ProjectFileRevision {
  id: string;
  projectId: string;
  path: string;
  contentHash: string;
  content?: string;
  source: 'user' | 'agent' | 'import' | 'restore';
  createdAt: string;
}

export interface ProjectPreviewComment {
  id: string;
  projectId: string;
  filePath: string;
  selector: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

/** Project chat conversation (persisted multi-turn history). */
export interface ProjectConversation {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Message within a project conversation. */
export interface ProjectMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string | null;
  createdAt: string;
}

/** Marketplace channel for plugin list filters (server plugin-store). */
export type PluginChannel = 'user' | 'official' | 'community' | 'bundled';

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  /** Marketplace channel when known. */
  channel?: PluginChannel;
  pipeline?: Array<{
    id: string;
    name: string;
    kind: string;
    humanInLoop?: boolean;
    schema?: unknown;
  }>;
  inputFields?: Array<{ key: string; label: string; type: string; placeholder?: string }>;
}

export interface PluginListMeta {
  total?: number;
  channels?: Partial<Record<PluginChannel, number>>;
}

export interface Artifact {
  id: string;
  workflowId: string;
  runId?: string;
  name: string;
  contentType: string;
  content?: string;
  nodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Routine {
  id: string;
  name: string;
  workflowId: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  inputs: Record<string, unknown>;
  lastRunAt?: string;
  /** Estimated next schedule fire (ISO), when enabled */
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFileInfo {
  filename: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'other';
  mimeType: string;
  createdAt: string;
  urlPath: string;
}

export interface LiveArtifact {
  id: string;
  projectId: string;
  name: string;
  sourceTemplate?: string | null;
  inputs?: Record<string, unknown>;
  content?: string | null;
  contentType?: string;
  sidecarPath?: string | null;
  refreshCount?: number;
  lastRefreshedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveArtifactRefresh {
  id: string;
  artifactId: string;
  status: 'succeeded' | 'failed';
  contentHash?: string | null;
  error?: string | null;
  createdAt: string;
}

export class EngineProjectCoreClient extends EngineTransport {
  // --- Design Projects (v0.5) ---

  /**
   * Encode a project-relative file path for `/files/*` splat routes.
   * Rejects absolute paths, `..`, control chars; encodes each segment.
   */
  protected projectRelPathSegments(raw: unknown, maxChars = 1_000): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    let p = raw.trim().replace(/\\/g, '/');
    while (p.startsWith('./')) p = p.slice(2);
    p = p.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
    if (!p || p.length > maxChars) return '';
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return '';
    const segments = p.split('/');
    for (const seg of segments) {
      if (!seg || seg === '.' || seg === '..') return '';
    }
    return segments.map((s) => encodeURIComponent(s)).join('/');
  }


  async listProjects(): Promise<ApiResponse<DesignProject[]>> {
    const res = await fetch(`${this.baseUrl}/api/projects`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }


  async getProject(id: string): Promise<ApiResponse<DesignProject>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }


  /**
   * Issue a single-use import token for a folder path (desktop folder import gate).
   */
  async createImportToken(
    path: string,
  ): Promise<ApiResponse<{ token: string; path: string; expiresAt: string; expiresInMs: number }>> {
    if (typeof path !== 'string' || /[\0\r\n]/.test(path) || !path.trim()) {
      return { ok: false, error: 'Invalid path' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/import-token`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: path.trim() }),
    });
    return readApiResponse(res);
  }


  async createProject(input: {
    name: string;
    baseDir?: string;
    /** Single-use token from createImportToken when setting baseDir. */
    importToken?: string;
    entryFile?: string | null;
    designSystemId?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<ApiResponse<DesignProject>> {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return { ok: false, error: 'Invalid name' };
    }
    if (input.baseDir != null && (typeof input.baseDir !== 'string' || /[\0\r\n]/.test(input.baseDir))) {
      return { ok: false, error: 'Invalid baseDir' };
    }
    if (
      input.importToken != null
      && (typeof input.importToken !== 'string' || /[\0\r\n]/.test(input.importToken))
    ) {
      return { ok: false, error: 'Invalid importToken' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: input.name.trim(),
        baseDir: input.baseDir?.trim() || undefined,
        importToken: input.importToken?.trim() || undefined,
        entryFile: input.entryFile,
        designSystemId: input.designSystemId,
        meta: input.meta,
      }),
    });
    return readApiResponse(res);
  }


  async updateProject(
    id: string,
    input: {
      name?: string;
      baseDir?: string;
      entryFile?: string | null;
      designSystemId?: string | null;
      meta?: Record<string, unknown>;
    },
  ): Promise<ApiResponse<DesignProject>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    if (input.name != null && (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name))) {
      return { ok: false, error: 'Invalid name' };
    }
    if (input.baseDir != null && (typeof input.baseDir !== 'string' || /[\0\r\n]/.test(input.baseDir))) {
      return { ok: false, error: 'Invalid baseDir' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }


  async deleteProject(id: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  /** Download project as neos-project ZIP (v0.5.9). Returns blob on success. */
  async exportProjectZip(projectId: string): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
    const seg = this.pathSegment(projectId);
    if (!seg) return { ok: false, error: 'Invalid project id' };
    try {
      const res = await fetch(`${this.baseUrl}/api/projects/${seg}/export.zip`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        const raw = errBody?.error || `HTTP ${res.status}`;
        return { ok: false, error: scrubApiErrorMessage(raw, 'Export failed') };
      }
      const blob = await res.blob();
      if (blob.size === 0) return { ok: false, error: 'Empty export' };
      return { ok: true, blob };
    } catch (err) {
      return {
        ok: false,
        error: scrubApiErrorMessage(
          err instanceof Error ? err.message : 'Export failed',
          'Export failed',
        ),
      };
    }
  }


  /** Import neos-project ZIP (raw body). */
  async importProjectZip(
    zip: Blob | ArrayBuffer,
  ): Promise<ApiResponse<{ project: DesignProject; filesImported: number }>> {
    try {
      const body = zip instanceof Blob ? zip : new Blob([zip], { type: 'application/zip' });
      // Auth only — do not send application/json Content-Type for binary ZIP body
      const headers = { ...this.getHeaders() };
      delete headers['Content-Type'];
      headers['Content-Type'] = 'application/zip';
      const res = await fetch(`${this.baseUrl}/api/projects/import.zip`, {
        method: 'POST',
        headers,
        body,
      });
      return readApiResponse(res);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Import failed' };
    }
  }
}
