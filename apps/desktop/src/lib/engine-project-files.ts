/**
 * Design Project files / revisions / preview-comments API surface.
 * v0.20 Track D: extends EngineProjectCollabClient.
 */

import {
  parseProjectFileWriteResponse,
  type ApiResponse,
  type ProjectFileContent,
  type ProjectFileWriteResult,
} from '@neos-work/shared';
import { readApiResponse } from './engine-transport.js';
import { EngineProjectCollabClient } from './engine-project-collab.js';
import type {
  ProjectFileEntry,
  ProjectFileRevision,
  ProjectPreviewComment,
} from './engine-project-core.js';

export class EngineProjectFilesClient extends EngineProjectCollabClient {
  // --- Project files ---


  async listProjectFiles(projectId: string): Promise<ApiResponse<ProjectFileEntry[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  async readProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<ApiResponse<ProjectFileContent>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  async writeProjectFile(
    projectId: string,
    filePath: string,
    content: string,
    source: 'user' | 'agent' | 'import' | 'restore' = 'user',
    /**
     * Collab presence session id. Required for `NEOS_SHARED_EDIT` hard enforce
     * so the lock holder can write their own locked file (body + x-neos-session-id).
     */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<ProjectFileWriteResult>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    if (typeof content !== 'string' || /\0/.test(content)) {
      return { ok: false, error: 'Invalid content' };
    }
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const body: { content: string; source: string; sessionId?: string } = {
      content,
      source,
    };
    if (sessionId) body.sessionId = sessionId;
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    const envelope = await readApiResponse<ProjectFileWriteResult>(res);
    if (envelope.ok) {
      const checked = parseProjectFileWriteResponse(envelope);
      if (!checked.ok) {
        return { ok: false, error: checked.error };
      }
      return {
        ok: true,
        data: checked.data.data as ProjectFileWriteResult,
      };
    }
    return envelope;
  }


  async deleteProjectFile(
    projectId: string,
    filePath: string,
    /** Collab session for `NEOS_SHARED_EDIT` hard enforce when path is locked. */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path?: string; holder?: unknown }>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      method: 'DELETE',
      headers,
      body: sessionId ? JSON.stringify({ sessionId }) : undefined,
    });
    return readApiResponse(res);
  }


  async mkdirProjectPath(
    projectId: string,
    dirPath: string,
    /** Collab session for `NEOS_SHARED_EDIT` hard enforce when path is locked. */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path: string; holder?: unknown }>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (typeof dirPath !== 'string' || /[\0\r\n]/.test(dirPath) || !dirPath.trim()) {
      return this.invalidIdResponse('path');
    }
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const body: { path: string; sessionId?: string } = { path: dirPath.trim() };
    if (sessionId) body.sessionId = sessionId;
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/mkdir`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }


  async listProjectRevisions(
    projectId: string,
    filePath?: string,
  ): Promise<ApiResponse<ProjectFileRevision[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath !== 'string' || /[\0\r\n]/.test(filePath)) {
        return this.invalidIdResponse('file path');
      }
      qs = `?path=${encodeURIComponent(filePath.trim())}`;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/revisions${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  /** GET /api/projects/:id/revisions/:revisionId — includes content snapshot. */
  async getProjectRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ApiResponse<ProjectFileRevision>> {
    const pSeg = this.pathSegment(projectId);
    const rSeg = this.pathSegment(revisionId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!rSeg) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/projects/${pSeg}/revisions/${rSeg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  async restoreProjectRevision(
    projectId: string,
    revisionId: string,
    /**
     * Collab presence session id. Required under `NEOS_SHARED_EDIT` hard enforce
     * when the target path is locked (body + x-neos-session-id).
     */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path: string; hash: string }>> {
    const pSeg = this.pathSegment(projectId);
    const rSeg = this.pathSegment(revisionId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!rSeg) return this.invalidIdResponse('revision id');
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/revisions/${rSeg}/restore`,
      {
        method: 'POST',
        headers,
        body: sessionId ? JSON.stringify({ sessionId }) : undefined,
      },
    );
    return readApiResponse(res);
  }


  async listProjectPreviewComments(
    projectId: string,
    filePath?: string,
  ): Promise<ApiResponse<ProjectPreviewComment[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath !== 'string' || /[\0\r\n]/.test(filePath)) {
        return this.invalidIdResponse('file path');
      }
      qs = `?path=${encodeURIComponent(filePath.trim())}`;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/preview-comments${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }


  async createProjectPreviewComment(
    projectId: string,
    input: { filePath: string; selector: string; body: string },
  ): Promise<ApiResponse<ProjectPreviewComment>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (
      typeof input.filePath !== 'string'
      || typeof input.selector !== 'string'
      || typeof input.body !== 'string'
      || /[\0\r\n]/.test(input.filePath)
      || /[\0\r\n]/.test(input.selector)
      || /\0/.test(input.body)
    ) {
      return { ok: false, error: 'Invalid comment fields' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/preview-comments`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: input.filePath.trim(),
        selector: input.selector.trim(),
        body: input.body.trim(),
      }),
    });
    return readApiResponse(res);
  }


  async deleteProjectPreviewComment(
    projectId: string,
    commentId: string,
  ): Promise<ApiResponse<void>> {
    const pSeg = this.pathSegment(projectId);
    const cSeg = this.pathSegment(commentId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!cSeg) return this.invalidIdResponse('comment id');
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/preview-comments/${cSeg}`,
      { method: 'DELETE', headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }
}
