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
