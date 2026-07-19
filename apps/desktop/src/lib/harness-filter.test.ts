import { describe, expect, it } from 'vitest';
import { allowedDomainsForAgentNode, filterAndSortHarnesses } from './harness-filter.js';

describe('allowedDomainsForAgentNode', () => {
  it('maps finance agent to finance+general', () => {
    expect([...allowedDomainsForAgentNode('agent_finance')].sort()).toEqual(['finance', 'general']);
  });

  it('defaults coding agent domains', () => {
    expect([...allowedDomainsForAgentNode('agent_coding')].sort()).toEqual(['coding', 'general']);
    expect([...allowedDomainsForAgentNode('other')].sort()).toEqual(['coding', 'general']);
  });
});

describe('filterAndSortHarnesses', () => {
  const harnesses = [
    { id: 'c2', name: 'Zeta', domain: 'coding' },
    { id: 'f1', name: 'Risk', domain: 'finance' },
    { id: 'g1', name: 'General', domain: 'general' },
    { id: 'c1', name: 'Alpha', domain: 'coding' },
  ];

  it('filters coding node types', () => {
    const filtered = filterAndSortHarnesses(harnesses, 'agent_coding');
    expect(filtered.map((h) => h.id)).toEqual(['c1', 'c2', 'g1']);
  });

  it('filters finance node types', () => {
    const filtered = filterAndSortHarnesses(harnesses, 'agent_finance');
    expect(filtered.map((h) => h.id)).toEqual(['f1', 'g1']);
  });

  it('returns empty when no harnesses match domain', () => {
    expect(
      filterAndSortHarnesses(
        [{ id: 'x', name: 'Only finance', domain: 'finance' }],
        'agent_coding',
      ),
    ).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [...harnesses];
    filterAndSortHarnesses(input, 'agent_coding');
    expect(input.map((h) => h.id)).toEqual(['c2', 'f1', 'g1', 'c1']);
  });
});
