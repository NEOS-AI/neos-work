/**
 * Design systems / artifacts / routines / deploy API surface on the desktop engine client.
 * v0.19 Track A: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import {
  type Artifact,
  type Routine,
} from './engine-project.js';
import { EnginePluginsClient } from './engine-plugins.js';
import {
  type Deployment,
} from './engine-workflow.js';
import { readApiResponse } from './engine-transport.js';

export interface DesignSystem {
  id: string;
  name: string;
  description?: string;
  path: string;
  hasManifest: boolean;
  hasTokens: boolean;
  hasComponents: boolean;
  hasRules?: boolean;
  rulesUpdatedAt?: string;
  /** user writable vs bundled catalog (v0.5.8). */
  source?: 'user' | 'bundled';
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  runId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export class EngineOpsClient extends EnginePluginsClient {
  // --- Design Systems ---

  async listDesignSystems(): Promise<ApiResponse<DesignSystem[]>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createDesignSystem(name: string, description?: string): Promise<ApiResponse<DesignSystem>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    return readApiResponse(res);
  }

  async deleteDesignSystem(id: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getDesignSystemContent(id: string): Promise<ApiResponse<{ content: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/content`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getDesignSystemTokens(id: string): Promise<ApiResponse<{ content: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/tokens`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async saveDesignSystemContent(id: string, content: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/content`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return readApiResponse(res);
  }

  async getDesignSystemRules(id: string): Promise<ApiResponse<{ content: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/rules`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async saveDesignSystemRules(id: string, content: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/rules`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return readApiResponse(res);
  }

  async saveDesignSystemTokens(id: string, content: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/tokens`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return readApiResponse(res);
  }

  // RED stubs: invalid-id short-circuit so Cycle A collects; GREEN fills POST bodies.
  async appendDesignSystemRules(
    id: string,
    _body: { text: string; source?: 'preview-comment' | 'editor' | 'manual'; commentId?: string },
  ): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/rules`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async pruneDesignSystemRules(
    id: string,
    _opts?: { maxEntries?: number; maxAgeDays?: number },
  ): Promise<ApiResponse<{ pruned: number }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/rules`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Artifacts ---

  async listArtifacts(params: { workflowId?: string; runId?: string }): Promise<ApiResponse<Artifact[]>> {
    if (params.runId) {
      const seg = this.pathSegment(params.runId);
      if (!seg) return this.invalidIdResponse('run id');
      const res = await fetch(`${this.baseUrl}/api/artifacts?runId=${seg}`, { headers: this.getHeaders() });
      return readApiResponse(res);
    }
    if (params.workflowId) {
      const seg = this.pathSegment(params.workflowId);
      if (!seg) return this.invalidIdResponse('workflow id');
      const res = await fetch(`${this.baseUrl}/api/artifacts?workflowId=${seg}`, {
        headers: this.getHeaders(),
      });
      return readApiResponse(res);
    }
    return this.invalidIdResponse('workflow id');
  }

  async getArtifact(id: string): Promise<ApiResponse<Artifact>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async refreshArtifact(
    id: string,
    mode: 'reload' | 'rerun' = 'reload',
  ): Promise<ApiResponse<Artifact> & { meta?: { mode?: string; workflowId?: string; nodeId?: string; message?: string } }> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}/refresh`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return readApiResponse(res);
  }

  async deleteArtifact(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateArtifact(
    id: string,
    input: { name?: string; content?: string },
  ): Promise<ApiResponse<Artifact>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  // --- Routines ---

  async listRoutines(): Promise<ApiResponse<Routine[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createRoutine(input: {
    name: string;
    workflowId: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }): Promise<ApiResponse<Routine>> {
    const safeWorkflowId = this.sanitizeId(input.workflowId);
    if (!safeWorkflowId) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/routines`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, workflowId: safeWorkflowId }),
    });
    return readApiResponse(res);
  }

  async updateRoutine(id: string, input: Partial<{ name: string; schedule: string; timezone: string; enabled: boolean; inputs: Record<string, unknown> }>): Promise<ApiResponse<Routine>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteRoutine(id: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async runRoutineNow(id: string): Promise<ApiResponse<{ runId: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}/run`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listRoutineRuns(id: string): Promise<ApiResponse<RoutineRun[]>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}/runs`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async crystallizeRoutineRun(
    routineId: string,
    runId: string,
    input?: { name?: string; description?: string },
  ): Promise<ApiResponse<{ skillId: string; name: string; path: string }>> {
    const rseg = this.pathSegment(routineId);
    if (!rseg) return this.invalidIdResponse('routine id');
    const runSeg = this.pathSegment(runId);
    if (!runSeg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/routines/${rseg}/runs/${runSeg}/crystallize`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    return readApiResponse(res);
  }

  // --- Deploy ---

  async refreshDeployment(id: string): Promise<ApiResponse<Deployment>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('deployment id');
    const res = await fetch(`${this.baseUrl}/api/deploy/${seg}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deployPreflight(provider: 'vercel' | 'cloudflare', projectName?: string): Promise<
    ApiResponse<{
      provider: string;
      ready: boolean;
      checks: Array<{ key: string; ok: boolean; message: string; severity?: string }>;
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/deploy/preflight`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, projectName }),
    });
    return readApiResponse(res);
  }

  /** Check public deployment URL reachability (Task 10). */
  async checkDeployLink(url: string): Promise<
    ApiResponse<{
      url: string;
      reachable: boolean;
      blocked: boolean;
      ok: boolean;
      status?: number;
      reason?: string;
      contentType?: string;
    }>
  > {
    if (typeof url !== 'string' || /[\0\r\n]/.test(url) || !url.trim()) {
      return { ok: false, error: 'Invalid url' };
    }
    const res = await fetch(`${this.baseUrl}/api/deploy/check-link`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
    return readApiResponse(res);
  }
}
