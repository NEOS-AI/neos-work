/**
 * Blocks / templates / memory API surface on the desktop engine client.
 * v0.20 Track C: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import { EngineOpsClient } from './engine-ops.js';
import { type WorkflowBlock } from './engine-workflow.js';
import { readApiResponse } from './engine-transport.js';

export type MemoryType = 'user' | 'session' | 'skill' | 'reference';

export interface MemoryItem {
  id: string;
  name: string;
  type: MemoryType;
  enabled: boolean;
  content: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  name: string;
  type: MemoryType;
  content: string;
  enabled?: boolean;
}

export interface UpdateMemoryInput {
  name?: string;
  type?: MemoryType;
  content?: string;
  enabled?: boolean;
}

export class EngineCatalogClient extends EngineOpsClient {
  // --- Blocks ---

  async listBlocks(domain?: string): Promise<ApiResponse<WorkflowBlock[]>> {
    const url = domain
      ? `${this.baseUrl}/api/blocks?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/blocks`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createBlock(input: Omit<WorkflowBlock, 'isBuiltIn'>): Promise<ApiResponse<WorkflowBlock>> {
    const res = await fetch(`${this.baseUrl}/api/blocks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateBlock(id: string, input: Partial<WorkflowBlock>): Promise<ApiResponse<WorkflowBlock>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('block id');
    const res = await fetch(`${this.baseUrl}/api/blocks/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteBlock(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('block id');
    const res = await fetch(`${this.baseUrl}/api/blocks/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Templates ---

  async getTemplates(domain?: string): Promise<ApiResponse<unknown[]>> {
    const url = domain
      ? `${this.baseUrl}/api/templates?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/templates`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  // --- Memory ---

  async listMemories(): Promise<ApiResponse<MemoryItem[]>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createMemory(input: CreateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleMemory(id: string): Promise<ApiResponse<MemoryItem>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}/toggle`, {
      method: 'PUT',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
}
