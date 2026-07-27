import { describe, expect, it } from 'vitest';
import {
  executeWorkflow,
  topologicalSort,
  listHarnesses,
  listWorkers,
  listPacks,
  resolveWorker,
  registerWorker,
  unregisterWorker,
  resolvePack,
  isBuiltInPackId,
  BUILT_IN_PACK_IDS,
  listBlocks,
  registerFinanceBlocks,
  registerCodingBlocks,
  TriggerNode,
  BlockNode,
  AgentNode,
} from './index.js';

describe('@neos-work/workflow-engine barrel exports', () => {
  it('re-exports executor, graph, packs/workers, harness aliases, blocks, and nodes', () => {
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof topologicalSort).toBe('function');
    expect(typeof listHarnesses).toBe('function');
    expect(typeof listWorkers).toBe('function');
    expect(typeof listPacks).toBe('function');
    expect(typeof resolveWorker).toBe('function');
    expect(typeof registerWorker).toBe('function');
    expect(typeof unregisterWorker).toBe('function');
    expect(typeof resolvePack).toBe('function');
    expect(typeof isBuiltInPackId).toBe('function');
    expect(BUILT_IN_PACK_IDS).toEqual(expect.arrayContaining(['finance', 'coding', 'research', 'general']));
    expect(typeof listBlocks).toBe('function');
    expect(typeof registerFinanceBlocks).toBe('function');
    expect(typeof registerCodingBlocks).toBe('function');
    expect(typeof TriggerNode).toBe('function');
    expect(typeof BlockNode).toBe('function');
    expect(typeof AgentNode).toBe('function');
    expect(topologicalSort([], []).length).toBe(0);
    expect(listPacks().length).toBe(4);
    expect(resolveWorker('general_generalist')).toBeDefined();
    expect(resolvePack('research')?.workers.length).toBeGreaterThan(0);
    expect(isBuiltInPackId('coding')).toBe(true);
    // harness alias shares the worker registry
    expect(listHarnesses().length).toBe(listWorkers().length);
  });
});
