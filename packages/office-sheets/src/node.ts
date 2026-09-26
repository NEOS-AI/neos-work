import { realpathSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { UniverSheetsNodeCorePreset } from '@univerjs/preset-sheets-node-core';
import UniverPresetSheetsNodeCoreEnUS from '@univerjs/preset-sheets-node-core/locales/en-US';
import UniverPresetSheetsNodeCoreKoKR from '@univerjs/preset-sheets-node-core/locales/ko-KR';
import { LocaleType, createUniver, mergeLocales } from '@univerjs/presets';
import {
  UNIVER_SNAPSHOT_MAX_CHARS,
  UniverSnapshotError,
  isUniverWorkbookPath,
  parseWorkbookSnapshot,
  serializeWorkbookSnapshot,
  type UniverWorkbookSnapshot,
} from './snapshot.js';
import { isProtectedPath, safePath } from './workspace-path.js';

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

type CellValue = string | number | boolean;

const RANGE_CELL_LIMIT = 10_000;
const FORMULA_WAIT_MS = 30_000;
const XOR_ERROR = 'exactly one of value, values, formula, formulas';
const SHEET_BOTH_ERROR = 'do not pass sheet both as argument and in A1';
const SHEET_NOT_FOUND = 'sheet not found';
const INVALID_A1 = 'invalid A1';
const VALUES_SHAPE = 'values shape mismatch';
const NOT_WORKBOOK_PATH = 'not a Univer workbook path';

interface ParsedA1 {
  sheetFromA1?: string;
  a1: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

function fail(error: string): ToolResult {
  return { success: false, output: null, error };
}

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return Number.NaN;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function parseA1(raw: unknown): ParsedA1 {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) {
    throw new Error(INVALID_A1);
  }
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(INVALID_A1);

  let sheetFromA1: string | undefined;
  let body = trimmed;
  const bang = trimmed.lastIndexOf('!');
  if (bang >= 0) {
    const sheetPart = trimmed.slice(0, bang);
    body = trimmed.slice(bang + 1);
    if (!sheetPart) throw new Error(INVALID_A1);
    sheetFromA1 =
      sheetPart.startsWith("'") && sheetPart.endsWith("'")
        ? sheetPart.slice(1, -1).replace(/''/g, "'")
        : sheetPart;
  }

  const m = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(body);
  if (!m) throw new Error(INVALID_A1);
  const startCol = colLettersToIndex(m[1]!);
  const startRow = Number(m[2]) - 1;
  const endCol = m[3] ? colLettersToIndex(m[3]) : startCol;
  const endRow = m[4] ? Number(m[4]) - 1 : startRow;
  if (
    !Number.isFinite(startCol)
    || !Number.isFinite(endCol)
    || !Number.isInteger(startRow)
    || !Number.isInteger(endRow)
    || startRow < 0
    || endRow < 0
    || startCol < 0
    || endCol < 0
  ) {
    throw new Error(INVALID_A1);
  }
  return {
    sheetFromA1,
    a1: body,
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

function boundingArea(parsed: ParsedA1): number {
  return (parsed.endRow - parsed.startRow + 1) * (parsed.endCol - parsed.startCol + 1);
}

function asOptionalSheet(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const s = raw.trim();
  return s || undefined;
}

function xorWriteFields(input: Record<string, unknown>): {
  kind: 'value' | 'values' | 'formula' | 'formulas';
  payload: unknown;
} {
  const keys = (['value', 'values', 'formula', 'formulas'] as const).filter(
    (k) => input[k] !== undefined,
  );
  if (keys.length !== 1) {
    throw new Error(XOR_ERROR);
  }
  return { kind: keys[0]!, payload: input[keys[0]!] };
}

function assertValuesShape(values: unknown, parsed: ParsedA1, label: 'values' | 'formulas'): void {
  const rows = parsed.endRow - parsed.startRow + 1;
  const cols = parsed.endCol - parsed.startCol + 1;
  if (!Array.isArray(values) || values.length !== rows) {
    throw new Error(label === 'values' ? VALUES_SHAPE : VALUES_SHAPE);
  }
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new Error(VALUES_SHAPE);
    }
  }
}

function formulaCell(formula: unknown): { f: string; v: null; p: null } {
  if (typeof formula !== 'string') {
    throw new Error(INVALID_A1);
  }
  return { f: formula, v: null, p: null };
}

function isCellValue(v: unknown): v is CellValue | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function toCellValue(v: unknown): CellValue | null {
  if (isCellValue(v)) return v;
  if (v === undefined) return null;
  if (typeof v === 'object') return null;
  return String(v);
}

type HeadlessApi = {
  univerAPI: {
    createWorkbook: (snapshot: UniverWorkbookSnapshot) => HeadlessWorkbook;
    getFormula: () => {
      onCalculationResultApplied: (timeout?: number) => Promise<void>;
      executeCalculation: () => void;
    };
  };
  workbook: HeadlessWorkbook;
};

type HeadlessWorkbook = {
  save: () => UniverWorkbookSnapshot;
  getSheetByName: (name: string) => HeadlessSheet | null;
  getActiveSheet: () => HeadlessSheet;
};

type HeadlessSheet = {
  getSheetName: () => string;
  getRange: (a1: string) => HeadlessRange;
};

type HeadlessRange = {
  getValue: () => unknown;
  getValues: () => unknown[][];
  getFormula: () => string;
  setValue: (value: unknown) => unknown;
  setValues: (values: unknown) => unknown;
};

export async function withHeadlessWorkbook<T>(
  snapshot: UniverWorkbookSnapshot,
  fn: (api: HeadlessApi) => Promise<T>,
): Promise<T> {
  const { univer, univerAPI } = createUniver({
    locale: snapshot.locale === 'koKR' ? LocaleType.KO_KR : LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsNodeCoreEnUS),
      [LocaleType.KO_KR]: mergeLocales(UniverPresetSheetsNodeCoreKoKR),
    },
    presets: [UniverSheetsNodeCorePreset()],
  });
  try {
    const workbook = univerAPI.createWorkbook(
      snapshot as never,
    ) as unknown as HeadlessWorkbook;
    return await fn({
      univerAPI: univerAPI as unknown as HeadlessApi['univerAPI'],
      workbook,
    });
  } finally {
    univer.dispose();
  }
}

async function readSnapshotFile(
  workspaceRoot: string,
  userPath: string,
  opts: { forWrite: boolean },
): Promise<{ abs: string; rel: string; snapshot: UniverWorkbookSnapshot; displayPath: string }> {
  const displayPath = typeof userPath === 'string' ? userPath.trim() || userPath : String(userPath ?? '');
  const abs = safePath(workspaceRoot, typeof userPath === 'string' ? userPath : String(userPath ?? ''));
  const relFromRoot = relative(realpathSync(resolve(workspaceRoot)), abs);

  if (opts.forWrite && isProtectedPath(relFromRoot.replace(/\\/g, '/'))) {
    throw new Error(`Cannot write to protected path: ${displayPath}`);
  }
  if (!isUniverWorkbookPath(displayPath) && !isUniverWorkbookPath(relFromRoot)) {
    throw new Error(NOT_WORKBOOK_PATH);
  }

  let size: number | undefined;
  try {
    size = (await stat(abs)).size;
  } catch {
    throw new Error(`File not found: ${displayPath}`);
  }
  if (typeof size === 'number' && size > UNIVER_SNAPSHOT_MAX_CHARS) {
    throw new Error(`file exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`);
  }

  const content = await readFile(abs, 'utf8');
  if (content.length > UNIVER_SNAPSHOT_MAX_CHARS) {
    throw new Error(`file exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`);
  }

  try {
    const snapshot = parseWorkbookSnapshot(content);
    return { abs, rel: relFromRoot, snapshot, displayPath };
  } catch (err) {
    if (err instanceof UniverSnapshotError) {
      throw new Error(`${err.code}: ${err.message}`);
    }
    throw err;
  }
}

function resolveSheet(
  workbook: HeadlessWorkbook,
  parsed: ParsedA1,
  sheetArg: string | undefined,
): HeadlessSheet {
  if (parsed.sheetFromA1 && sheetArg) {
    throw new Error(SHEET_BOTH_ERROR);
  }
  const name = sheetArg ?? parsed.sheetFromA1;
  if (name) {
    const sheet = workbook.getSheetByName(name);
    if (!sheet) throw new Error(SHEET_NOT_FOUND);
    return sheet;
  }
  return workbook.getActiveSheet();
}

function rangeOutput(opts: {
  path: string;
  sheet: string;
  a1: string;
  parsed: ParsedA1;
  range: HeadlessRange;
}): Record<string, unknown> {
  const area = boundingArea(opts.parsed);
  const value = toCellValue(opts.range.getValue());
  const formula = opts.range.getFormula?.() || undefined;
  const body: Record<string, unknown> = {
    path: opts.path,
    sheet: opts.sheet,
    a1: opts.a1,
    value,
  };
  if (area > 1) {
    const values = opts.range.getValues().map((row) => row.map((cell) => toCellValue(cell)));
    body.values = values;
  }
  if (formula) body.formula = formula;
  return body;
}

async function runOnWorkbook<T>(
  snapshot: UniverWorkbookSnapshot,
  parsed: ParsedA1,
  sheetArg: string | undefined,
  mode: 'get' | 'eval' | 'set',
  mutate?: (range: HeadlessRange) => void,
): Promise<{ output: Record<string, unknown>; saved?: UniverWorkbookSnapshot }> {
  if (boundingArea(parsed) > RANGE_CELL_LIMIT) {
    throw new Error(`range exceeds max size (${RANGE_CELL_LIMIT} cells)`);
  }
  return withHeadlessWorkbook(snapshot, async ({ univerAPI, workbook }) => {
    const sheet = resolveSheet(workbook, parsed, sheetArg);
    let range: HeadlessRange;
    try {
      range = sheet.getRange(parsed.a1);
    } catch {
      throw new Error(INVALID_A1);
    }
    const formulaApi = univerAPI.getFormula();
    if (mode === 'set' && mutate) {
      const wait = formulaApi.onCalculationResultApplied(FORMULA_WAIT_MS);
      mutate(range);
      try {
        await wait;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(msg.includes('timeout') ? 'Calculation end timeout' : msg);
      }
    } else if (mode === 'eval') {
      const wait = formulaApi.onCalculationResultApplied(FORMULA_WAIT_MS);
      formulaApi.executeCalculation();
      try {
        await wait;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(msg.includes('timeout') ? 'Calculation end timeout' : msg);
      }
    } else {
      try {
        await formulaApi.onCalculationResultApplied(FORMULA_WAIT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(msg.includes('timeout') ? 'Calculation end timeout' : msg);
      }
    }
    const output = rangeOutput({
      path: '',
      sheet: sheet.getSheetName(),
      a1: parsed.a1,
      parsed,
      range,
    });
    const saved = mode === 'set' ? workbook.save() : undefined;
    return { output, saved };
  });
}

function applyWrite(range: HeadlessRange, kind: string, payload: unknown, parsed: ParsedA1): void {
  if (kind === 'value') {
    range.setValue(payload);
    return;
  }
  if (kind === 'formula') {
    range.setValue(formulaCell(payload));
    return;
  }
  if (kind === 'values') {
    assertValuesShape(payload, parsed, 'values');
    range.setValues(payload);
    return;
  }
  assertValuesShape(payload, parsed, 'formulas');
  const formulas = payload as unknown[][];
  range.setValues(formulas.map((row) => row.map((f) => formulaCell(f))));
}

async function executeGetOrEval(
  workspaceRoot: string,
  input: Record<string, unknown>,
  mode: 'get' | 'eval',
): Promise<ToolResult> {
  try {
    const parsed = parseA1(input.a1);
    const sheetArg = asOptionalSheet(input.sheet);
    if (parsed.sheetFromA1 && sheetArg) return fail(SHEET_BOTH_ERROR);
    if (boundingArea(parsed) > RANGE_CELL_LIMIT) {
      return fail(`range exceeds max size (${RANGE_CELL_LIMIT} cells)`);
    }
    const file = await readSnapshotFile(workspaceRoot, String(input.path ?? ''), { forWrite: false });
    const { output } = await runOnWorkbook(file.snapshot, parsed, sheetArg, mode);
    output.path = file.displayPath;
    return ok(output);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

async function executeSet(
  workspaceRoot: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const write = xorWriteFields(input);
    const parsed = parseA1(input.a1);
    const sheetArg = asOptionalSheet(input.sheet);
    if (parsed.sheetFromA1 && sheetArg) return fail(SHEET_BOTH_ERROR);
    if (boundingArea(parsed) > RANGE_CELL_LIMIT) {
      return fail(`range exceeds max size (${RANGE_CELL_LIMIT} cells)`);
    }
    if (write.kind === 'values') assertValuesShape(write.payload, parsed, 'values');
    if (write.kind === 'formulas') assertValuesShape(write.payload, parsed, 'formulas');
    if (typeof write.payload === 'string' && write.payload.length > UNIVER_SNAPSHOT_MAX_CHARS) {
      return fail(`content exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`);
    }

    const file = await readSnapshotFile(workspaceRoot, String(input.path ?? ''), { forWrite: true });
    const { output, saved } = await runOnWorkbook(
      file.snapshot,
      parsed,
      sheetArg,
      'set',
      (range) => applyWrite(range, write.kind, write.payload, parsed),
    );
    if (!saved) return fail('Failed to save workbook');
    const serialized = serializeWorkbookSnapshot(saved);
    if (serialized.length > UNIVER_SNAPSHOT_MAX_CHARS) {
      return fail(`content exceeds max size (${UNIVER_SNAPSHOT_MAX_CHARS} characters)`);
    }
    await writeFile(file.abs, serialized, 'utf8');
    output.path = file.displayPath;
    return ok(output);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const GET_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative .univer.json path' },
    a1: { type: 'string', description: 'A1 range, e.g. A1 or A1:B2' },
    sheet: { type: 'string', description: 'Sheet name. Default: active/first sheet' },
  },
  required: ['path', 'a1'],
};

const SET_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    a1: { type: 'string', description: 'A1 without sheet qualifier, e.g. A1 or A1:B2' },
    sheet: { type: 'string' },
    value: { description: 'Scalar CellValue for a single cell' },
    values: { description: '2D CellValue[][] matching A1 bounding box' },
    formula: { type: 'string', description: 'Single-cell formula, e.g. =1+1' },
    formulas: { description: '2D string[][] matching A1 bounding box' },
  },
  required: ['path', 'a1'],
};

const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    a1: { type: 'string' },
    sheet: { type: 'string' },
  },
  required: ['path', 'a1'],
};

export function createSheetsTools(workspaceRoot: string): Tool[] {
  return [
    {
      name: 'sheets_get_range',
      description:
        'Read cell values from a .univer.json workbook (A1 notation). Waits for formula results.',
      inputSchema: GET_SCHEMA,
      execute: (input) => executeGetOrEval(workspaceRoot, input, 'get'),
    },
    {
      name: 'sheets_set_range',
      description: 'Write values or formulas into a .univer.json workbook and save the snapshot.',
      inputSchema: SET_SCHEMA,
      execute: (input) => executeSet(workspaceRoot, input),
    },
    {
      name: 'sheets_eval',
      description: 'Wait for formula calculation on a range and return computed values.',
      inputSchema: EVAL_SCHEMA,
      execute: (input) => executeGetOrEval(workspaceRoot, input, 'eval'),
    },
  ];
}
