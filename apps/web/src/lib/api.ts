/**
 * Minimal browser API client for NEOS daemon.
 */

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class WebApiClient {
  constructor(
    public serverUrl: string,
    public token: string,
  ) {}

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private url(path: string): string {
    const base = this.serverUrl.replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<ApiEnvelope<T>> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        ...this.headers(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
      // health returns bare object
      envelope = { ok: res.ok };
    }
    if (!res.ok) {
      const msg =
        typeof envelope.error === 'string' && envelope.error
          ? envelope.error
          : `HTTP ${res.status}`;
      throw new ApiError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300), res.status);
    }
    return envelope;
  }

  async health(): Promise<{ status: string; version?: string; uptime?: number }> {
    const res = await fetch(this.url('/api/health'), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as { status: string; version?: string; uptime?: number };
  }

  listProjects(): Promise<ApiEnvelope<Array<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>>> {
    return this.request('GET', '/api/projects');
  }

  getProject(id: string): Promise<ApiEnvelope<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(id)}`);
  }

  listFiles(projectId: string): Promise<ApiEnvelope<Array<{ path: string; type?: string }>>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files`);
  }

  readFile(projectId: string, filePath: string): Promise<ApiEnvelope<{ content?: string; path?: string }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`);
  }

  writeFile(projectId: string, filePath: string, content: string): Promise<ApiEnvelope<unknown>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('PUT', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`, {
      content,
      source: 'user',
    });
  }
}
