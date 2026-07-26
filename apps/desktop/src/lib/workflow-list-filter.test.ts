import { describe, expect, it } from 'vitest';
import {
  filterByEnabled,
  filterByFieldValue,
  filterByKind,
  filterBySearchText,
  filterByStatus,
  filterByTextMatch,
  filterWorkflowList,
  normalizeListDomain,
  scrubSearchHaystack,
} from './workflow-list-filter.js';

const items = [
  { name: 'Stock Bot', description: 'prices', domain: 'finance' },
  { name: 'Code Review', description: 'PR helper', domain: 'coding' },
  { name: 'Research', description: 'web search', domain: 'general' },
];

describe('filterWorkflowList', () => {
  it('returns all when no filters', () => {
    expect(filterWorkflowList(items, {})).toHaveLength(3);
  });

  it('filters by domain', () => {
    expect(filterWorkflowList(items, { domain: 'coding' }).map((w) => w.name)).toEqual(['Code Review']);
  });

  it('filters by search on name and description', () => {
    expect(filterWorkflowList(items, { search: 'price' }).map((w) => w.name)).toEqual(['Stock Bot']);
    expect(filterWorkflowList(items, { search: 'web' }).map((w) => w.name)).toEqual(['Research']);
  });

  it('combines domain and search', () => {
    expect(filterWorkflowList(items, { domain: 'finance', search: 'code' })).toEqual([]);
    expect(filterWorkflowList(items, { domain: 'coding', search: 'review' })).toHaveLength(1);
  });

  it('treats domain all as no domain filter', () => {
    expect(filterWorkflowList(items, { domain: 'all', search: 'bot' })).toHaveLength(1);
  });

  it('ignores control-char search and domain filters', () => {
    // Control-char search → no text filter (all in domain)
    expect(filterWorkflowList(items, { search: 'price\nbot' })).toHaveLength(3);
    expect(filterWorkflowList(items, { search: '\nprice' })).toHaveLength(3);
    // Control-char domain → no domain filter
    expect(filterWorkflowList(items, { domain: '\ncoding' })).toHaveLength(3);
    expect(filterBySearchText(items, '\ncode')).toHaveLength(3);
    expect(filterByStatus([{ status: 'success' }], '\nsuccess')).toHaveLength(1);
    expect(filterByKind([{ kind: 'image' }], 'image\n')).toHaveLength(1);
  });

  it('scrubs null-byte / newline name/description for search haystack', () => {
    const dirty = [
      { name: `Stock${'\0'}Bot`, description: 'prices', domain: 'finance' },
      { name: 'Clean', description: `has${'\0'}secret`, domain: 'general' },
      { name: `Line${'\n'}Break`, description: 'ok', domain: 'coding' },
      { name: 'Visible', description: 'ok', domain: 'coding' },
    ];
    // null stripped so visible letters still match (align with display scrub)
    expect(filterWorkflowList(dirty, { search: 'stock' }).map((w) => w.name)).toEqual([
      `Stock${'\0'}Bot`,
    ]);
    expect(filterWorkflowList(dirty, { search: 'secret' }).map((w) => w.name)).toEqual(['Clean']);
    // newline collapsed → "line break" matches "line"
    expect(filterWorkflowList(dirty, { search: 'line' }).map((w) => w.name)).toEqual([
      `Line${'\n'}Break`,
    ]);
    expect(filterWorkflowList(dirty, { search: 'visible' }).map((w) => w.name)).toEqual([
      'Visible',
    ]);
    // domain chip still matches clean domain
    expect(filterWorkflowList(dirty, { domain: 'coding' })).toHaveLength(2);
  });

  it('matches padded item domains via normalizeListDomain', () => {
    expect(normalizeListDomain('  coding  ')).toBe('coding');
    expect(normalizeListDomain(`coding${'\0'}`)).toBe('');
    expect(normalizeListDomain('\ncoding')).toBe('');
    expect(normalizeListDomain(null)).toBe('');
    expect(
      filterWorkflowList([{ name: 'X', domain: '  finance  ', description: '' }], {
        domain: 'finance',
      }),
    ).toHaveLength(1);
  });
});

describe('filterBySearchText', () => {
  it('filters plugins by name or description', () => {
    const items = [
      { name: 'Design Kit', description: 'atoms' },
      { name: 'Other', description: null },
    ];
    expect(filterBySearchText(items, 'atom')).toHaveLength(1);
    expect(filterBySearchText(items, 'other')).toHaveLength(1);
    expect(filterBySearchText(items, '')).toHaveLength(2);
  });

  it('scrubs null-byte name/description for search haystack', () => {
    const items = [
      { name: `bad${'\0'}name`, description: 'clean' },
      { name: 'Good', description: `d${'\0'}esc` },
      { name: 'MatchMe', description: 'ok' },
    ];
    // Null stripped → "badname" / "desc" still match
    expect(filterBySearchText(items, 'bad')).toHaveLength(1);
    expect(filterBySearchText(items, 'name')).toHaveLength(1);
    expect(filterBySearchText(items, 'desc')).toHaveLength(1);
    expect(filterBySearchText(items, 'good')).toHaveLength(1);
    expect(filterBySearchText(items, 'match')).toHaveLength(1);
  });
});

describe('scrubSearchHaystack', () => {
  it('strips nulls, collapses lines, caps length', () => {
    expect(scrubSearchHaystack(`A${'\0'}B${'\n'}C`)).toBe('AB C');
    expect(scrubSearchHaystack('\0\n')).toBe('');
    expect(scrubSearchHaystack(null)).toBe('');
    expect(scrubSearchHaystack('x'.repeat(10), 4)).toBe('xxxx');
  });
});

describe('filterByStatus', () => {
  it('filters deployments by status', () => {
    const items = [
      { status: 'success' },
      { status: 'failed' },
      { status: 'success' },
    ];
    expect(filterByStatus(items, 'success')).toHaveLength(2);
    expect(filterByStatus(items, 'all')).toHaveLength(3);
    expect(filterByStatus(items, undefined)).toHaveLength(3);
  });

  it('returns empty when no status matches', () => {
    expect(filterByStatus([{ status: 'pending' }], 'failed')).toEqual([]);
  });

  it('normalizes padded item status/kind and drops control-char item fields', () => {
    expect(filterByStatus([{ status: '  success  ' }], 'success')).toHaveLength(1);
    expect(filterByStatus([{ status: `success${'\0'}` }], 'success')).toHaveLength(0);
    expect(filterByKind([{ kind: '  image  ' }], 'image')).toHaveLength(1);
    expect(filterByKind([{ kind: '\nimage' }], 'image')).toHaveLength(0);
    expect(filterByFieldValue([{ provider: ' vercel ' }], 'provider', 'vercel')).toHaveLength(1);
    expect(filterByEnabled([{ enabled: true }], '\nenabled')).toHaveLength(1);
    expect(filterByEnabled([{ enabled: true }], 'enabled')).toHaveLength(1);
    expect(filterByEnabled([{ enabled: false }], 'enabled')).toHaveLength(0);
    // Control-char domain on item does not match chip
    expect(
      filterWorkflowList(
        [{ name: 'X', domain: '\ncoding', description: '' }],
        { domain: 'coding' },
      ),
    ).toHaveLength(0);
  });
});

describe('filterBySearchText case-insensitivity', () => {
  it('matches mixed case names', () => {
    const items = [{ name: 'DesignKit', description: 'OD Atoms' }];
    expect(filterBySearchText(items, 'design')).toHaveLength(1);
    expect(filterBySearchText(items, 'OD ATOMS')).toHaveLength(1);
  });
});

describe('filterByKind', () => {
  it('filters media-like items by kind chip', () => {
    const media = [
      { filename: 'a.png', kind: 'image' },
      { filename: 'b.mp3', kind: 'audio' },
      { filename: 'c.bin', kind: 'other' },
    ];
    expect(filterByKind(media, 'image')).toEqual([media[0]]);
    expect(filterByKind(media, 'audio')).toHaveLength(1);
    expect(filterByKind(media, 'all')).toHaveLength(3);
    expect(filterByKind(media, undefined)).toHaveLength(3);
    expect(filterByKind(media, 'video')).toEqual([]);
  });
});

describe('filterByEnabled', () => {
  it('filters by enabled/disabled chips', () => {
    const items = [
      { name: 'a', enabled: true },
      { name: 'b', enabled: false },
      { name: 'c', enabled: true },
    ];
    expect(filterByEnabled(items, 'enabled')).toHaveLength(2);
    expect(filterByEnabled(items, 'disabled')).toHaveLength(1);
    expect(filterByEnabled(items, 'all')).toHaveLength(3);
    expect(filterByEnabled(items, undefined)).toHaveLength(3);
  });

  it('returns all for unknown enabledFilter values', () => {
    const items = [{ name: 'a', enabled: true }, { name: 'b', enabled: false }];
    expect(filterByEnabled(items, 'maybe')).toHaveLength(2);
  });
});

describe('filterByTextMatch', () => {
  it('matches against custom haystack fields', () => {
    const items = [
      { projectName: 'landing', provider: 'vercel', url: 'https://a.vercel.app' },
      { projectName: 'docs', provider: 'cloudflare', url: 'https://docs.pages.dev' },
    ];
    expect(
      filterByTextMatch(items, 'vercel', (d) => `${d.projectName} ${d.provider} ${d.url}`),
    ).toHaveLength(1);
    expect(
      filterByTextMatch(items, 'docs', (d) => `${d.projectName} ${d.provider} ${d.url}`),
    ).toHaveLength(1);
    expect(filterByTextMatch(items, '', (d) => d.projectName)).toHaveLength(2);
    // Control-char search → return all
    expect(
      filterByTextMatch(items, `ver${'\0'}cel`, (d) => d.projectName),
    ).toHaveLength(2);
    expect(filterByTextMatch(items, '\ndocs', (d) => d.projectName)).toHaveLength(2);
  });

  it('strips null bytes from haystack before matching', () => {
    const items = [{ projectName: `land${'\0'}ing`, provider: 'vercel' }];
    expect(
      filterByTextMatch(items, 'landing', (d) => `${d.projectName} ${d.provider}`),
    ).toHaveLength(1);
  });
});

describe('filterByFieldValue', () => {
  it('filters by provider chip', () => {
    const items = [
      { provider: 'vercel', name: 'a' },
      { provider: 'cloudflare', name: 'b' },
      { provider: 'vercel', name: 'c' },
    ];
    expect(filterByFieldValue(items, 'provider', 'vercel')).toHaveLength(2);
    expect(filterByFieldValue(items, 'provider', 'cloudflare')).toHaveLength(1);
    expect(filterByFieldValue(items, 'provider', 'all')).toHaveLength(3);
  });

  it('coerces missing field values to empty string', () => {
    const items = [{ provider: 'vercel' }, { name: 'no-provider' } as { provider?: string; name: string }];
    expect(filterByFieldValue(items, 'provider', 'vercel')).toHaveLength(1);
    expect(filterByFieldValue(items, 'provider', '')).toEqual(items);
  });
});

