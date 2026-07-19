import { describe, expect, it } from 'vitest';
import {
  filterByEnabled,
  filterByFieldValue,
  filterByKind,
  filterBySearchText,
  filterByStatus,
  filterByTextMatch,
  filterWorkflowList,
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

