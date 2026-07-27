import { describe, expect, it } from 'vitest';
import {
  allowedDomainsForAgentNode,
  filterAndSortHarnesses,
  filterAndSortWorkers,
  type WorkerLike,
} from './worker-filter.js';

describe('worker-filter re-exports', () => {
  it('exports allowedDomainsForAgentNode for unified and legacy agent types', () => {
    expect([...allowedDomainsForAgentNode('agent')].sort()).toEqual([
      'coding',
      'finance',
      'general',
      'research',
    ]);
    expect([...allowedDomainsForAgentNode('agent_finance')].sort()).toEqual(['finance', 'general']);
    expect([...allowedDomainsForAgentNode('agent_coding')].sort()).toEqual(['coding', 'general']);
  });

  it('filterAndSortWorkers aliases filterAndSortHarnesses', () => {
    const workers: WorkerLike[] = [
      { id: 'r1', name: 'Web', domain: 'research' },
      { id: 'c1', name: 'Review', domain: 'coding' },
      { id: 'g1', name: 'General', domain: 'general' },
    ];
    const viaWorkers = filterAndSortWorkers(workers, 'agent');
    const viaHarness = filterAndSortHarnesses(workers, 'agent');
    expect(viaWorkers.map((w) => w.id)).toEqual(viaHarness.map((h) => h.id));
    expect(viaWorkers.map((w) => w.id)).toEqual(['c1', 'g1', 'r1']);
  });

  it('filters workers by domain for legacy agent_coding', () => {
    const workers: WorkerLike[] = [
      { id: 'r1', name: 'Web', domain: 'research' },
      { id: 'c1', name: 'Review', domain: 'coding' },
      { id: 'g1', name: 'General', domain: 'general' },
      { id: `bad${'\n'}`, name: 'X', domain: 'coding' },
    ];
    expect(filterAndSortWorkers(workers, 'agent_coding').map((w) => w.id)).toEqual(['c1', 'g1']);
  });
});
