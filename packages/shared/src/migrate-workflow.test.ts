import { describe, expect, it } from 'vitest';
import {
  migrateWorkflowV1ToV2,
  needsWorkflowMigration,
} from './migrate-workflow.js';
import type { Workflow, WorkflowNode } from './types/workflow.js';

function baseV1(nodes: WorkflowNode[], domain: string = 'finance'): Workflow {
  return {
    id: 'wf-1',
    name: 'Test',
    domain: domain as Workflow['domain'],
    nodes,
    edges: [{ id: 'e1', source: 't', target: nodes[0]?.id ?? 'a' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('migrateWorkflowV1ToV2', () => {
  it('sets schemaVersion 2 and primaryDomain from domain', () => {
    const { workflow, report } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 't',
          type: 'trigger',
          label: 'T',
          position: { x: 0, y: 0 },
          config: {},
        },
      ]),
    );
    expect(workflow.schemaVersion).toBe(2);
    expect(workflow.primaryDomain).toBe('finance');
    expect(workflow.domain).toBe('finance');
    expect(workflow.domainPackIds).toEqual(['finance']);
    expect(report.changed).toBe(true);
  });

  it('rewrites agent_finance → agent with default finance_analyst', () => {
    const { workflow, report } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_finance',
          label: 'Analyst',
          position: { x: 10, y: 20 },
          config: {},
        },
      ]),
    );
    const n = workflow.nodes[0]!;
    expect(n.type).toBe('agent');
    expect(n.config['workerId']).toBe('finance_analyst');
    expect(n.config['harnessId']).toBeUndefined();
    expect(report.renamedNodes).toEqual(['a1']);
    expect(workflow.domainPackIds).toContain('finance');
  });

  it('rewrites agent_coding → agent with default coding_reviewer', () => {
    const { workflow, report } = migrateWorkflowV1ToV2(
      baseV1(
        [
          {
            id: 'c1',
            type: 'agent_coding',
            label: 'Reviewer',
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        'coding',
      ),
    );
    const n = workflow.nodes[0]!;
    expect(n.type).toBe('agent');
    expect(n.config['workerId']).toBe('coding_reviewer');
    expect(report.renamedNodes).toEqual(['c1']);
    expect(workflow.primaryDomain).toBe('coding');
  });

  it('prefers existing harnessId → workerId and drops harnessId', () => {
    const { workflow } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_finance',
          label: 'Risk',
          position: { x: 0, y: 0 },
          config: { harnessId: 'finance_risk' },
        },
      ]),
    );
    const n = workflow.nodes[0]!;
    expect(n.type).toBe('agent');
    expect(n.config['workerId']).toBe('finance_risk');
    expect(n.config['harnessId']).toBeUndefined();
  });

  it('prefers workerId over harnessId when both present', () => {
    const { workflow } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_coding',
          label: 'Impl',
          position: { x: 0, y: 0 },
          config: { harnessId: 'coding_reviewer', workerId: 'coding_implementer' },
        },
      ]),
    );
    expect(workflow.nodes[0]!.config['workerId']).toBe('coding_implementer');
    expect(workflow.nodes[0]!.config['harnessId']).toBeUndefined();
  });

  it('renames provider → llmProvider (llmProvider wins)', () => {
    const { workflow } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_coding',
          label: 'A',
          position: { x: 0, y: 0 },
          config: { provider: 'openai', llmProvider: 'anthropic' },
        },
      ]),
    );
    const cfg = workflow.nodes[0]!.config;
    expect(cfg['llmProvider']).toBe('anthropic');
    expect(cfg['provider']).toBeUndefined();
  });

  it('migrates provider-only key to llmProvider', () => {
    const { workflow } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_finance',
          label: 'A',
          position: { x: 0, y: 0 },
          config: { provider: 'cli-claude' },
        },
      ]),
    );
    expect(workflow.nodes[0]!.config['llmProvider']).toBe('cli-claude');
    expect(workflow.nodes[0]!.config['provider']).toBeUndefined();
  });

  it('is idempotent on already-v2 documents', () => {
    const first = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a1',
          type: 'agent_finance',
          label: 'A',
          position: { x: 1, y: 2 },
          config: { harnessId: 'finance_analyst', provider: 'openai' },
        },
      ]),
    );
    const second = migrateWorkflowV1ToV2(first.workflow);
    expect(second.workflow).toEqual(first.workflow);
    expect(second.workflow.schemaVersion).toBe(2);
    expect(second.workflow.nodes[0]!.type).toBe('agent');
  });

  it('handles mixed graph: finance + coding agents + non-agent nodes', () => {
    const { workflow, report } = migrateWorkflowV1ToV2({
      id: 'mixed',
      name: 'Mixed',
      domain: 'general',
      nodes: [
        {
          id: 't',
          type: 'trigger',
          label: 'T',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'af',
          type: 'agent_finance',
          label: 'F',
          position: { x: 1, y: 0 },
          config: { harnessId: 'finance_chart_analyst' },
        },
        {
          id: 'ac',
          type: 'agent_coding',
          label: 'C',
          position: { x: 2, y: 0 },
          config: {},
        },
        {
          id: 'b',
          type: 'block',
          label: 'B',
          position: { x: 3, y: 0 },
          config: { blockId: 'finance/portfolio_summary' },
        },
        {
          id: 'o',
          type: 'output',
          label: 'O',
          position: { x: 4, y: 0 },
          config: {},
        },
      ],
      edges: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(workflow.schemaVersion).toBe(2);
    expect(workflow.primaryDomain).toBe('general');
    expect(workflow.nodes.map((n) => n.type)).toEqual([
      'trigger',
      'agent',
      'agent',
      'block',
      'output',
    ]);
    expect(workflow.nodes[1]!.config['workerId']).toBe('finance_chart_analyst');
    expect(workflow.nodes[2]!.config['workerId']).toBe('coding_reviewer');
    expect(report.renamedNodes.sort()).toEqual(['ac', 'af']);
    expect(workflow.domainPackIds).toEqual(
      expect.arrayContaining(['general', 'finance', 'coding']),
    );
  });

  it('defaults missing domain to general and omits domainPackIds when only general', () => {
    const { workflow } = migrateWorkflowV1ToV2({
      id: 'g',
      name: 'G',
      nodes: [
        {
          id: 't',
          type: 'trigger',
          label: 'T',
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
      createdAt: '',
      updatedAt: '',
    } as Workflow);
    expect(workflow.primaryDomain).toBe('general');
    expect(workflow.domain).toBe('general');
    expect(workflow.domainPackIds).toBeUndefined();
  });

  it('defaults bare agent node without workerId to general_generalist', () => {
    const { workflow, report } = migrateWorkflowV1ToV2(
      baseV1(
        [
          {
            id: 'a',
            type: 'agent',
            label: 'A',
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        'general',
      ),
    );
    expect(workflow.nodes[0]!.config['workerId']).toBe('general_generalist');
    expect(report.warnings.some((w) => w.includes('general_generalist'))).toBe(true);
  });

  it('preserves edges and non-agent fields', () => {
    const input = baseV1([
      {
        id: 'a1',
        type: 'agent_finance',
        label: 'A',
        position: { x: 5, y: 6 },
        config: { systemPrompt: 'hello', maxSteps: 7 },
      },
    ]);
    input.edges = [{ id: 'e1', source: 'x', target: 'a1', label: 'go' }];
    input.webhookSecret = 'sec';
    input.designSystemId = 'ds1';
    const { workflow } = migrateWorkflowV1ToV2(input);
    expect(workflow.edges).toEqual(input.edges);
    expect(workflow.webhookSecret).toBe('sec');
    expect(workflow.designSystemId).toBe('ds1');
    expect(workflow.nodes[0]!.config['systemPrompt']).toBe('hello');
    expect(workflow.nodes[0]!.config['maxSteps']).toBe(7);
  });

  it('infers research/general packs from workerId prefixes and keeps prior domainPackIds', () => {
    const { workflow } = migrateWorkflowV1ToV2({
      id: 'multi',
      name: 'Multi',
      domain: 'coding',
      domainPackIds: ['research', '  ', `bad${'\n'}pack`, 'custom-ok'],
      nodes: [
        {
          id: 'r',
          type: 'agent',
          label: 'R',
          position: { x: 0, y: 0 },
          config: { workerId: 'research_web' },
        },
        {
          id: 'g',
          type: 'agent',
          label: 'G',
          position: { x: 1, y: 0 },
          config: { harnessId: 'general_generalist' },
        },
      ],
      edges: null as unknown as Workflow['edges'],
      createdAt: '',
      updatedAt: '',
    } as Workflow);

    expect(workflow.edges).toEqual([]);
    expect(workflow.domainPackIds).toEqual(
      expect.arrayContaining(['coding', 'research', 'general', 'custom-ok']),
    );
    expect(workflow.domainPackIds).not.toContain('bad\npack');
    expect(workflow.nodes[0]!.config['workerId']).toBe('research_web');
    expect(workflow.nodes[1]!.config['workerId']).toBe('general_generalist');
    expect(workflow.nodes[1]!.config['harnessId']).toBeUndefined();
  });

  it('normalizes null/array node config to empty object', () => {
    const { workflow } = migrateWorkflowV1ToV2(
      baseV1([
        {
          id: 'a',
          type: 'agent',
          label: 'A',
          position: { x: 0, y: 0 },
          config: null as unknown as Record<string, unknown>,
        },
        {
          id: 'b',
          type: 'agent',
          label: 'B',
          position: { x: 1, y: 0 },
          config: ['not', 'object'] as unknown as Record<string, unknown>,
        },
      ], 'general'),
    );
    // bare agent + empty config → default worker
    expect(workflow.nodes[0]!.config['workerId']).toBe('general_generalist');
    expect(workflow.nodes[1]!.config['workerId']).toBe('general_generalist');
  });

  it('is idempotent for already-v2 documents without legacy keys', () => {
    const input: Workflow = {
      id: 'v2',
      name: 'V2',
      domain: 'finance',
      schemaVersion: 2,
      primaryDomain: 'finance',
      domainPackIds: ['finance'],
      nodes: [
        {
          id: 'a',
          type: 'agent',
          label: 'A',
          position: { x: 0, y: 0 },
          config: { workerId: 'finance_analyst' },
        },
      ],
      edges: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const { workflow, report } = migrateWorkflowV1ToV2(input);
    expect(workflow.schemaVersion).toBe(2);
    expect(workflow.nodes[0]!.config['workerId']).toBe('finance_analyst');
    // No renames; may still report changed=false when already clean v2
    expect(report.renamedNodes).toEqual([]);
  });
});

describe('needsWorkflowMigration', () => {
  it('returns true for missing / v1', () => {
    expect(needsWorkflowMigration(null)).toBe(true);
    expect(needsWorkflowMigration(undefined)).toBe(true);
    expect(needsWorkflowMigration({})).toBe(true);
    expect(needsWorkflowMigration({ schemaVersion: 1 })).toBe(true);
  });

  it('returns false for schemaVersion 2', () => {
    expect(needsWorkflowMigration({ schemaVersion: 2 })).toBe(false);
  });
});
