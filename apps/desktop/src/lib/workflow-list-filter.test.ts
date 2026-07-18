import { describe, expect, it } from 'vitest';
import { filterWorkflowList } from './workflow-list-filter.js';

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
