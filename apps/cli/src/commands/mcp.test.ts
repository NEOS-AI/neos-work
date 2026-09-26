import { describe, expect, it, vi } from 'vitest';
import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { createHttpBackend } from './mcp.js';

vi.mock('@neos-work/office-sheets/node', () => ({
  createSheetsTools(workspaceRoot: string) {
    async function readLocal(input: Record<string, unknown>): Promise<string> {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      return readFile(join(workspaceRoot, String(input.path)), 'utf8');
    }
    return [
      {
        name: 'sheets_set_range',
        description: 'mock set',
        inputSchema: { type: 'object' },
        async execute(input: Record<string, unknown>) {
          const current = await readLocal(input);
          if (input.value === 'fail-me') {
            return { success: false, output: null, error: 'exactly one of value, values, formula, formulas' };
          }
          const { writeFile } = await import('node:fs/promises');
          const { join } = await import('node:path');
          await writeFile(join(workspaceRoot, String(input.path)), current, 'utf8');
          return { success: true, output: { path: input.path, a1: input.a1, value: input.value } };
        },
      },
      {
        name: 'sheets_get_range',
        description: 'mock get',
        inputSchema: { type: 'object' },
        async execute(input: Record<string, unknown>) {
          await readLocal(input);
          return { success: true, output: { path: input.path, a1: input.a1, value: 'hello' } };
        },
      },
      {
        name: 'sheets_eval',
        description: 'mock eval',
        inputSchema: { type: 'object' },
        async execute(input: Record<string, unknown>) {
          await readLocal(input);
          return { success: true, output: { path: input.path, a1: input.a1, value: 2 } };
        },
      },
    ];
  },
}));

describe('createHttpBackend sheets path', () => {
  it('GETs the file, runs set, then PUTs the updated snapshot', async () => {
    const snapshot = '{"id":"wb","appVersion":"1.0.2","sheets":{"a":{"id":"a"}}}\n';
    const readProjectFile = vi.fn(async () => ({
      ok: true,
      data: { path: 'budget.univer.json', content: snapshot },
    }));
    const writeProjectFile = vi.fn(async () => ({
      ok: true,
      data: { bytes: 20, hash: 'abc' },
    }));
    const client = {
      readProjectFile,
      writeProjectFile,
    } as unknown as NeosApiClient;
    const cfg: CliConfig = {
      serverUrl: 'http://127.0.0.1:3000',
      authToken: 't',
      projectId: 'p1',
      projectDir: null,
      timeoutMs: 30_000,
    };

    const backend = createHttpBackend(client, cfg);
    const result = await backend.setSheetRange({
      projectId: 'p1',
      path: 'sheets/budget.univer.json',
      a1: 'A1',
      value: 'hello',
    });

    expect(readProjectFile).toHaveBeenCalledWith('p1', 'sheets/budget.univer.json');
    expect(writeProjectFile).toHaveBeenCalled();
    const putArgs = writeProjectFile.mock.calls[0];
    expect(putArgs[0]).toBe('p1');
    expect(putArgs[1]).toBe('sheets/budget.univer.json');
    expect(putArgs[2]).toBe(snapshot);
    expect(result).toMatchObject({
      success: true,
      output: { path: 'sheets/budget.univer.json', value: 'hello' },
    });
  });

  it('get and eval do not PUT; failed set skips PUT', async () => {
    const snapshot = '{"id":"wb","appVersion":"1.0.2","sheets":{"a":{"id":"a"}}}\n';
    const readProjectFile = vi.fn(async () => ({
      ok: true,
      data: { path: 'budget.univer.json', content: snapshot },
    }));
    const writeProjectFile = vi.fn(async () => ({
      ok: true,
      data: { bytes: 20, hash: 'abc' },
    }));
    const client = {
      readProjectFile,
      writeProjectFile,
    } as unknown as NeosApiClient;
    const cfg: CliConfig = {
      serverUrl: 'http://127.0.0.1:3000',
      authToken: 't',
      projectId: 'p1',
      projectDir: null,
      timeoutMs: 30_000,
    };
    const backend = createHttpBackend(client, cfg);

    await backend.getSheetRange({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'A1',
    });
    await backend.evalSheetRange({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'B1',
    });
    const failed = await backend.setSheetRange({
      projectId: 'p1',
      path: 'budget.univer.json',
      a1: 'A1',
      value: 'fail-me',
    });

    expect(failed).toMatchObject({ success: false });
    expect(readProjectFile).toHaveBeenCalledWith('p1', 'budget.univer.json');
    expect(readProjectFile).toHaveBeenCalledTimes(3);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });
});
