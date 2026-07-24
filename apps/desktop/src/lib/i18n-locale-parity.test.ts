import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localesRoot = path.resolve(here, '../../../../packages/ui/src/i18n/locales');

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return prefix ? [prefix] : [];
}

describe('UI i18n locale parity (en/ko)', () => {
  const namespaces = readdirSync(path.join(localesRoot, 'en')).filter((f) => f.endsWith('.json'));

  it('has matching namespace files for en and ko', () => {
    const en = new Set(namespaces);
    const ko = new Set(readdirSync(path.join(localesRoot, 'ko')).filter((f) => f.endsWith('.json')));
    expect([...en].sort()).toEqual([...ko].sort());
  });

  it.each(namespaces)('%s keys match between en and ko', (file) => {
    const en = JSON.parse(readFileSync(path.join(localesRoot, 'en', file), 'utf8'));
    const ko = JSON.parse(readFileSync(path.join(localesRoot, 'ko', file), 'utf8'));
    expect(leafKeys(en).sort()).toEqual(leafKeys(ko).sort());
  });

  it('common and settings namespaces are non-empty', () => {
    for (const ns of ['common.json', 'settings.json', 'chat.json', 'skills.json']) {
      const en = JSON.parse(readFileSync(path.join(localesRoot, 'en', ns), 'utf8'));
      expect(leafKeys(en).length).toBeGreaterThan(0);
    }
  });
});
