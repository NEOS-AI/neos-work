/**
 * Plugins / marketplace / workers / domain-packs API surface on the desktop engine client.
 * v0.18 Track M1: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import {
  type Plugin,
  type PluginListMeta,
} from './engine-project.js';
import { EngineSessionsClient } from './engine-sessions.js';
import {
  type AgentHarness,
  type DomainWorker,
} from './engine-workflow.js';
import {
  parseSseDataPayload,
  readApiResponse,
  scrubApiErrorMessage,
} from './engine-transport.js';

export class EnginePluginsClient extends EngineSessionsClient {
  // --- Marketplace ---

  async getMarketplaceCatalogUrl(): Promise<ApiResponse<{ url: string | null }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog-url`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async setMarketplaceCatalogUrl(url: string): Promise<ApiResponse<{ url: string | null }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog-url`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    return readApiResponse(res);
  }

  async fetchMarketplaceCatalog(url?: string): Promise<
    ApiResponse<{
      schemaVersion: string;
      name?: string;
      entries: Array<{
        id: string;
        name: string;
        description?: string;
        version: string;
        trust: string;
        packageUrl: string;
        sha256?: string;
      }>;
      sourceUrl: string;
    }>
  > {
    const qs =
      url && typeof url === 'string' && !/[\0\r\n]/.test(url)
        ? `?url=${encodeURIComponent(url.trim())}`
        : '';
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async installMarketplaceEntry(input: {
    id?: string;
    url?: string;
    entry?: {
      id: string;
      name: string;
      version: string;
      trust: string;
      packageUrl: string;
      sha256?: string;
      description?: string;
    };
  }): Promise<ApiResponse<{ id: string; version: string; trust: string; message: string }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  // --- Plugins ---

  async listPlugins(): Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }> {
    const res = await fetch(`${this.baseUrl}/api/plugins`, { headers: this.getHeaders() });
    return readApiResponse(res) as Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }>;
  }

  runPlugin(
    id: string,
    inputs: Record<string, unknown>,
    onEvent: (event: unknown) => void,
  ): { stop: () => void; runIdPromise: Promise<string | null> } {
    const controller = new AbortController();
    const runIdPromise = (async () => {
      try {
        const seg = this.pathSegment(id);
        if (!seg) {
          onEvent({ type: 'error', error: 'Invalid plugin id' });
          return null;
        }
        const res = await fetch(`${this.baseUrl}/api/plugins/${seg}/run`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ inputs }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let runId: string | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            // Part may be multi-line; take first data: line
            const dataLine = part
              .split('\n')
              .find((l) => l.startsWith('data:'));
            const payload = dataLine ? parseSseDataPayload(dataLine) : null;
            // Fallback: bare JSON without data: prefix (tests / legacy)
            let jsonText = payload;
            if (!jsonText && part && !/\0/.test(part)) {
              const bare = part.trim();
              if (bare.startsWith('{')) jsonText = bare;
            }
            if (!jsonText) continue;
            try {
              const event = JSON.parse(jsonText) as { type?: string; runId?: string };
              if (event.type === 'pipeline.started' && typeof event.runId === 'string') {
                // Control-char runId ignored
                if (!/[\0\r\n]/.test(event.runId)) {
                  const idTrim = event.runId.trim();
                  if (idTrim) runId = idTrim;
                }
              }
              onEvent(event);
            } catch { /* ignore */ }
          }
        }
        return runId;
      } catch { return null; }
    })();
    return { stop: () => controller.abort(), runIdPromise };
  }

  async resumePlugin(
    id: string,
    runId: string,
    stageId: string,
    response: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('plugin id');
    const runSeg = this.pathSegment(runId);
    if (!runSeg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/plugins/${seg}/run/${runSeg}/resume`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ stageId, response }),
    });
    return readApiResponse(res);
  }

  // --- Workers (v0.4) / Harnesses (deprecated alias) ---

  async listWorkers(domain?: string): Promise<ApiResponse<AgentHarness[]>> {
    const q =
      typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
        ? `?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
        : '';
    const res = await fetch(`${this.baseUrl}/api/workers${q}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listDomainPacks(): Promise<
    ApiResponse<
      Array<{
        id: string;
        name: string;
        description?: string;
        workerCount?: number;
        blockCount?: number;
        isBuiltIn?: boolean;
        enabled?: boolean;
        version?: string;
        sourcePath?: string;
        icon?: string;
      }>
    >
  > {
    const res = await fetch(`${this.baseUrl}/api/domain-packs`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
  async installDomainPackFromPath(dirPath: string): Promise<ApiResponse<Record<string, unknown>>> {
    if (typeof dirPath !== 'string' || /[\0\r\n]/.test(dirPath) || !dirPath.trim()) {
      return { ok: false, error: 'Invalid path' };
    }
    const res = await fetch(`${this.baseUrl}/api/domain-packs/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: dirPath.trim() }),
    });
    return readApiResponse(res);
  }

  /**
   * POST /api/domain-packs/install-zip — multipart `file` (or raw zip).
   * Max ~10 MiB (server DOMAIN_PACK_ZIP_MAX_BYTES).
   */
  async installDomainPackFromZip(
    zip: Blob | File,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      if (!zip || typeof (zip as Blob).size !== 'number') {
        return { ok: false, error: 'Invalid zip' };
      }
      if (zip.size <= 0) return { ok: false, error: 'Empty zip' };
      if (zip.size > 10 * 1024 * 1024) return { ok: false, error: 'zip too large' };
      const form = new FormData();
      const name =
        zip instanceof File && typeof zip.name === 'string' && zip.name.trim()
          ? zip.name.replace(/[\0\r\n]/g, '_').slice(0, 200)
          : 'pack.zip';
      form.append('file', zip, name);
      // Auth only — browser sets multipart boundary
      const headers = { ...this.getHeaders() };
      delete headers['Content-Type'];
      const res = await fetch(`${this.baseUrl}/api/domain-packs/install-zip`, {
        method: 'POST',
        headers,
        body: form,
      });
      return readApiResponse(res);
    } catch (err) {
      return {
        ok: false,
        error: scrubApiErrorMessage(
          err instanceof Error ? err.message : 'Install failed',
          'Install failed',
        ),
      };
    }
  }

  /**
   * POST /api/domain-packs/validate — parse pack.json / manifest without installing.
   */
  async validateDomainPackManifest(
    manifest: unknown,
  ): Promise<
    ApiResponse<{
      id?: string;
      name?: string;
      workerCount?: number;
      blockCount?: number;
      version?: string;
    }>
  > {
    if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { ok: false, error: 'Invalid manifest' };
    }
    const res = await fetch(`${this.baseUrl}/api/domain-packs/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ manifest }),
    });
    return readApiResponse(res);
  }

  async getDomainPack(id: string): Promise<ApiResponse<Record<string, unknown>>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleDomainPack(
    id: string,
    enabled: boolean,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteDomainPack(id: string): Promise<ApiResponse<unknown>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createWorker(
    input: Omit<DomainWorker, 'id' | 'isBuiltIn'> & { id?: string },
  ): Promise<ApiResponse<DomainWorker>> {
    const res = await fetch(`${this.baseUrl}/api/workers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateWorker(id: string, input: Partial<DomainWorker>): Promise<ApiResponse<DomainWorker>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('worker id');
    const res = await fetch(`${this.baseUrl}/api/workers/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteWorker(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('worker id');
    const res = await fetch(`${this.baseUrl}/api/workers/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * @deprecated Prefer listWorkers.
   * Thin alias — `/api/harness` HTTP routes were removed in 0.10.2 (410 Gone).
   */
  async listHarnesses(): Promise<ApiResponse<AgentHarness[]>> {
    return this.listWorkers();
  }
}
