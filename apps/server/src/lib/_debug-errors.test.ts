import { describe, expect, it, vi } from 'vitest';
import { safeError } from './errors.js';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

describe('debug', () => {
  it('shows what safeError does', () => {
    const srcPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'errors.ts');
    const src = fs.readFileSync(srcPath, 'utf8');
    console.log('SRC HAS hasLogUnsafeChars', src.includes('hasLogUnsafeChars'));
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      // keep mock
      void a;
    });
    // Also call real console via original for debug before mock? already mocked.
    const r = safeError(new Error('line1\nline2'), 'bad\nctx');
    console.log('CALL0', JSON.stringify(spy.mock.calls[0]));
    console.log('result', r);
    // Check function source
    console.log('fn', safeError.toString().slice(0, 500));
    expect(String(spy.mock.calls[0]?.[0])).toContain('[app]');
  });
});
