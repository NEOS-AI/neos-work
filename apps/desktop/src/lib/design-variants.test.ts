import { describe, expect, it } from 'vitest';
import {
  VARIANT_SEED_MAX_CHARS,
  allocateVariantPaths,
  buildVariantTaskSuffix,
  isHtmlContentType,
  isHtmlPath,
  variantStem,
} from './design-variants.js';

describe('design-variants', () => {
  it('variantStem keeps [A-Za-z0-9._-] and falls back to seed', () => {
    expect(variantStem('index.html')).toBe('index');
    expect(variantStem('Index.HTML')).toBe('Index');
    expect(variantStem('hero-v2.htm')).toBe('hero-v2');
    expect(variantStem('My Hero!.html')).toBe('MyHero');
    expect(variantStem('!!!.html')).toBe('seed');
    expect(variantStem('components.html')).toBe('components');
    expect(variantStem('pages/hero.html')).toBe('hero');
  });

  it('allocateVariantPaths writes {stem}.variant-a.html … and collides with -2', () => {
    expect(allocateVariantPaths({ stem: 'index', count: 3, existingPaths: [] })).toEqual([
      'index.variant-a.html',
      'index.variant-b.html',
      'index.variant-c.html',
    ]);

    expect(
      allocateVariantPaths({
        stem: 'index',
        count: 3,
        existingPaths: ['index.html', 'index.variant-a.html', 'about.html'],
      }),
    ).toEqual([
      'index.variant-a-2.html',
      'index.variant-b.html',
      'index.variant-c.html',
    ]);

    expect(
      allocateVariantPaths({
        stem: 'index',
        count: 2,
        existingPaths: ['index.variant-a.html', 'index.variant-a-2.html'],
      }),
    ).toEqual(['index.variant-a-3.html', 'index.variant-b.html']);

    expect(allocateVariantPaths({ stem: 'seed', count: 4, existingPaths: [] })).toEqual([
      'seed.variant-a.html',
      'seed.variant-b.html',
      'seed.variant-c.html',
      'seed.variant-d.html',
    ]);

    expect(
      allocateVariantPaths({
        stem: 'index',
        count: 3,
        existingPaths: ['index.variant-b.html'],
      }),
    ).toEqual([
      'index.variant-a.html',
      'index.variant-b-2.html',
      'index.variant-c.html',
    ]);

    expect(
      allocateVariantPaths({
        stem: 'hero',
        count: 2,
        existingPaths: ['pages/hero.html', 'pages'],
      }),
    ).toEqual(['hero.variant-a.html', 'hero.variant-b.html']);
  });

  it('buildVariantTaskSuffix is the English fixture and lists final paths', () => {
    const { suffix, truncated } = buildVariantTaskSuffix({
      paths: ['index.variant-a.html', 'index.variant-b.html', 'index.variant-c.html'],
      seedHtml: '<html>hi</html>',
    });
    expect(truncated).toBe(false);
    expect(suffix).toBe(
      [
        '## Variant task',
        'Using the seed HTML below, write 3 clickable HTML variants as NEW files with these exact paths:',
        '- index.variant-a.html',
        '- index.variant-b.html',
        '- index.variant-c.html',
        'Do not modify the seed file. Do not use replace-file. Do not overwrite any other existing file.',
        'Each variant must be self-contained HTML (hover, focus, scroll, transitions) and must use CSS custom properties from the injected tokens.css — no new brand hex/rgb.',
        '',
        '### Seed HTML',
        '```html',
        '<html>hi</html>',
        '```',
      ].join('\n'),
    );
    expect(suffix).toContain('write 3 clickable');
    expect(suffix).toContain('Do not use replace-file');
    expect(suffix).not.toMatch(/(?<!Do not use )replace-file/);
  });

  it('seed longer than 64 KiB is sliced and tagged', () => {
    expect(VARIANT_SEED_MAX_CHARS).toBe(64 * 1024);
    const seed = 'A'.repeat(64 * 1024 + 50);
    const { suffix, truncated } = buildVariantTaskSuffix({
      paths: ['index.variant-a.html'],
      seedHtml: seed,
    });
    expect(truncated).toBe(true);

    const fenceStart = suffix.indexOf('```html\n');
    expect(fenceStart).toBeGreaterThanOrEqual(0);
    const fenceEnd = suffix.indexOf('\n```', fenceStart);
    expect(fenceEnd).toBeGreaterThan(fenceStart);
    const fenceBody = suffix.slice(fenceStart + '```html\n'.length, fenceEnd);
    expect(fenceBody.length).toBe(64 * 1024);
    expect(fenceBody).not.toContain('…[seed truncated]');
    expect(suffix.slice(fenceEnd + '\n```'.length)).toMatch(/^\n…\[seed truncated\]$/);
  });

  it('isHtmlPath / isHtmlContentType detect HTML seeds', () => {
    expect(isHtmlPath('index.html')).toBe(true);
    expect(isHtmlPath('page.HTM')).toBe(true);
    expect(isHtmlPath('x.Html')).toBe(true);
    expect(isHtmlPath('styles.css')).toBe(false);
    expect(isHtmlPath('notes.md')).toBe(false);
    expect(isHtmlPath('file.html.bak')).toBe(false);

    expect(isHtmlContentType('text/html')).toBe(true);
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('text/plain')).toBe(false);
    expect(isHtmlContentType('image/png')).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
    expect(isHtmlContentType('')).toBe(false);
    expect(isHtmlContentType('   ')).toBe(false);
  });
});
