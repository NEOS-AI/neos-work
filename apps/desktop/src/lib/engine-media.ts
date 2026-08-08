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

  async deleteSkill(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}`, {
      method: 'DELETE',
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
