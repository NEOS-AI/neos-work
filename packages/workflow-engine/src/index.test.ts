import { describe, expect, it } from 'vitest';
import {
  executeWorkflow,
  topologicalSort,
  listHarnesses,
  listBlocks,
  registerFinanceBlocks,
  registerCodingBlocks,
  TriggerNode,
  BlockNode,
  AgentNode,
} from './index.js';

describe('@neos-work/workflow-engine barrel exports', () => {
  it('re-exports executor, graph, harness, blocks, and nodes', () => {
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof topologicalSort).toBe('function');
    expect(typeof listHarnesses).toBe('function');
    expect(typeof listBlocks).toBe('function');
    expect(typeof registerFinanceBlocks).toBe('function');
    expect(typeof registerCodingBlocks).toBe('function');
    expect(typeof TriggerNode).toBe('function');
    expect(typeof BlockNode).toBe('function');
    expect(typeof AgentNode).toBe('function');
    expect(topologicalSort([], []).length).toBe(0);
  });
});
