import { afterEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_PACK_MANIFEST_SCHEMA,
  isSafePackId,
  materializePackFromManifest,
  parsePackManifest,
  registerPackFromManifest,
  unregisterPack,
  resolvePack,
  resolveWorker,
  resolveBlock,
  setPackEnabled,
  listPacks,
} from '../index.js';

const validManifest = {
  schema: DOMAIN_PACK_MANIFEST_SCHEMA,
  id: 'legal',
  name: 'Legal',
  description: 'Legal review workers',
  version: '1.0.0',
  icon: 'scale',
  workers: [
    {
      id: 'legal_reviewer',
      name: 'Legal Reviewer',
      description: 'Reviews contracts',
      systemPrompt: 'You are a legal reviewer.',
      allowedTools: ['read_file'],
      permissionProfile: 'read_only',
      defaultMode: 'solo',
    },
  ],
  blocks: [
    {
      id: 'legal_clause_check',
      name: 'Clause Check',
      category: 'analysis',
      description: 'Check clauses',
      implementationType: 'prompt',
      promptTemplate: 'Review: {{input}}',
    },
  ],
};

describe('isSafePackId', () => {
  it('accepts slugs', () => {
    expect(isSafePackId('legal')).toBe(true);
    expect(isSafePackId('my-pack_1')).toBe(true);
  });
  it('rejects invalid', () => {
    expect(isSafePackId('Legal')).toBe(false);
    expect(isSafePackId('1bad')).toBe(false);
    expect(isSafePackId('bad id')).toBe(false);
    expect(isSafePackId('')).toBe(false);
    expect(isSafePackId('finance\nid')).toBe(false);
  });
});

describe('parsePackManifest', () => {
  it('accepts a valid pack', () => {
    const r = parsePackManifest(validManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.id).toBe('legal');
    expect(r.manifest.workers).toHaveLength(1);
    expect(r.manifest.blocks).toHaveLength(1);
  });

  it('parses JSON string', () => {
    const r = parsePackManifest(JSON.stringify(validManifest));
    expect(r.ok).toBe(true);
  });

  it('rejects wrong schema', () => {
    const r = parsePackManifest({ ...validManifest, schema: 'other/v1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/schema/);
  });

  it('rejects reserved built-in ids', () => {
    for (const id of ['finance', 'coding', 'research', 'general']) {
      const r = parsePackManifest({ ...validManifest, id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/reserved/);
    }
  });

  it('rejects invalid id', () => {
    expect(parsePackManifest({ ...validManifest, id: 'Bad Id' }).ok).toBe(false);
    expect(parsePackManifest({ ...validManifest, id: '' }).ok).toBe(false);
  });

  it('rejects empty workers and blocks', () => {
    const r = parsePackManifest({
      schema: DOMAIN_PACK_MANIFEST_SCHEMA,
      id: 'empty-pack',
      name: 'Empty',
      workers: [],
      blocks: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one/);
  });

  it('rejects native blocks', () => {
    const r = parsePackManifest({
      ...validManifest,
      id: 'native-pack',
      blocks: [
        {
          id: 'bad_native',
          name: 'Native',
          implementationType: 'native',
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/native/);
  });

  it('rejects prompt block without template', () => {
    const r = parsePackManifest({
      ...validManifest,
      id: 'no-prompt',
      blocks: [{ id: 'x', name: 'X', implementationType: 'prompt' }],
      workers: undefined,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid JSON string', () => {
    expect(parsePackManifest('{not-json').ok).toBe(false);
  });

  it('rejects control-char fields', () => {
    const r = parsePackManifest({
      ...validManifest,
      id: 'ctrl-pack',
      workers: [
        {
          id: 'w1',
          name: 'W',
          systemPrompt: 'ok',
          allowedTools: ['bad\ntool'],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // bad tool filtered out
      expect(r.manifest.workers[0]!.allowedTools ?? []).not.toContain('bad\ntool');
    }
  });
});

describe('registerPackFromManifest / unregister / enable', () => {
  afterEach(() => {
    unregisterPack('legal');
    unregisterPack('legal2');
  });

  it('registers workers and blocks under pack domain', () => {
    const r = registerPackFromManifest(validManifest);
    expect(r.ok).toBe(true);
    const pack = resolvePack('legal');
    expect(pack?.isBuiltIn).toBe(false);
    expect(pack?.enabled).toBe(true);
    expect(resolveWorker('legal_reviewer')?.domain).toBe('legal');
    expect(resolveBlock('legal_clause_check')?.domain).toBe('legal');
    expect(listPacks().some((p) => p.id === 'legal')).toBe(true);
  });

  it('rejects built-in overwrite via register', () => {
    const r = registerPackFromManifest({
      ...validManifest,
      id: 'finance',
    });
    // parse rejects reserved
    expect(r.ok).toBe(false);
  });

  it('disable removes runtime workers; enable restores', () => {
    expect(registerPackFromManifest(validManifest).ok).toBe(true);
    expect(setPackEnabled('legal', false).ok).toBe(true);
    expect(resolveWorker('legal_reviewer')).toBeUndefined();
    expect(resolveBlock('legal_clause_check')).toBeUndefined();
    expect(resolvePack('legal')?.enabled).toBe(false);

    expect(setPackEnabled('legal', true).ok).toBe(true);
    expect(resolveWorker('legal_reviewer')?.domain).toBe('legal');
    expect(resolveBlock('legal_clause_check')?.domain).toBe('legal');
  });

  it('unregister cleans up', () => {
    registerPackFromManifest(validManifest);
    expect(unregisterPack('legal')).toBe(true);
    expect(resolvePack('legal')).toBeUndefined();
    expect(resolveWorker('legal_reviewer')).toBeUndefined();
    expect(unregisterPack('finance')).toBe(false);
  });

  it('materializePackFromManifest maps fields', () => {
    const parsed = parsePackManifest(validManifest);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mat = materializePackFromManifest(parsed.manifest, {
      enabled: true,
      sourcePath: '/tmp/legal',
    });
    expect(mat.pack.sourcePath).toBe('/tmp/legal');
    expect(mat.workers[0]!.domain).toBe('legal');
    expect(mat.blocks[0]!.implementationType).toBe('prompt');
  });
});
