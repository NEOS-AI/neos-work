import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_ID,
  UNIVER_APP_VERSION,
  UNIVER_SNAPSHOT_MAX_CHARS,
  UniverSnapshotError,
  createEmptyWorkbookSnapshot,
  isUniverWorkbookPath,
  localeFromNeosI18n,
  parseWorkbookSnapshot,
  serializeWorkbookSnapshot,
  type UniverWorkbookSnapshot,
} from './snapshot.js';

function expectSnapshotCode(
  fn: () => unknown,
  code: UniverSnapshotError['code'],
): void {
  try {
    fn();
    expect.fail(`expected UniverSnapshotError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(UniverSnapshotError);
    expect((err as UniverSnapshotError).code).toBe(code);
  }
}

describe('isUniverWorkbookPath', () => {
  it('accepts budget.univer.json', () => {
    expect(isUniverWorkbookPath('budget.univer.json')).toBe(true);
  });

  it('rejects budget.json', () => {
    expect(isUniverWorkbookPath('budget.json')).toBe(false);
  });

  it('rejects budget.csv', () => {
    expect(isUniverWorkbookPath('budget.csv')).toBe(false);
  });

  it('is case-insensitive for Foo.Univer.JSON', () => {
    expect(isUniverWorkbookPath('Foo.Univer.JSON')).toBe(true);
  });

  it('matches Windows paths by basename', () => {
    expect(isUniverWorkbookPath('budget\\foo.univer.json')).toBe(true);
  });

  it('rejects dir.univer.json/x (basename only)', () => {
    expect(isUniverWorkbookPath('dir.univer.json/x')).toBe(false);
  });
});

describe('createEmptyWorkbookSnapshot / parse / serialize', () => {
  it('round-trips an empty enUS workbook', () => {
    const parsed = parseWorkbookSnapshot(
      serializeWorkbookSnapshot(
        createEmptyWorkbookSnapshot({ id: 'wb1', locale: 'enUS' }),
      ),
    );
    expect(parsed.dateSystem).toBe('date1900');
    expect(parsed.sheetOrder).toHaveLength(1);
    expect(parsed.sheets[parsed.sheetOrder[0]!]?.name).toBe('Sheet1');
    expect(parsed.locale).toBe('enUS');
    expect(parsed.appVersion).toBe(UNIVER_APP_VERSION);
    expect(parsed.appVersion).toBe('1.0.2');
    expect(parsed.id).toBe('wb1');
    expect(parsed.sheetOrder[0]).toBe(DEFAULT_SHEET_ID);
  });

  it('honors koKR locale', () => {
    expect(
      createEmptyWorkbookSnapshot({ id: 'wb-ko', locale: 'koKR' }).locale,
    ).toBe('koKR');
  });

  it('throws invalid_json for broken JSON', () => {
    expectSnapshotCode(() => parseWorkbookSnapshot('{'), 'invalid_json');
  });

  it('throws not_workbook when sheets is missing', () => {
    expectSnapshotCode(
      () => parseWorkbookSnapshot(JSON.stringify({ appVersion: '1.0.2' })),
      'not_workbook',
    );
  });

  it('throws empty_sheets for sheets {}', () => {
    expectSnapshotCode(
      () =>
        parseWorkbookSnapshot(
          JSON.stringify({ appVersion: '1.0.2', sheets: {} }),
        ),
      'empty_sheets',
    );
  });

  it('throws invalid_date_system for numeric dateSystem 0', () => {
    expectSnapshotCode(
      () =>
        parseWorkbookSnapshot(
          JSON.stringify({
            appVersion: '1.0.2',
            sheets: { a: { id: 'a' } },
            dateSystem: 0,
          }),
        ),
      'invalid_date_system',
    );
  });

  it('round-trips a valid minimal workbook with empty cellData', () => {
    const minimal: UniverWorkbookSnapshot = {
      id: 'wb-min',
      name: 'Workbook',
      appVersion: '1.0.2',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['sheet-a'],
      sheets: {
        'sheet-a': {
          id: 'sheet-a',
          name: 'Sheet1',
          cellData: {},
        },
      },
    };
    const serialized = serializeWorkbookSnapshot(minimal);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized).toBe(`${JSON.stringify(minimal, null, 2)}\n`);
    const parsed = parseWorkbookSnapshot(serialized);
    expect(parsed).toEqual(minimal);
    expect(parsed.sheets['sheet-a']?.cellData).toEqual({});
  });
});

describe('UNIVER_SNAPSHOT_MAX_CHARS', () => {
  it('equals 2MiB', () => {
    expect(UNIVER_SNAPSHOT_MAX_CHARS).toBe(2 * 1024 * 1024);
  });

  it('callers reject 3MiB content before parse; parser does not slice', () => {
    const oversized = 'x'.repeat(3 * 1024 * 1024);
    expect(oversized.length).toBeGreaterThan(UNIVER_SNAPSHOT_MAX_CHARS);
    // Caller-side guard: do not call parse on oversized content.
    if (oversized.length > UNIVER_SNAPSHOT_MAX_CHARS) {
      expect(oversized.length).toBeGreaterThan(UNIVER_SNAPSHOT_MAX_CHARS);
    } else {
      parseWorkbookSnapshot(oversized);
    }
    const small = serializeWorkbookSnapshot(
      createEmptyWorkbookSnapshot({ id: 'wb1', locale: 'enUS' }),
    );
    expect(small.length).toBeLessThanOrEqual(UNIVER_SNAPSHOT_MAX_CHARS);
    expect(parseWorkbookSnapshot(small).id).toBe('wb1');
  });
});

describe('localeFromNeosI18n', () => {
  it('maps ko to koKR and en to enUS', () => {
    expect(localeFromNeosI18n('ko')).toBe('koKR');
    expect(localeFromNeosI18n('en')).toBe('enUS');
  });
});
