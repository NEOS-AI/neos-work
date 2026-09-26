export const UNIVER_SNAPSHOT_MAX_CHARS = 2 * 1024 * 1024; // === PROJECT_FILE_MAX_CHARS
export const UNIVER_APP_VERSION = '1.0.2';
export const DEFAULT_SHEET_ID = 'sheet-01';

export type UniverLocale = 'enUS' | 'koKR';
export type UniverDateSystem = 'date1900' | 'date1904';
export type UniverSnapshotErrorCode =
  | 'invalid_json'
  | 'not_workbook'
  | 'empty_sheets'
  | 'invalid_date_system';

/** Local mirror of Univer IWorkbookData. Do not import @univerjs. */
export interface UniverWorksheetSnapshot {
  id?: string;
  name?: string;
  tabColor?: string;
  hidden?: number;
  rowCount?: number;
  columnCount?: number;
  zoomRatio?: number;
  freeze?: {
    xSplit: number;
    ySplit: number;
    startRow: number;
    startColumn: number;
  };
  scrollTop?: number;
  scrollLeft?: number;
  defaultColumnWidth?: number;
  defaultRowHeight?: number;
  mergeData?: unknown[];
  cellData?: Record<string, unknown>;
  rowData?: Record<string, unknown>;
  columnData?: Record<string, unknown>;
  showGridlines?: number;
  rightToLeft?: number;
  rowHeader?: { width: number; hidden?: number };
  columnHeader?: { height: number; hidden?: number };
  [key: string]: unknown;
}

export interface UniverWorkbookSnapshot {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  dateSystem?: UniverDateSystem;
  styles: Record<string, unknown>;
  sheetOrder: string[];
  sheets: { [sheetId: string]: UniverWorksheetSnapshot };
  resources?: Array<{ id?: string; name: string; data: string }>;
  rev?: number;
  defaultStyle?: unknown;
  custom?: unknown;
}

export function isUniverWorkbookPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, '/').toLowerCase();
  const base = p.split('/').pop() ?? p;
  return base.endsWith('.univer.json');
}

export class UniverSnapshotError extends Error {
  readonly code: UniverSnapshotErrorCode;

  constructor(code: UniverSnapshotErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'UniverSnapshotError';
    this.code = code;
  }
}

export function parseWorkbookSnapshot(text: string): UniverWorkbookSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UniverSnapshotError('invalid_json');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UniverSnapshotError('not_workbook');
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.appVersion !== 'string') {
    throw new UniverSnapshotError('not_workbook');
  }
  if (
    obj.sheets === null ||
    typeof obj.sheets !== 'object' ||
    Array.isArray(obj.sheets)
  ) {
    throw new UniverSnapshotError('not_workbook');
  }

  const sheets = obj.sheets as Record<string, unknown>;
  if (Object.keys(sheets).length === 0) {
    throw new UniverSnapshotError('empty_sheets');
  }

  if (
    obj.dateSystem !== undefined &&
    obj.dateSystem !== 'date1900' &&
    obj.dateSystem !== 'date1904'
  ) {
    throw new UniverSnapshotError('invalid_date_system');
  }

  return obj as unknown as UniverWorkbookSnapshot;
}

export function serializeWorkbookSnapshot(data: UniverWorkbookSnapshot): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function localeFromNeosI18n(lang: string | undefined): UniverLocale {
  return lang === 'ko' || lang === 'ko-KR' ? 'koKR' : 'enUS';
}

export function createEmptyWorkbookSnapshot(opts: {
  id: string;
  name?: string;
  locale: UniverLocale;
}): UniverWorkbookSnapshot {
  const sheetId = DEFAULT_SHEET_ID;
  return {
    id: opts.id,
    name: opts.name ?? 'Workbook',
    appVersion: UNIVER_APP_VERSION,
    locale: opts.locale,
    dateSystem: 'date1900',
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: 'Sheet1',
        tabColor: '',
        hidden: 0,
        rowCount: 1000,
        columnCount: 20,
        zoomRatio: 1,
        freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: 88,
        defaultRowHeight: 24,
        mergeData: [],
        cellData: {},
        rowData: {},
        columnData: {},
        showGridlines: 1,
        rightToLeft: 0,
        rowHeader: { width: 46, hidden: 0 },
        columnHeader: { height: 20, hidden: 0 },
      },
    },
    resources: [],
  };
}
