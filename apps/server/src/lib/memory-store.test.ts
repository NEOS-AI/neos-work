import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemory,
  deleteMemory,
  exportMemories,
  getMemory,
  listMemories,
  toggleMemory,
  updateMemory,
} from './memory-store.js';

const NAME = `_cov_mem_${process.pid}`;

afterEach(() => {
  for (const m of listMemories()) {
    if (m.name === NAME || m.name.startsWith(NAME)) {
      deleteMemory(m.id);
    }
  }
});

describe('memory-store', () => {
  it('creates, gets, updates, toggles, exports, and deletes', () => {
    const created = createMemory({
      name: NAME,
      type: 'user',
      content: 'remember this',
      enabled: true,
    });
    expect(created.id).toBeTruthy();
    expect(created.content).toBe('remember this');
    expect(getMemory(created.id)?.name).toBe(NAME);
    expect(listMemories().some((m) => m.id === created.id)).toBe(true);

    const updated = updateMemory(created.id, { content: 'updated content' });
    expect(updated?.content).toBe('updated content');

    const toggled = toggleMemory(created.id);
    expect(toggled?.enabled).toBe(false);

    // disabled memories excluded from export
    expect(exportMemories()).not.toContain('updated content');

    toggleMemory(created.id); // re-enable
    expect(exportMemories()).toContain('updated content');
    expect(exportMemories()).toContain(NAME);

    expect(deleteMemory(created.id)).toBe(true);
    expect(getMemory(created.id)).toBeNull();
  });

  it('returns null for missing ids', () => {
    expect(getMemory('missing-id')).toBeNull();
    expect(updateMemory('missing-id', { content: 'x' })).toBeNull();
    expect(deleteMemory('missing-id')).toBe(false);
    expect(toggleMemory('missing-id')).toBeNull();
  });

  it('rejects blank name on create and normalizes unknown type to user', () => {
    expect(() =>
      createMemory({ name: '   ', type: 'user', content: 'x' }),
    ).toThrow(/name is required/i);

    const m = createMemory({
      name: NAME,
      type: 'not-a-type' as never,
      content: '  body  ',
    });
    expect(m.type).toBe('user');
    expect(m.content).toBe('body');
    deleteMemory(m.id);
  });

  it('updateMemory rejects blank name and normalizes type fallback', () => {
    const m = createMemory({ name: NAME, type: 'session', content: 's' });
    expect(updateMemory(m.id, { name: '   ' })).toBeNull();
    expect(getMemory(m.id)?.name).toBe(NAME);

    const updated = updateMemory(m.id, { type: 'bogus' as never, content: '  next  ' });
    expect(updated?.type).toBe('session'); // fallback to existing type
    expect(updated?.content).toBe('next');

    // export empty when no enabled memories
    updateMemory(m.id, { enabled: false });
    // only this suite's disabled mem — export may still contain others; just ensure no throw
    expect(typeof exportMemories()).toBe('string');
    deleteMemory(m.id);
  });

  it('trims ids and rejects blank id lookups', () => {
    const created = createMemory({
      name: NAME,
      type: 'user',
      content: 'id trim',
    });
    expect(getMemory(`  ${created.id}  `)?.content).toBe('id trim');
    expect(getMemory('   ')).toBeNull();
    expect(updateMemory('  ', { content: 'nope' })).toBeNull();
    expect(deleteMemory('  ')).toBe(false);
    deleteMemory(created.id);
  });

  it('skips hidden .md files in listMemories', () => {
    const dir = join(homedir(), '.config', 'neos-work', 'memory');
    const hidden = join(dir, `.hidden_${process.pid}.md`);
    try {
      writeFileSync(
        hidden,
        `---\nid: hidden-${process.pid}\nname: Hidden\ntype: user\nenabled: true\ncreatedAt: 2020-01-01T00:00:00.000Z\nupdatedAt: 2020-01-01T00:00:00.000Z\n---\n\nsecret\n`,
        'utf-8',
      );
      const listed = listMemories();
      expect(listed.some((m) => m.id === `hidden-${process.pid}`)).toBe(false);
    } finally {
      if (existsSync(hidden)) unlinkSync(hidden);
    }
  });

  it('creates memories of each type and lists them', () => {
    const types = ['user', 'session', 'skill', 'reference'] as const;
    const ids: string[] = [];
    for (const type of types) {
      const m = createMemory({
        name: `${NAME}_${type}`,
        type,
        content: `content-${type}`,
        enabled: true,
      });
      ids.push(m.id);
      expect(m.type).toBe(type);
    }
    const listed = listMemories();
    for (const id of ids) {
      expect(listed.some((m) => m.id === id)).toBe(true);
    }
    const exported = exportMemories();
    for (const type of types) {
      expect(exported).toContain(`content-${type}`);
    }
  });

  it('trims name/content on create/update and rejects blank name', () => {
    expect(() =>
      createMemory({ name: '   ', type: 'user', content: 'x' }),
    ).toThrow(/name is required/i);

    const m = createMemory({
      name: `  ${NAME}_trim  `,
      type: 'USER' as never,
      content: '  hello  ',
    });
    expect(m.name).toBe(`${NAME}_trim`);
    expect(m.type).toBe('user');
    expect(m.content).toBe('hello');

    const updated = updateMemory(m.id, {
      name: `  ${NAME}_trim2  `,
      content: '  world  ',
      type: 'SESSION' as never,
    });
    expect(updated?.name).toBe(`${NAME}_trim2`);
    expect(updated?.content).toBe('world');
    expect(updated?.type).toBe('session');
    expect(updateMemory(m.id, { name: '   ' })).toBeNull();
    expect(getMemory(m.id)?.name).toBe(`${NAME}_trim2`);
    deleteMemory(m.id);
  });

  it('updateMemory can rename and change type', () => {
    const m = createMemory({
      name: `${NAME}_rename`,
      type: 'user',
      content: 'c',
      enabled: true,
    });
    const updated = updateMemory(m.id, { name: `${NAME}_renamed`, type: 'reference', content: 'c2' });
    expect(updated?.name).toBe(`${NAME}_renamed`);
    expect(updated?.type).toBe('reference');
    expect(updated?.content).toBe('c2');
    expect(getMemory(m.id)?.name).toBe(`${NAME}_renamed`);
  });
});
