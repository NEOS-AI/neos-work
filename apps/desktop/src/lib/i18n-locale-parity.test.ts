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

  it('skills.json includes required catalog/delete keys in en and ko', () => {
    const required = [
      'licenseUnknown',
      'thirdPartyDisclaimer',
      'installConfirm',
      'deleteRemoteFilesConfirm',
      'deleteRegistryConfirm',
      'shadowedBundled',
      'catalogDisabled',
      'skillAmbiguous',
    ];
    for (const locale of ['en', 'ko']) {
      const json = JSON.parse(
        readFileSync(path.join(localesRoot, locale, 'skills.json'), 'utf8'),
      ) as Record<string, unknown>;
      for (const key of required) {
        expect(typeof json[key]).toBe('string');
        expect(String(json[key]).trim().length).toBeGreaterThan(0);
      }
    }
    const ko = JSON.parse(readFileSync(path.join(localesRoot, 'ko', 'skills.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(ko.installConfirm).not.toMatch(/Install this third-party/i);
    expect(ko.deleteRemoteFilesConfirm).not.toMatch(/Delete this remote skill/i);
  });

  const RULES_PLACEHOLDER = `# Agent rules

This file is the behavioral half of the design harness.
Visual tokens live in DESIGN.md and tokens.css. Do not duplicate palettes here.

## Tools
- Prefer editing the open project HTML/CSS. Do not start from an empty document when a seed file exists.
- Use Design Editor selection / preview comments when present.
- Produce self-contained, clickable HTML (hover, focus, scroll, transitions). Not a screenshot mock.

## Never
- Do not invent a new color palette or font stack when tokens.css defines one.
- Do not use raw hex/rgb for brand colors; use CSS custom properties from tokens.css.
- Do not ship inaccessible contrast or missing focus rings.
- Do not overwrite unrelated manual edits (prefer a minimal patch).

## Preferred workflow
- Start from the seed (current file, components.html, or a starter), generate a few variants as sibling files, then narrow to one.
- After a human correction, wait for an explicit promote; do not rewrite RULES.md yourself unless asked.

## Corrections
<!-- dated bullets, pruned when stale. format: - YYYY-MM-DD: text -->`;

  function atPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (!acc || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }

  it('common.json includes PR 3 designSystems keys in en and ko', () => {
    const required = [
      'designSystems.subtitle',
      'designSystems.hint',
      'designSystems.viewHint',
      'designSystems.tab.design',
      'designSystems.tab.rules',
      'designSystems.tab.tokens',
      'designSystems.rulesBadge',
      'designSystems.rulesHint',
      'designSystems.notWorkerHarness',
      'designSystems.rulesPlaceholder',
      'designSystems.tokensSaveFailed',
      'designSystems.rulesSaveFailed',
      'project.contextHint',
    ];
    const locales: Record<'en' | 'ko', Record<string, unknown>> = {
      en: JSON.parse(readFileSync(path.join(localesRoot, 'en', 'common.json'), 'utf8')),
      ko: JSON.parse(readFileSync(path.join(localesRoot, 'ko', 'common.json'), 'utf8')),
    };
    for (const locale of ['en', 'ko'] as const) {
      const json = locales[locale];
      for (const key of required) {
        const value = atPath(json, key);
        expect(typeof value).toBe('string');
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
      expect(atPath(json, 'designSystems.tab.design')).toBe('DESIGN.md');
      expect(atPath(json, 'designSystems.tab.rules')).toBe('RULES.md');
      expect(atPath(json, 'designSystems.tab.tokens')).toBe('tokens.css');
      expect(atPath(json, 'designSystems.rulesBadge')).toBe('rules');
      expect(String(atPath(json, 'designSystems.rulesSaveFailed'))).toContain('{{detail}}');
      expect(String(atPath(json, 'designSystems.tokensSaveFailed'))).toContain('{{detail}}');
      expect(String(atPath(json, 'designSystems.rulesPlaceholder')).trim()).toBe(
        RULES_PLACEHOLDER.trim(),
      );
    }

    const enSub = String(atPath(locales.en, 'designSystems.subtitle'));
    expect(enSub).toContain('RULES.md');
    expect(enSub).toContain('tokens.css');
    const koSub = String(atPath(locales.ko, 'designSystems.subtitle'));
    expect(koSub).toContain('디자인 하네스');
    expect(koSub).toContain('RULES.md');

    const enNotWorker = String(atPath(locales.en, 'designSystems.notWorkerHarness'));
    expect(enNotWorker).toContain('legacy /harnesses');
    const koNotWorker = String(atPath(locales.ko, 'designSystems.notWorkerHarness'));
    expect(koNotWorker).toContain('워커');
    expect(koNotWorker).toContain('/harnesses');
    expect(koNotWorker).toContain('디자인 하네스');
    expect(enNotWorker.trim().toLowerCase()).not.toBe('harness');
    expect(koNotWorker.trim()).not.toBe('하네스');
  });

  it('common.json includes PR 4 promote/prune keys in en and ko', () => {
    const required = [
      'designSystems.promote',
      'designSystems.promoteConfirm',
      'designSystems.prune',
      'designSystems.pruneConfirm',
    ];
    const expected: Record<string, { en: string; ko: string }> = {
      'designSystems.promote': {
        ko: 'RULES.md에 승격',
        en: 'Promote to RULES.md',
      },
      'designSystems.promoteConfirm': {
        ko: '이 교정 사항을 RULES.md Corrections에 추가할까요?',
        en: 'Add this correction to RULES.md?',
      },
      'designSystems.prune': {
        ko: '오래된 교정 정리',
        en: 'Prune stale corrections',
      },
      'designSystems.pruneConfirm': {
        ko: '90일이 지난 교정을 지우고, 그래도 20개를 넘으면 가장 오래된 것부터 삭제할까요?',
        en: 'Delete Corrections older than 90 days, then drop down to 20?',
      },
    };
    const locales: Record<'en' | 'ko', Record<string, unknown>> = {
      en: JSON.parse(readFileSync(path.join(localesRoot, 'en', 'common.json'), 'utf8')),
      ko: JSON.parse(readFileSync(path.join(localesRoot, 'ko', 'common.json'), 'utf8')),
    };
    for (const locale of ['en', 'ko'] as const) {
      const json = locales[locale];
      for (const key of required) {
        const value = atPath(json, key);
        expect(typeof value).toBe('string');
        expect(String(value).trim().length).toBeGreaterThan(0);
        expect(String(value)).toBe(expected[key][locale]);
      }
      expect(atPath(json, 'designSystems.promoteFailed')).toBeUndefined();
      expect(atPath(json, 'designSystems.pruneFailed')).toBeUndefined();
      expect(atPath(json, 'project.promoteDesktopOnly')).toBeUndefined();
    }

    const koPrune = String(atPath(locales.ko, 'designSystems.pruneConfirm'));
    expect(koPrune).toContain('90일');
    expect(koPrune).toContain('20개');
    expect(koPrune).toContain('그래도');
    expect(koPrune).not.toMatch(/\bAND\b/i);
    expect(koPrune).not.toMatch(/지우고\s*그리고/);

    const enPrune = String(atPath(locales.en, 'designSystems.pruneConfirm'));
    expect(enPrune).toContain('90 days');
    expect(enPrune).toContain('then');
    expect(enPrune).toContain('20');

    for (const locale of ['en', 'ko'] as const) {
      for (const key of required) {
        const value = String(atPath(locales[locale], key)).trim();
        expect(value.toLowerCase()).not.toBe('harness');
        expect(value).not.toBe('하네스');
      }
    }
  });

  it('common.harness has no new keys', () => {
    const frozen = [
      'title',
      'new',
      'empty',
      'confirmDelete',
      'name',
      'domain',
      'description',
      'systemPrompt',
      'allowedTools',
      'allowedToolsHint',
      'permissionProfile',
      'defaultMode',
      'workspace',
      'createTitle',
      'editTitle',
      'viewTitle',
      'validationError',
    ].sort();
    for (const locale of ['en', 'ko']) {
      const json = JSON.parse(
        readFileSync(path.join(localesRoot, locale, 'common.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(leafKeys(json.harness).sort()).toEqual(frozen);
      const dsLeaves = leafKeys(json.designSystems);
      expect(dsLeaves).not.toContain('nav.harnesses');
    }
  });
});
