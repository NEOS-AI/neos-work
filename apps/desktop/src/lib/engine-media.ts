/**
 * Skills / media / live-artifacts API surface on the desktop engine client.
 * v0.17 Track: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import {
  type LiveArtifact,
  type LiveArtifactRefresh,
  type MediaFileInfo,
  type Plugin,
} from './engine-project.js';
import { EngineSettingsClient } from './engine-settings.js';
import { readApiResponse } from './engine-transport.js';

export interface SkillExampleCard {
  id?: string;
  key?: string;
  title?: string;
  path?: string;
}

export interface SkillData {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string;
  version: string | null;
  enabled: boolean;
  installedAt: string;
  mode?: string;
  category?: string;
  featured?: boolean;
  triggers?: string[];
  examplePrompt?: string;
  /** Package root label when skill is dir/SKILL.md layout (v0.5.7). */
  packageDir?: string;
  exampleCount?: number;
  /** Derived example cards (sanitized basenames). */
  examples?: SkillExampleCard[];
  assets?: string[];
  references?: string[];
  remoteId?: string;
  remoteSource?: string;
  remoteHash?: string;
  skillsShUrl?: string;
  license?: string;
}

export type SkillFetchPath = 'snapshot' | 'zipball' | 'well-known' | 'direct';

export interface RemoteSkillHit {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: 'github' | 'well-known' | 'unknown';
  installUrl: string | null;
  url: string;
  installed: boolean;
}

export interface RemoteSkillAudit {
  provider: string;
  slug: string;
  status: 'pass' | 'warn' | 'fail';
  summary?: string;
  riskLevel?: string;
  auditedAt?: string;
}

export interface CatalogSearchResult {
  query: string;
  searchType: string;
  count: number;
  cached?: boolean;
  stale?: boolean;
  skills: RemoteSkillHit[];
}

export interface CatalogPreviewResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  hash: string | null;
  fileCount: number;
  files: Array<{ path: string; bytes: number }>;
  skillMd: string;
  truncated: boolean;
  trust: 'unverified';
  audits?: RemoteSkillAudit[];
  sourceUrl: string | null;
  skillsShUrl: string;
  fetchPath: SkillFetchPath;
}

export interface SkillAmbiguousCandidate {
  slug: string;
  name: string;
}

export interface InstallRemoteSkillInput {
  id?: string;
  source?: string;
  slug?: string;
  url?: string;
  ref?: string;
  scope?: 'global' | 'workspace';
  confirm: true;
  includeInternal?: boolean;
}

export interface InstallRemoteSkillResult {
  id: string;
  name: string;
  source: 'remote';
  version: string | null;
  hash: string | null;
  scope: 'global' | 'workspace';
  path: string;
  fetchPath: SkillFetchPath;
  shadowed?: 'bundled';
  unchanged?: boolean;
}

export interface DeleteSkillResult {
  filesRemoved: boolean;
  restored?: 'bundled' | 'local';
}

export interface SkillContentResult {
  id: string;
  name: string;
  body: string;
  truncated: boolean;
}

/** Printable ASCII catalog id (owner/repo/slug). Path ids still use pathSegment. */
function safeCatalogId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > 200) return '';
  if (id.includes('..')) return '';
  if (!/^[a-zA-Z0-9._/-]+$/.test(id)) return '';
  return id;
}

function safeCatalogOwner(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const owner = raw.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(owner)) return '';
  return owner;
}

function safeCatalogQuery(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().slice(0, 200);
}

function safeCatalogUrl(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const url = raw.trim();
  if (!url || url.length > 2_048) return '';
  if (!/^https:\/\//i.test(url)) return '';
  return url;
}

export class EngineMediaClient extends EngineSettingsClient {
  // --- Skills ---

  async listSkills(): Promise<ApiResponse<SkillData[]>> {
    const res = await fetch(`${this.baseUrl}/api/skills`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async scanSkills(): Promise<ApiResponse<{ scanned: number; total: number }>> {
    const res = await fetch(`${this.baseUrl}/api/skills/scan`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleSkill(id: string, enabled: boolean): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteSkill(id: string): Promise<ApiResponse<DeleteSkillResult>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async searchSkillCatalog(
    q: string,
    opts?: { limit?: number; owner?: string },
  ): Promise<ApiResponse<CatalogSearchResult>> {
    const query = safeCatalogQuery(q);
    if (query.length < 2) return { ok: false, error: 'query_too_short' };
    const params = new URLSearchParams();
    params.set('q', query);
    if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
      params.set('limit', String(Math.max(1, Math.min(50, Math.trunc(opts.limit)))));
    }
    const owner = safeCatalogOwner(opts?.owner);
    if (owner) params.set('owner', owner);
    const res = await fetch(`${this.baseUrl}/api/skills/catalog/search?${params}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async previewRemoteSkill(input: {
    id?: string;
    url?: string;
  }): Promise<ApiResponse<CatalogPreviewResult>> {
    const params = new URLSearchParams();
    const id = safeCatalogId(input.id);
    const url = safeCatalogUrl(input.url);
    if (id) params.set('id', id);
    else if (url) params.set('url', url);
    else return { ok: false, error: 'invalid_id' };
    const res = await fetch(`${this.baseUrl}/api/skills/catalog/preview?${params}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async installRemoteSkill(
    input: InstallRemoteSkillInput,
  ): Promise<ApiResponse<InstallRemoteSkillResult> & { candidates?: SkillAmbiguousCandidate[] }> {
    if (input.confirm !== true) return { ok: false, error: 'confirm_required' };
    const body: Record<string, unknown> = { confirm: true };
    const id = safeCatalogId(input.id);
    if (id) body.id = id;
    if (typeof input.source === 'string' && !/[\0\r\n]/.test(input.source) && input.source.trim()) {
      body.source = input.source.trim().slice(0, 200);
    }
    if (typeof input.slug === 'string' && !/[\0\r\n]/.test(input.slug) && input.slug.trim()) {
      body.slug = input.slug.trim().slice(0, 200);
    }
    const url = safeCatalogUrl(input.url);
    if (url) body.url = url;
    if (typeof input.ref === 'string' && !/[\0\r\n]/.test(input.ref) && input.ref.trim()) {
      body.ref = input.ref.trim().slice(0, 200);
    }
    if (input.scope === 'global' || input.scope === 'workspace') body.scope = input.scope;
    if (input.includeInternal === true) body.includeInternal = true;
    const res = await fetch(`${this.baseUrl}/api/skills/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async updateSkill(id: string): Promise<ApiResponse<InstallRemoteSkillResult>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}/update`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({}),
    });
    return readApiResponse(res);
  }

  async getSkillContent(id: string): Promise<ApiResponse<SkillContentResult>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}/content`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async upgradeSkillToPlugin(skillId: string): Promise<ApiResponse<Plugin>> {
    // Validate skill id before body send (control-char / blank / traversal fail closed)
    const safeId = this.sanitizeId(skillId);
    if (!safeId) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/plugins/upgrade-from-skill`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: safeId }),
    });
    return readApiResponse(res);
  }

  // --- Media ---

  async deleteMediaFile(filename: string): Promise<ApiResponse<void>> {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) return this.invalidIdResponse('media filename');
    const res = await fetch(`${this.baseUrl}/api/media/file/${seg}`, {
      method: 'DELETE',
      headers: this.mediaAuthHeaders(),
    });
    return readApiResponse(res);
  }

  async listMediaFiles(limit = 100): Promise<ApiResponse<MediaFileInfo[]>> {
    const res = await fetch(`${this.baseUrl}/api/media/files?limit=${limit}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * POST /api/media/generate — unified image | audio | video generation.
   * Image/video use `prompt`; audio uses `text` (mirrors CLI `neos media generate`).
   * Video may return `{ jobId, status }` for async polling via `getMediaJob`.
   */
  async generateMedia(input: {
    surface: 'image' | 'audio' | 'video';
    prompt?: string;
    text?: string;
    provider?: string;
    model?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  }): Promise<
    ApiResponse<{
      surface?: string;
      filename?: string;
      jobId?: string;
      status?: string;
      provider?: string;
      mimeType?: string;
    }>
  > {
    const surface = input.surface;
    if (surface !== 'image' && surface !== 'audio' && surface !== 'video') {
      return { ok: false, error: 'surface must be image, audio, or video' };
    }
    const body: Record<string, string> = { surface };
    if (surface === 'audio') {
      const text = typeof input.text === 'string' ? input.text : input.prompt;
      if (typeof text !== 'string' || /\0/.test(text) || !text.trim()) {
        return { ok: false, error: 'text required for audio' };
      }
      body.text = text.trim();
    } else {
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (!prompt.trim() || /[\0\r\n]/.test(prompt)) {
        return { ok: false, error: 'prompt required (no control characters)' };
      }
      body.prompt = prompt.trim();
    }
    if (
      input.provider != null
      && typeof input.provider === 'string'
      && !/[\0\r\n]/.test(input.provider)
      && input.provider.trim()
    ) {
      body.provider = input.provider.trim();
    }
    if (
      input.model != null
      && typeof input.model === 'string'
      && !/[\0\r\n]/.test(input.model)
      && input.model.trim()
    ) {
      body.model = input.model.trim();
    }
    if (input.size) body.size = input.size;
    if (input.quality) body.quality = input.quality;
    if (input.voice) body.voice = input.voice;

    const res = await fetch(`${this.baseUrl}/api/media/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async getMediaConfig(): Promise<
    ApiResponse<{
      openaiConfigured: boolean;
      openaiBaseUrl: string | null;
      surfaces: string[];
      imageModels: string[];
      audioModels: string[];
      videoModels?: string[];
      stubsAllowed?: boolean;
      providers?: Array<{
        id: string;
        label: string;
        surfaces: string[];
        configured: boolean;
        isStub?: boolean;
      }>;
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/media/config`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listMediaProviders(): Promise<
    ApiResponse<
      Array<{
        id: string;
        label: string;
        surfaces: string[];
        configured: boolean;
        isStub?: boolean;
      }>
    >
  > {
    const res = await fetch(`${this.baseUrl}/api/media/providers`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getMediaJob(
    id: string,
  ): Promise<
    ApiResponse<{
      id: string;
      surface: string;
      provider: string;
      status: string;
      filename?: string;
      error?: string;
    }>
  > {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('job id');
    const res = await fetch(`${this.baseUrl}/api/media/jobs/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async fetchMediaBlob(filename: string): Promise<Blob> {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) throw new Error('Invalid media filename');
    const res = await fetch(`${this.baseUrl}/api/media/file/${seg}`, {
      headers: this.mediaAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load media (${res.status})`);
    return res.blob();
  }

  // --- Live artifacts (Task 9) ---

  async listLiveArtifacts(projectId: string): Promise<ApiResponse<LiveArtifact[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts?projectId=${encodeURIComponent(seg)}`,
      { headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }

  async createLiveArtifact(input: {
    projectId: string;
    name: string;
    sourceTemplate?: string;
    inputs?: Record<string, unknown>;
    contentType?: string;
  }): Promise<ApiResponse<LiveArtifact>> {
    const seg = this.pathSegment(input.projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return { ok: false, error: 'Invalid name' };
    }
    const res = await fetch(`${this.baseUrl}/api/live-artifacts`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        projectId: seg,
        name: input.name.trim(),
        sourceTemplate: input.sourceTemplate,
        inputs: input.inputs,
        contentType: input.contentType,
      }),
    });
    return readApiResponse(res);
  }

  async refreshLiveArtifact(
    id: string,
    projectId: string,
    inputs?: Record<string, unknown>,
  ): Promise<ApiResponse<{ artifact: LiveArtifact; refresh: LiveArtifactRefresh }>> {
    const aid = this.pathSegment(id);
    const pid = this.pathSegment(projectId);
    if (!aid || !pid) return this.invalidIdResponse('id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts/${aid}/refresh?projectId=${encodeURIComponent(pid)}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(inputs ? { inputs } : {}),
      },
    );
    return readApiResponse(res);
  }

  async deleteLiveArtifact(id: string, projectId: string): Promise<ApiResponse<null>> {
    const aid = this.pathSegment(id);
    const pid = this.pathSegment(projectId);
    if (!aid || !pid) return this.invalidIdResponse('id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts/${aid}?projectId=${encodeURIComponent(pid)}`,
      { method: 'DELETE', headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }
}
