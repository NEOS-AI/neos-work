import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKER_CONSTRAINTS_JSON_MAX_CHARS,
  WORKER_NAME_MAX_CHARS,
  WORKER_SYSTEM_PROMPT_MAX_CHARS,
  createCustomWorker,
  deleteCustomWorker,
  getCustomWorker,
  listCustomHarnesses,
  listCustomWorkers,
  updateCustomWorker,
} from './workers.js';

const ID = `_cov_worker_db_${process.pid}`;

afterEach(() => {
  try {
    deleteCustomWorker(ID);
  } catch {
    /* ignore */
  }
  for (const w of listCustomWorkers()) {
    if (w.id.startsWith('_cov_worker_db_')) {
      try {
        deleteCustomWorker(w.id);
      } catch {
        /* ignore */
      }
    }
  }
});

describe('custom workers CRUD', () => {
  it('creates, lists, gets, updates, deletes with v0.4 fields', () => {
    const w = createCustomWorker({
      id: ID,
      name: '  Cov Worker  ',
      domain: 'research',
      description: '  line1\nline2  ',
      systemPrompt: '  You are a custom worker.  ',
      allowedTools: ['  web_search  ', '', 'bad\nt', 'x'.repeat(101), 'read_file'],
      constraints: { maxSteps: 7, maxSpawnedWorkers: 2 },
      permissionProfile: 'network',
      defaultMode: 'solo',
      workspace: { kind: 'run', subdir: '  outputs  ' },
    });
    expect(w.isBuiltIn).toBe(false);
    expect(w.id).toBe(ID);
    expect(w.name).toBe('Cov Worker');
    expect(w.domain).toBe('research');
    expect(w.description).toBe('line1 line2');
    expect(w.systemPrompt).toBe('You are a custom worker.');
    expect(w.allowedTools).toEqual(['web_search', 'read_file']);
    expect(w.permissionProfile).toBe('network');
    expect(w.defaultMode).toBe('solo');
    expect(w.workspace).toEqual({ kind: 'run', subdir: 'outputs' });
    expect(w.constraints).toEqual({ maxSteps: 7, maxSpawnedWorkers: 2 });

    expect(getCustomWorker(ID)?.id).toBe(ID);
    expect(getCustomWorker(`  ${ID}  `)?.id).toBe(ID);
    expect(getCustomWorker('   ')).toBeUndefined();
    expect(getCustomWorker(`bad${'\n'}id`)).toBeUndefined();
    expect(listCustomWorkers().some((x) => x.id === ID)).toBe(true);
    expect(listCustomWorkers('research').every((x) => x.domain === 'research')).toBe(true);
    // control-char domain filter → list all
    expect(listCustomWorkers(`research${'\n'}`).some((x) => x.id === ID)).toBe(true);
    // deprecated alias
    expect(listCustomHarnesses().some((x) => x.id === ID)).toBe(true);

    const updated = updateCustomWorker(ID, {
      name: '  Renamed Worker  ',
      allowedTools: ['read_file'],
      defaultMode: 'coordinator',
      permissionProfile: 'read_only',
      workspace: { kind: 'isolated' },
      constraints: { maxSteps: 11 },
      description: 'lineA\nlineB',
      domain: 'coding',
    });
    expect(updated?.name).toBe('Renamed Worker');
    expect(updated?.domain).toBe('coding');
    expect(updated?.allowedTools).toEqual(['read_file']);
    expect(updated?.defaultMode).toBe('coordinator');
    expect(updated?.permissionProfile).toBe('read_only');
    expect(updated?.workspace).toEqual({ kind: 'isolated' });
    expect(updated?.constraints).toEqual({ maxSteps: 11 });
    expect(updated?.description).toBe('lineA lineB');
    expect(updated?.systemPrompt).toBe('You are a custom worker.');

    expect(updateCustomWorker('missing-xyz', { name: 'x' })).toBeUndefined();
    expect(deleteCustomWorker(ID)).toBe(true);
    expect(getCustomWorker(ID)).toBeUndefined();
    expect(deleteCustomWorker(ID)).toBe(false);
  });

  it('rejects invalid ids/names/prompts on create', () => {
    expect(() =>
      createCustomWorker({
        id: `bad${'\n'}id`,
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/control characters/i);

    expect(() =>
      createCustomWorker({
        id: ID,
        name: `bad${'\n'}name`,
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/control characters/i);

    expect(() =>
      createCustomWorker({
        id: ID,
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: `bad${'\n'}prompt`,
        allowedTools: [],
      }),
    ).toThrow(/control characters/i);

    expect(() =>
      createCustomWorker({
        id: '',
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/required/i);

    expect(() =>
      createCustomWorker({
        id: 'has spaces',
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/alphanumeric/i);

    expect(() =>
      createCustomWorker({
        id: 'x'.repeat(101),
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/max length/i);

    expect(() =>
      createCustomWorker({
        id: ID,
        name: 'n'.repeat(WORKER_NAME_MAX_CHARS + 1),
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/name exceeds/i);

    expect(() =>
      createCustomWorker({
        id: ID,
        name: 'n',
        domain: 'general',
        description: '',
        systemPrompt: 'p'.repeat(WORKER_SYSTEM_PROMPT_MAX_CHARS + 1),
        allowedTools: [],
      }),
    ).toThrow(/systemPrompt exceeds/i);
  });

  it('normalizes unknown domains to general and caps description', () => {
    const w = createCustomWorker({
      id: ID,
      name: 'Domain Cap',
      domain: 'quantum' as never,
      description: 'd'.repeat(3_000),
      systemPrompt: 'prompt',
      allowedTools: [],
      permissionProfile: 'not-a-profile' as never,
      defaultMode: 'team' as never,
      workspace: { kind: 'shared' } as never,
    });
    expect(w.domain).toBe('general');
    expect(w.description.length).toBe(2_000);
    // invalid profile/mode → defaults
    expect(w.permissionProfile).toBe('full');
    expect(w.defaultMode).toBe('solo');
    expect(w.workspace).toBeUndefined();
  });

  it('accepts workspace policies none/isolated/run and JSON string workspace', () => {
    const a = createCustomWorker({
      id: `${ID}_a`,
      name: 'A',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
      workspace: { kind: 'none' },
    });
    expect(a.workspace).toEqual({ kind: 'none' });
    deleteCustomWorker(`${ID}_a`);

    const b = createCustomWorker({
      id: `${ID}_b`,
      name: 'B',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
      workspace: { kind: 'run' },
    });
    expect(b.workspace).toEqual({ kind: 'run' });

    // update with JSON string workspace
    const upd = updateCustomWorker(`${ID}_b`, {
      workspace: JSON.stringify({ kind: 'run', subdir: 'out' }) as never,
    });
    expect(upd?.workspace).toEqual({ kind: 'run', subdir: 'out' });
    deleteCustomWorker(`${ID}_b`);
  });

  it('update rejects control-char name/prompt and oversized constraints', () => {
    createCustomWorker({
      id: ID,
      name: 'Base',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'You are base',
      allowedTools: [],
    });
    expect(updateCustomWorker(ID, { name: 'bad\nname' })).toBeUndefined();
    expect(updateCustomWorker(ID, { systemPrompt: 'bad\nprompt' })).toBeUndefined();
    expect(getCustomWorker(ID)?.name).toBe('Base');

    expect(updateCustomWorker('   ', { name: 'x' })).toBeUndefined();
    expect(updateCustomWorker(ID, { name: '   ' })).toBeUndefined();
    expect(updateCustomWorker(ID, { systemPrompt: '   ' })).toBeUndefined();
    expect(
      updateCustomWorker(ID, {
        systemPrompt: 'p'.repeat(WORKER_SYSTEM_PROMPT_MAX_CHARS + 1),
      }),
    ).toBeUndefined();

    // fat constraints fail closed
    const fat: Record<string, unknown> = { blob: 'C'.repeat(WORKER_CONSTRAINTS_JSON_MAX_CHARS) };
    expect(updateCustomWorker(ID, { constraints: fat as never })).toBeUndefined();

    // non-string description clears
    const cleared = updateCustomWorker(ID, { description: 123 as never });
    expect(cleared?.description).toBe('');

    // unknown domain on update → general
    const dom = updateCustomWorker(ID, { domain: 'nope' as never });
    expect(dom?.domain).toBe('general');
  });

  it('create rejects oversized constraints', () => {
    expect(() =>
      createCustomWorker({
        id: ID,
        name: 'Fat',
        domain: 'general',
        description: '',
        systemPrompt: 'p',
        allowedTools: [],
        constraints: { blob: 'C'.repeat(WORKER_CONSTRAINTS_JSON_MAX_CHARS) } as never,
      }),
    ).toThrow(/constraints exceed/i);
  });

  it('maps unknown permission/mode defaults and filters tools on update', () => {
    createCustomWorker({
      id: ID,
      name: 'Tools',
      domain: 'coding',
      description: '',
      systemPrompt: 'p',
      allowedTools: ['read_file'],
    });
    const u = updateCustomWorker(ID, {
      allowedTools: ['  write_file  ', '\nbad', 'ok'],
      permissionProfile: 'invalid' as never,
      defaultMode: 'nope' as never,
      workspace: null,
    });
    expect(u?.allowedTools).toEqual(['write_file', 'ok']);
    expect(u?.permissionProfile).toBe('full');
    expect(u?.defaultMode).toBe('solo');
    expect(u?.workspace).toBeUndefined();
  });
});
