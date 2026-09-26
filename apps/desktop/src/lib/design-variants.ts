/** Variant filename + prompt helpers for design-project HTML seeds (PLAN §7 / K15). */

export const VARIANT_SEED_MAX_CHARS = 64 * 1024;

const STEM_UNSAFE = /[^a-zA-Z0-9._-]/g;
const VARIANT_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function isHtmlContentType(contentType?: string | null): boolean {
  if (contentType == null || contentType.trim() === '') return false;
  const lower = contentType.toLowerCase();
  return lower.includes('html');
}

export function variantStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const withoutExt = base.replace(/\.html?$/i, '');
  const cleaned = withoutExt.replace(STEM_UNSAFE, '');
  return cleaned || 'seed';
}

export function allocateVariantPaths(opts: {
  stem: string;
  count: number;
  existingPaths: readonly string[];
}): string[] {
  const existing = new Set(opts.existingPaths);
  const n = Math.max(0, Math.min(Math.floor(opts.count), VARIANT_LETTERS.length));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const letter = VARIANT_LETTERS[i]!;
    const primary = `${opts.stem}.variant-${letter}.html`;
    if (!existing.has(primary)) {
      existing.add(primary);
      out.push(primary);
      continue;
    }
    let k = 2;
    let candidate = `${opts.stem}.variant-${letter}-${k}.html`;
    while (existing.has(candidate)) {
      k += 1;
      candidate = `${opts.stem}.variant-${letter}-${k}.html`;
    }
    existing.add(candidate);
    out.push(candidate);
  }
  return out;
}

export function buildVariantTaskSuffix(opts: {
  paths: readonly string[];
  seedHtml: string;
}): { suffix: string; truncated: boolean } {
  const truncated = opts.seedHtml.length > VARIANT_SEED_MAX_CHARS;
  const body = truncated ? opts.seedHtml.slice(0, VARIANT_SEED_MAX_CHARS) : opts.seedHtml;
  const lines = [
    '## Variant task',
    `Using the seed HTML below, write ${opts.paths.length} clickable HTML variants as NEW files with these exact paths:`,
    ...opts.paths.map((p) => `- ${p}`),
    'Do not modify the seed file. Do not use replace-file. Do not overwrite any other existing file.',
    'Each variant must be self-contained HTML (hover, focus, scroll, transitions) and must use CSS custom properties from the injected tokens.css — no new brand hex/rgb.',
    '',
    '### Seed HTML',
    '```html',
    body,
    '```',
  ];
  if (truncated) lines.push('…[seed truncated]');
  return { suffix: lines.join('\n'), truncated };
}
