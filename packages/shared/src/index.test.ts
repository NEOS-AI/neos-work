import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GOOGLE_MODELS,
  THINKING_BUDGET,
  migrateWorkflowV1ToV2,
  needsWorkflowMigration,
  normalizeEditContext,
} from './index.js';
import type { DomainWorker, DomainPack, PortDef, AgentHarness, DesignProject } from './index.js';

describe('@neos-work/shared barrel exports', () => {
  it('re-exports model catalogs and thinking budgets', () => {
    expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
    expect(GOOGLE_MODELS.length).toBeGreaterThan(0);
    expect(THINKING_BUDGET).toBeTypeOf('object');
    expect(ANTHROPIC_MODELS[0]).toMatchObject({
      id: expect.any(String),
      providerId: 'anthropic',
    });
  });

  it('exports migrate helpers and worker types (smoke)', () => {
    expect(typeof migrateWorkflowV1ToV2).toBe('function');
    expect(typeof needsWorkflowMigration).toBe('function');

    const worker: DomainWorker = {
      id: 'general_generalist',
      name: 'Generalist',
      domain: 'general',
      description: 'solo',
      systemPrompt: 'You are helpful.',
      allowedTools: ['web_search'],
      permissionProfile: 'full',
      workspace: { kind: 'run' },
      defaultMode: 'solo',
      isBuiltIn: true,
    };
    // AgentHarness is a deprecated alias of DomainWorker
    expect(normalizeEditContext({ filePath: 'index.html' })?.mode).toBe('replace-selection');
    const project: DesignProject = {
      id: 'p',
      name: 'n',
      baseDir: '/tmp/p',
      entryFile: 'index.html',
      designSystemId: null,
      meta: {},
      createdAt: 't',
      updatedAt: 't',
    };
    expect(project.entryFile).toBe('index.html');
    const harness: AgentHarness = worker;
    expect(harness.id).toBe('general_generalist');

    const pack: DomainPack = {
      id: 'general',
      name: 'General',
      description: 'default pack',
      workers: [worker],
      blockIds: [],
      isBuiltIn: true,
    };
    expect(pack.workers).toHaveLength(1);

    const port: PortDef = { key: 'out', required: false };
    expect(port.key).toBe('out');
  });
});
