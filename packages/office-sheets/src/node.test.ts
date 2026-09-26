import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UNIVER_SNAPSHOT_MAX_CHARS,
  createEmptyWorkbookSnapshot,
  serializeWorkbookSnapshot,
} from './snapshot.js';
import { createSheetsTools, withHeadlessWorkbook } from './node.js';

function toolOutput(result: { success: boolean; output: unknown; error?: string }) {
  if (typeof result.output === 'string') {
    try {
      return JSON.parse(result.output) as Record<string, unknown>;
    } catch {
      return result.output;
    }
  }
  return result.output as Record<string, unknown> | null;
}

describe('createSheetsTools', () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neos-sheets-node-'));
    path = 'budget.univer.json';
    const snapshot = serializeWorkbookSnapshot(
      createEmptyWorkbookSnapshot({ id: 'wb-test', locale: 'enUS' }),
    );
    expect(snapshot.length).toBeLessThanOrEqual(UNIVER_SNAPSHOT_MAX_CHARS);
    await writeFile(join(root, path), snapshot, 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function tools() {
    return createSheetsTools(root);
  }

  function getTool(name: string) {
    const tool = tools().find((t) => t.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  }

  it('sets A1 value hello and get_range returns hello', async () => {
    const set = await getTool('sheets_set_range').execute({
      path,
      a1: 'A1',
      value: 'hello',
    });
    expect(set.success).toBe(true);
    const got = await getTool('sheets_get_range').execute({ path, a1: 'A1' });
    expect(got.success).toBe(true);
    expect(toolOutput(got)?.value).toBe('hello');
  });

  it('sets B1 formula =1+1 and eval returns number 2', async () => {
    const set = await getTool('sheets_set_range').execute({
      path,
      a1: 'B1',
      formula: '=1+1',
    });
    expect(set.success).toBe(true);
    const ev = await getTool('sheets_eval').execute({ path, a1: 'B1' });
    expect(ev.success).toBe(true);
    expect(toolOutput(ev)?.value).toBe(2);
    expect(typeof toolOutput(ev)?.value).toBe('number');
  });

  it('rejects path ../x with outside-workspace wording', async () => {
    const got = await getTool('sheets_get_range').execute({
      path: '../x',
      a1: 'A1',
    });
    expect(got.success).toBe(false);
    expect(got.error).toBe('Path "../x" is outside the workspace');
  });

  it('rejects .json that is not .univer.json', async () => {
    await writeFile(join(root, 'budget.json'), '{}', 'utf8');
    const got = await getTool('sheets_get_range').execute({
      path: 'budget.json',
      a1: 'A1',
    });
    expect(got.success).toBe(false);
    expect(got.error).toMatch(/not a Univer workbook path/);
  });

  it('rejects missing sheet name and sheet+A1 qualifier together', async () => {
    const missing = await getTool('sheets_get_range').execute({
      path,
      a1: 'A1',
      sheet: 'NoSuchSheet',
    });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/sheet not found/);

    const both = await getTool('sheets_set_range').execute({
      path,
      a1: 'Sheet1!A1',
      sheet: 'Sheet1',
      value: 'nope',
    });
    expect(both.success).toBe(false);
    expect(both.error).toMatch(/do not pass sheet both as argument and in A1/);
  });

  it('rejects A1:ZZ1000 bounding area over 10000 without writing', async () => {
    const before = await readFile(join(root, path), 'utf8');
    const got = await getTool('sheets_set_range').execute({
      path,
      a1: 'A1:ZZ1000',
      value: 'x',
    });
    expect(got.success).toBe(false);
    expect(got.error).toBeTruthy();
    const after = await readFile(join(root, path), 'utf8');
    expect(after).toBe(before);
  });

  it('enforces XOR write fields and values shape', async () => {
    const both = await getTool('sheets_set_range').execute({
      path,
      a1: 'A1',
      value: 'hello',
      formula: '=1+1',
    });
    expect(both.success).toBe(false);
    expect(both.error).toMatch(/exactly one of value, values, formula, formulas/);

    const none = await getTool('sheets_set_range').execute({ path, a1: 'A1' });
    expect(none.success).toBe(false);
    expect(none.error).toMatch(/exactly one of value, values, formula, formulas/);

    const shape = await getTool('sheets_set_range').execute({
      path,
      a1: 'A1:B2',
      values: [['only-one']],
    });
    expect(shape.success).toBe(false);
    expect(shape.error).toMatch(/values shape mismatch/);
  });

  it('rejects protected path writes and 2MiB+ content', async () => {
    const env = await getTool('sheets_set_range').execute({
      path: '.env.univer.json',
      a1: 'A1',
      value: 'secret',
    });
    expect(env.success).toBe(false);
    expect(env.error).toMatch(/protected path/i);

    const oversized = `${'x'.repeat(UNIVER_SNAPSHOT_MAX_CHARS + 1)}\n`;
    await writeFile(join(root, 'huge.univer.json'), oversized, 'utf8');
    const size = (await stat(join(root, 'huge.univer.json'))).size;
    expect(size).toBeGreaterThan(UNIVER_SNAPSHOT_MAX_CHARS);
    const readHuge = await getTool('sheets_get_range').execute({
      path: 'huge.univer.json',
      a1: 'A1',
    });
    expect(readHuge.success).toBe(false);
    expect(readHuge.error).toBe(
      `file exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`,
    );

    const writeHuge = await getTool('sheets_set_range').execute({
      path,
      a1: 'A1',
      value: 'x'.repeat(UNIVER_SNAPSHOT_MAX_CHARS + 1),
    });
    expect(writeHuge.success).toBe(false);
    expect(writeHuge.error).toBe(
      `content exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`,
    );
  });

  it('persists to disk so a new instance eval keeps the value and save has resources', async () => {
    const set = await getTool('sheets_set_range').execute({
      path,
      a1: 'B1',
      formula: '=1+1',
    });
    expect(set.success).toBe(true);
    const saved = JSON.parse(await readFile(join(root, path), 'utf8')) as {
      resources?: unknown;
    };
    expect(Object.prototype.hasOwnProperty.call(saved, 'resources')).toBe(true);
    expect(Array.isArray(saved.resources)).toBe(true);

    const again = createSheetsTools(root).find((t) => t.name === 'sheets_eval');
    expect(again).toBeTruthy();
    const ev = await again!.execute({ path, a1: 'B1' });
    expect(ev.success).toBe(true);
    expect(toolOutput(ev)?.value).toBe(2);
  });

  it('withHeadlessWorkbook disposes and save() includes resources', async () => {
    const snapshot = createEmptyWorkbookSnapshot({ id: 'wb-host', locale: 'enUS' });
    const saved = await withHeadlessWorkbook(snapshot, async ({ workbook }) => {
      const result = workbook.save() as { resources?: unknown };
      expect(Object.prototype.hasOwnProperty.call(result, 'resources')).toBe(true);
      return result;
    });
    expect(saved).toBeTruthy();
  });
});
