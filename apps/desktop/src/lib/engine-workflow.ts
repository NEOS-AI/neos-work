/**
 * Workflow / deploy / webhook API surface on the desktop engine client.
 * v0.12 M1: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import { EngineProjectClient } from './engine-project.js';
import {
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  scrubApiErrorMessage,
} from './engine-transport.js';

// Local type mirrors (aligned with @neos-work/shared NodeType / Workflow)
export type WorkflowNodeType =
  | 'trigger'
  | 'agent'
  /** @deprecated v1 — migrate to `agent` + workerId */
  | 'agent_finance'
  /** @deprecated v1 — migrate to `agent` + workerId */
  | 'agent_coding'
  | 'block'
  | 'gate_and'
  | 'gate_or'
  | 'parallel_start'
  | 'parallel_end'
  | 'or_gate'
  | 'media'
  | 'deploy'
  | 'web_search'
  | 'slack_message'
  | 'discord_message'
  | 'output';

interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  /** schemaVersion 2 after server migrate; missing treated as v1. */
  schemaVersion?: 1 | 2;
  /** Primary pack id (DB column name remains `domain`). */
  domain: string;
  /** API/JSON primary pack id (may mirror `domain` after migrate). */
  primaryDomain?: string;
  domainPackIds?: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  webhookSecret?: string;
  designSystemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRevision {
  id: string;
  workflowId: string;
  snapshot?: string;
  label?: string;
  createdAt: string;
  nodeCount?: number;
  edgeCount?: number;
}

export interface Deployment {
  id: string;
  workflowId?: string;
  runId?: string;
  /** Design Project id when deploy is project-scoped (Task 10). */
  projectId?: string;
  provider: string;
  projectName?: string;
  url?: string;
  deploymentId?: string;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  nodeResults: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/** @deprecated Prefer DomainWorker (v0.4). Alias kept for Harnesses UI. */
export interface AgentHarness {
  id: string;
  name: string;
  domain: string;
  description: string;
  systemPrompt: string;
  allowedTools?: string[];
  isBuiltIn?: boolean;
  constraints?: {
    maxSteps?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxSpawnedWorkers?: number;
  };
  permissionProfile?: 'read_only' | 'read_write' | 'execute' | 'network' | 'full';
  workspace?:
    | { kind: 'none' }
    | { kind: 'run'; subdir?: string }
    | { kind: 'isolated' };
  defaultMode?: 'solo' | 'coordinator';
  preferredBlockIds?: string[];
  meta?: Record<string, unknown>;
}

/** v0.4 DomainWorker — same shape as AgentHarness (alias). */
export type DomainWorker = AgentHarness;

export type WorkflowSSEEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; nodeId: string; nodeType: string }
  | { type: 'node.progress'; nodeId: string; chunk: string; accumulated: string }
  | { type: 'node.completed'; nodeId: string; output: unknown; durationMs?: number }
  | { type: 'node.failed'; nodeId: string; error: string }
  | { type: 'node.warning'; nodeId: string; message: string }
  | { type: 'run.completed'; runId: string; duration: number; artifactId?: string }
  | { type: 'run.failed'; runId: string; error: string }
  | {
      type: 'worker.started';
      nodeId: string;
      workerId: string;
      workerRunId: string;
    }
  | {
      type: 'worker.progress';
      nodeId: string;
      workerRunId: string;
      chunk: string;
    }
  | {
      type: 'worker.completed';
      nodeId: string;
      workerRunId: string;
      output: unknown;
    }
  | {
      type: 'worker.failed';
      nodeId: string;
      workerRunId: string;
      error: string;
    };

export interface WorkflowBlock {
  id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  isBuiltIn: boolean;
  implementationType: 'native' | 'prompt' | 'skill';
  paramDefs: Array<{ key: string; label: string; type: string; description?: string; default?: unknown; options?: string[]; min?: number; max?: number }>;
  inputDescription: string;
  outputDescription: string;
  requiredSettings?: string[];
  promptTemplate?: string;
  skillId?: string;
}


export class EngineWorkflowClient extends EngineProjectClient {
  // --- Workflows ---

  async listWorkflows(): Promise<ApiResponse<Workflow[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createWorkflow(input: {
    name: string;
    description?: string;
    /** @deprecated Prefer primaryDomain (v0.4 Q2). Still accepted by server. */
    domain?: string;
    /** Primary domain pack id (API/JSON v2 field). */
    primaryDomain?: string;
    domainPackIds?: string[];
    nodes?: unknown[];
    edges?: unknown[];
  }): Promise<ApiResponse<Workflow>> {
    // Prefer primaryDomain when only domain is set (v2 client shape)
    const body = {
      ...input,
      primaryDomain:
        typeof input.primaryDomain === 'string' && input.primaryDomain.trim()
          ? input.primaryDomain.trim()
          : typeof input.domain === 'string' && input.domain.trim()
            ? input.domain.trim()
            : undefined,
    };
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async updateWorkflow(
    id: string,
    input: {
      name?: string;
      description?: string;
      designSystemId?: string;
      domain?: string;
      primaryDomain?: string;
      domainPackIds?: string[] | null;
      nodes?: unknown[];
      edges?: unknown[];
    },
  ): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteWorkflow(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async duplicateWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/duplicate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Download workflow JSON export.
   * @returns true when a download was triggered; false on HTTP failure.
   */
  async exportWorkflow(id: string, workflowName: string): Promise<boolean> {
    const seg = this.pathSegment(id);
    if (!seg) return false;
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/export`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    // Drop control chars then collapse non-filename alphabet; never empty download base
    let raw = typeof workflowName === 'string' ? workflowName : '';
    if (/\0/.test(raw)) raw = raw.replace(/\0/g, '');
    raw = raw.replace(/[\r\n]+/g, ' ').trim();
    const safeName = raw.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'workflow';
    const filename = `${safeName.slice(0, 120)}.neos.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async importWorkflow(data: {
    version: string;
    workflow: {
      name: string;
      description?: string;
      domain: string;
      nodes: unknown[];
      edges: unknown[];
    };
  }): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/import`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return readApiResponse(res);
  }

  async importWorkflowZip(file: File): Promise<ApiResponse<Workflow> & { meta?: { importKind?: string; artifactId?: string } }> {
    const form = new FormData();
    form.append('file', file);
    const headers = this.getHeaders();
    // FormData sets its own Content-Type boundary — remove it
    delete (headers as Record<string, string>)['Content-Type'];
    const res = await fetch(`${this.baseUrl}/api/workflow/import.zip`, {
      method: 'POST',
      headers,
      body: form,
    });
    return readApiResponse(res);
  }

  /** Import Claude Design / HTML-only ZIP as a workflow + artifact */
  async importClaudeDesignZip(file: File): Promise<ApiResponse<Workflow> & { meta?: { importKind?: string; artifactId?: string } }> {
    const form = new FormData();
    form.append('file', file);
    const headers = this.getHeaders();
    delete (headers as Record<string, string>)['Content-Type'];
    const res = await fetch(`${this.baseUrl}/api/workflow/import/claude-design`, {
      method: 'POST',
      headers,
      body: form,
    });
    return readApiResponse(res);
  }

  /**
   * Download workflow ZIP export.
   * @returns true when a download was triggered; false on HTTP failure.
   */
  async exportWorkflowZip(id: string, filename: string): Promise<boolean> {
    const seg = this.pathSegment(id);
    if (!seg) return false;
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/export.zip`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Align with exportWorkflow: scrub control chars then filename-safe alphabet
    let raw = typeof filename === 'string' ? filename : '';
    if (/\0/.test(raw)) raw = raw.replace(/\0/g, '');
    raw = raw.replace(/[\r\n]+/g, ' ').trim().replace(/\.zip$/i, '');
    const base =
      raw.replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 120)
      || 'workflow';
    a.download = `${base}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  runWorkflow(id: string, onEvent: (event: WorkflowSSEEvent) => void, inputs?: Record<string, unknown>): () => void {
    const controller = new AbortController();
    (async () => {
      const seg = this.pathSegment(id);
      if (!seg) {
        onEvent({ type: 'run.failed', runId: '', error: 'Invalid workflow id' });
        return;
      }
      const body = inputs ? JSON.stringify({ inputs }) : undefined;
      const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/run`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = parseSseDataPayload(line);
            if (!data) continue;
            try {
              onEvent(JSON.parse(data) as WorkflowSSEEvent);
            } catch {
              // skip malformed
            }
          }
        }
      }
    })().catch(() => {});
    return () => controller.abort();
  }

  async listWorkflowRuns(workflowId: string, limit = 20, offset = 0): Promise<ApiResponse<WorkflowRun[]>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/runs?limit=${limit}&offset=${offset}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<WorkflowRun>> {
    const seg1 = this.pathSegment(workflowId);
    const seg2 = this.pathSegment(runId);
    if (!seg1) return this.invalidIdResponse('workflow id');
    if (!seg2) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg1}/runs/${seg2}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<void>> {
    const seg1 = this.pathSegment(workflowId);
    if (!seg1) return this.invalidIdResponse('workflow id');
    const seg2 = this.pathSegment(runId);
    if (!seg2) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg1}/runs/${seg2}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Clear runs for a workflow. Optional status filter. */
  async clearWorkflowRuns(
    workflowId: string,
    status?: 'completed' | 'failed' | 'cancelled' | 'running',
  ): Promise<ApiResponse<{ deleted: number }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/runs${qs}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async preflightWorkflow(workflowId: string): Promise<ApiResponse<{
    ok: boolean;
    issues: Array<{ code: string; severity: 'error' | 'warning'; message: string; nodeId?: string }>;
  }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/preflight`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Webhook ---

  async getWebhookSecret(workflowId: string): Promise<ApiResponse<{
    secret: string;
    rateLimit?: { limit: number; remaining: number; resetAt: number; windowMs: number };
  }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}/secret`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async regenerateWebhookSecret(workflowId: string): Promise<ApiResponse<{ secret: string }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}/regenerate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Fire the public webhook endpoint with a valid HMAC (plan Task 13).
   * Uses the stored secret from getWebhookSecret; does not send Bearer auth.
   */
  async testWebhookFire(
    workflowId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; status: number; error?: string }> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return { ok: false, status: 0, error: 'Invalid workflow id' };
    const secretRes = await this.getWebhookSecret(workflowId);
    if (!secretRes.ok || !secretRes.data?.secret) {
      return { ok: false, status: 0, error: 'Failed to load webhook secret' };
    }
    const { hmacSha256Hex } = await import('./hmac.js');
    const raw = JSON.stringify(body);
    const sig = await hmacSha256Hex(secretRes.data.secret, raw);
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neos-Signature': `sha256=${sig}`,
      },
      body: raw,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      const raw = errBody.error ?? res.statusText;
      return {
        ok: false,
        status: res.status,
        error: scrubApiErrorMessage(raw, formatHttpErrorMessage(res.status, res.statusText)),
      };
    }
    // SSE stream — we only need to confirm acceptance; cancel read
    try { res.body?.cancel(); } catch { /* ignore */ }
    return { ok: true, status: res.status };
  }

  // --- Workflow Revisions ---

  async listRevisions(workflowId: string): Promise<ApiResponse<WorkflowRevision[]>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getRevision(workflowId: string, revisionId: string): Promise<ApiResponse<WorkflowRevision>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Persist a revision snapshot onto the workflow record (plan Task 16). */
  async restoreRevision(
    workflowId: string,
    revisionId: string,
  ): Promise<ApiResponse<Workflow> & { meta?: { restoredFrom?: string; label?: string } }> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}/restore`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateRevisionLabel(workflowId: string, revisionId: string, label: string): Promise<ApiResponse<WorkflowRevision>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ label }),
    });
    return readApiResponse(res);
  }

  async deleteRevision(workflowId: string, revisionId: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Deployments ---

  async listDeployments(
    workflowId?: string,
    limit = 100,
    projectId?: string,
  ): Promise<ApiResponse<Deployment[]>> {
    const params = new URLSearchParams();
    if (workflowId) {
      const safeId = this.sanitizeId(workflowId);
      if (!safeId) return this.invalidIdResponse('workflow id');
      params.set('workflowId', safeId);
    }
    if (projectId) {
      const safePid = this.sanitizeId(projectId);
      if (!safePid) return this.invalidIdResponse('project id');
      params.set('projectId', safePid);
    }
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/api/deploy${qs ? `?${qs}` : ''}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteDeployment(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('deployment id');
    const res = await fetch(`${this.baseUrl}/api/deploy/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

}
