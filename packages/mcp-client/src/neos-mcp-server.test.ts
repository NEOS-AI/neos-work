import { describe, expect, it, vi } from 'vitest';
import {
  createNeosMcpServer,
  dispatchNeosMcpTool,
  listNeosMcpTools,
  resolveToolProjectId,
  type NeosMcpBackend,
} from './neos-mcp-server.js';

function mockBackend(partial: Partial<NeosMcpBackend> = {}): NeosMcpBackend {
  return {
    status: vi.fn(async () => ({ status: 'ok', version: '0.7.1', serverUrl: 'http://127.0.0.1:3000' })),
    listProjects: vi.fn(async () => [{ id: 'p1', name: 'Demo', baseDir: '/tmp/p1' }]),
    listFiles: vi.fn(async () => [{ path: 'index.html', type: 'file', size: 12 }]),
    readFile: vi.fn(async (_pid, path) => ({ path, content: '<html/>' })),
    writeFile: vi.fn(async (_pid, path, content) => ({ path, bytes: content.length })),
    listLiveArtifacts: vi.fn(async () => [
      { id: 'a1', projectId: 'p1', name: 'Preview', contentType: 'text/html' },
    ]),
    createLiveArtifact: vi.fn(async (input) => ({
      id: 'a2',
      projectId: input.projectId,
      name: input.name,
      contentType: input.contentType ?? 'text/html',
    })),
    refreshLiveArtifact: vi.fn(async (projectId, artifactId) => ({
      artifact: { id: artifactId, projectId, name: 'Preview' },
      refresh: { status: 'succeeded' },
    })),
    getSheetRange: vi.fn(async () => ({ success: true, output: { value: 'hello' } })),
    setSheetRange: vi.fn(async () => ({ success: true, output: { value: 'hello' } })),
    evalSheetRange: vi.fn(async () => ({ success: true, output: { value: 2 } })),
    ...partial,
  };
}

function toolText(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }) {
  return result.content.map((c) => c.text ?? '').join('');
}

describe('listNeosMcpTools', () => {
  it('exports project files + live artifact tools', () => {
    const names = listNeosMcpTools().map((t) => t.name);
    expect(names).toContain('neos_files_list');
    expect(names).toContain('neos_files_read');
    expect(names).toContain('neos_files_write');
    expect(names).toContain('neos_live_artifacts_list');
    expect(names).toContain('neos_live_artifacts_create');
    expect(names).toContain('neos_live_artifacts_refresh');
    expect(names).toContain('neos_status');
    expect(names).toContain('neos_projects_list');
    expect(names).toContain('neos_sheets_get');
    expect(names).toContain('neos_sheets_set');
    expect(names).toContain('neos_sheets_eval');
  });
});

describe('resolveToolProjectId', () => {
  it('prefers args then default', () => {
    expect(resolveToolProjectId({ projectId: ' a ' }, 'b')).toBe('a');
    expect(resolveToolProjectId({}, 'b')).toBe('b');
    expect(resolveToolProjectId({}, null)).toBe('');
    expect(resolveToolProjectId({ projectId: 'x\ny' }, 'b')).toBe('b');
  });
});

describe('dispatchNeosMcpTool', () => {
  it('neos_status returns health payload', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(backend, 'neos_status', {});
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(toolText(res));
    expect(body.status).toBe('ok');
    expect(body.mcpServer).toBe('neos-work');
    expect(body.tools).toContain('neos_files_read');
  });

  it('neos_files_list requires projectId', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(backend, 'neos_files_list', {});
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/projectId/i);
  });

  it('neos_files_list uses default project', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(backend, 'neos_files_list', {}, { defaultProjectId: 'p1' });
    expect(res.isError).toBeFalsy();
    expect(backend.listFiles).toHaveBeenCalledWith('p1');
  });

  it('neos_files_read rejects path traversal', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(
      backend,
      'neos_files_read',
      { projectId: 'p1', path: '../etc/passwd' },
    );
    expect(res.isError).toBe(true);
    expect(backend.readFile).not.toHaveBeenCalled();
  });

  it('neos_files_read allows dotted names that are not parent segments', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(
      backend,
      'neos_files_read',
      { projectId: 'p1', path: 'docs/foo..bar.html' },
    );
    expect(res.isError).toBeFalsy();
    expect(backend.readFile).toHaveBeenCalledWith('p1', 'docs/foo..bar.html');
  });

  it('neos_files_write rejects null-byte content', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(
      backend,
      'neos_files_write',
      { projectId: 'p1', path: 'a.txt', content: 'hi\0there' },
    );
    expect(res.isError).toBe(true);
    expect(backend.writeFile).not.toHaveBeenCalled();
  });

  it('neos_files_write writes content', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(
      backend,
      'neos_files_write',
      { projectId: 'p1', path: 'a.txt', content: 'hi' },
    );
    expect(res.isError).toBeFalsy();
    expect(backend.writeFile).toHaveBeenCalledWith('p1', 'a.txt', 'hi');
  });

  it('live artifacts create + refresh', async () => {
    const backend = mockBackend();
    const create = await dispatchNeosMcpTool(
      backend,
      'neos_live_artifacts_create',
      { projectId: 'p1', name: 'Card' },
    );
    expect(create.isError).toBeFalsy();
    const refresh = await dispatchNeosMcpTool(
      backend,
      'neos_live_artifacts_refresh',
      { projectId: 'p1', artifactId: 'a1' },
    );
    expect(refresh.isError).toBeFalsy();
    expect(backend.refreshLiveArtifact).toHaveBeenCalledWith('p1', 'a1');
  });

  it('neos_sheets_* dispatch to mockBackend three methods', async () => {
    const backend = mockBackend();
    const get = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_get',
      { projectId: 'p1', path: 'budget.univer.json', a1: 'A1' },
    );
    expect(get.isError).toBeFalsy();
    expect(backend.getSheetRange).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'A1',
    });

    const set = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_set',
      { projectId: 'p1', path: 'budget.univer.json', a1: 'A1', value: 'hello' },
    );
    expect(set.isError).toBeFalsy();
    expect(backend.setSheetRange).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'A1',
      value: 'hello',
    });

    const ev = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_eval',
      { projectId: 'p1', path: 'budget.univer.json', a1: 'B1', sheet: 'Sheet1' },
    );
    expect(ev.isError).toBeFalsy();
    expect(backend.evalSheetRange).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'B1',
      sheet: 'Sheet1',
    });
  });

  it('neos_sheets_get rejects path traversal', async () => {
    const backend = mockBackend();
    const res = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_get',
      { projectId: 'p1', path: '../x', a1: 'A1' },
    );
    expect(res.isError).toBe(true);
    expect(backend.getSheetRange).not.toHaveBeenCalled();
  });

  it('neos_sheets_get requires projectId and a1', async () => {
    const backend = mockBackend();
    const noProject = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_get',
      { path: 'budget.univer.json', a1: 'A1' },
    );
    expect(noProject.isError).toBe(true);
    expect(toolText(noProject)).toMatch(/projectId/i);
    expect(backend.getSheetRange).not.toHaveBeenCalled();

    const noA1 = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_get',
      { projectId: 'p1', path: 'budget.univer.json' },
    );
    expect(noA1.isError).toBe(true);
    expect(toolText(noA1)).toMatch(/a1/i);
    expect(backend.getSheetRange).not.toHaveBeenCalled();
  });

  it('neos_sheets_set forwards formula and marks ToolResult failure as isError', async () => {
    const backend = mockBackend({
      setSheetRange: vi.fn(async () => ({
        success: false,
        output: null,
        error: 'exactly one of value, values, formula, formulas',
      })),
    });
    const failRes = await dispatchNeosMcpTool(
      backend,
      'neos_sheets_set',
      { projectId: 'p1', path: 'budget.univer.json', a1: 'A1', value: 'x', formula: '=1' },
    );
    expect(failRes.isError).toBe(true);
    expect(backend.setSheetRange).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'A1',
      value: 'x',
      formula: '=1',
    });

    const okBackend = mockBackend();
    const okRes = await dispatchNeosMcpTool(
      okBackend,
      'neos_sheets_set',
      { projectId: 'p1', path: 'budget.univer.json', a1: 'B1', formula: '=1+1' },
    );
    expect(okRes.isError).toBeFalsy();
    expect(okBackend.setSheetRange).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'B1',
      formula: '=1+1',
    });
  });

  it('unknown tool is error', async () => {
    const res = await dispatchNeosMcpTool(mockBackend(), 'nope', {});
    expect(res.isError).toBe(true);
  });

  it('surfaces backend errors', async () => {
    const backend = mockBackend({
      listProjects: vi.fn(async () => {
        throw new Error('boom\nline');
      }),
    });
    const res = await dispatchNeosMcpTool(backend, 'neos_projects_list', {});
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/boom/);
    expect(toolText(res)).not.toMatch(/\n/);
  });
});

describe('createNeosMcpServer', () => {
  it('constructs a Server with tools capability', () => {
    const server = createNeosMcpServer(mockBackend());
    expect(server).toBeTruthy();
    // Server stores implementation info privately; just ensure no throw on construct
  });
});
