import { writeFileSync, readFileSync, unlinkSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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

  it('rejects control-char / overlong lookup ids', () => {
    expect(getMemory('bad\nid')).toBeNull();
    expect(getMemory('x'.repeat(101))).toBeNull();
    expect(updateMemory('id\nbad', { content: 'x' })).toBeNull();
    expect(deleteMemory('id\nbad')).toBe(false);
  });

  it('rejects leading control-char names before trim', () => {
    expect(() =>
      createMemory({ name: '\nmem', type: 'user', content: 'x' }),
    ).toThrow(/control characters/i);
    expect(() =>
      createMemory({ name: NAME, type: 'user', content: 'hi\0there' }),
    ).toThrow(/control characters/i);
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

    // Leading control-char type must not strip to a known type
    const lead = createMemory({
      name: NAME,
      type: '\nsession' as never,
      content: 'ctrl-type',
    });
    expect(lead.type).toBe('user');
    deleteMemory(lead.id);

    const nul = createMemory({
      name: NAME,
      type: 'skill\0' as never,
      content: 'nul-type',
    });
    expect(nul.type).toBe('user');
    deleteMemory(nul.id);
  });

  it('rejects oversized content/name control chars; caps export size', () => {
    expect(() =>
      createMemory({ name: 'a\nb', type: 'user', content: 'x' }),
    ).toThrow(/control characters/i);
    expect(() =>
      createMemory({
        name: NAME,
        type: 'user',
        content: 'x'.repeat(1 * 1024 * 1024 + 1),
      }),
    ).toThrow(/max size/i);

    const m = createMemory({ name: NAME, type: 'user', content: 'export-me' });
    expect(exportMemories()).toContain('export-me');
    // update with oversized content leaves row unchanged
    expect(updateMemory(m.id, { content: 'y'.repeat(1 * 1024 * 1024 + 1) })).toBeNull();
    expect(getMemory(m.id)?.content).toBe('export-me');
    deleteMemory(m.id);
  });

  it('normalizes legacy type casing when reading from disk', () => {
    const m = createMemory({ name: NAME, type: 'user', content: 'legacy' });
    // Rewrite frontmatter with upper-case type (legacy files)
    writeFileSync(
      m.filePath,
      `---\nid: ${m.id}\nname: ${NAME}\ntype: SESSION\nenabled: true\ncreatedAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\n---\n\nlegacy\n`,
      'utf-8',
    );
    expect(getMemory(m.id)?.type).toBe('session');
    deleteMemory(m.id);
  });

  it('skips disk files with control-char name or null-byte body', () => {
    const m = createMemory({ name: NAME, type: 'user', content: 'ok' });
    // Same-line control char in name value (survives frontmatter line parse)
    writeFileSync(
      m.filePath,
      `---\nid: ${m.id}\nname: bad${'\0'}name\ntype: user\nenabled: true\ncreatedAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\n---\n\nok\n`,
      'utf-8',
    );
    // Control-char name value → empty name → file skipped
    expect(getMemory(m.id)).toBeNull();

    writeFileSync(
      m.filePath,
      `---\nid: ${m.id}\nname: ${NAME}\ntype: user\nenabled: true\ncreatedAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\n---\n\nok${'\0'}bad\n`,
      'utf-8',
    );
    expect(getMemory(m.id)).toBeNull();

    // Missing name field → blank name → skip rather than surface empty UI row
    writeFileSync(
      m.filePath,
      `---\nid: ${m.id}\ntype: user\nenabled: true\ncreatedAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\n---\n\nok\n`,
      'utf-8',
    );
    expect(getMemory(m.id)).toBeNull();

    // Restore valid file so afterEach cleanup can delete by id if needed
    try { deleteMemory(m.id); } catch { /* ignore */ }
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

  it('skips symlink .md files in listMemories (no outside content)', () => {
    const dir = join(homedir(), '.config', 'neos-work', 'memory');
    const outside = join(tmpdir(), `neos-mem-out-${process.pid}.md`);
    const link = join(dir, `symlink_escape_${process.pid}.md`);
    try {
      writeFileSync(
        outside,
        `---\nid: leak-${process.pid}\nname: Leak\ntype: user\nenabled: true\ncreatedAt: 2020-01-01T00:00:00.000Z\nupdatedAt: 2020-01-01T00:00:00.000Z\n---\n\noutside-secret\n`,
        'utf-8',
      );
      try {
        symlinkSync(outside, link);
      } catch {
        return; // symlink may be restricted
      }
      const listed = listMemories();
      expect(listed.some((m) => m.id === `leak-${process.pid}`)).toBe(false);
      expect(listed.some((m) => m.content?.includes('outside-secret'))).toBe(false);
    } finally {
      if (existsSync(link)) unlinkSync(link);
      if (existsSync(outside)) unlinkSync(outside);
    }
  });

  it('createMemory does not write through a planted path symlink', () => {
    const dir = join(homedir(), '.config', 'neos-work', 'memory');
    const name = `${NAME}_symwrite`;
    // createMemory builds type_slug.md — plant symlink at that path
    const slug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const targetName = `user_${slug}.md`;
    const link = join(dir, targetName);
    const outside = join(tmpdir(), `neos-mem-write-out-${process.pid}.md`);
    try {
      writeFileSync(outside, 'OUTSIDE_MARKER_DO_NOT_OVERWRITE\n', 'utf-8');
      if (existsSync(link)) unlinkSync(link);
      try {
        symlinkSync(outside, link);
      } catch {
        return;
      }
      const m = createMemory({
        name,
        type: 'user',
        content: 'safe-in-memory-dir',
      });
      expect(m.filePath).toBe(link);
      const outsideRaw = readFileSync(outside, 'utf-8');
      expect(outsideRaw).toContain('OUTSIDE_MARKER_DO_NOT_OVERWRITE');
      expect(outsideRaw).not.toContain('safe-in-memory-dir');
      // Real file now at the memory path
      const onDisk = readFileSync(link, 'utf-8');
      expect(onDisk).toContain('safe-in-memory-dir');
      deleteMemory(m.id);
    } finally {
      if (existsSync(link)) unlinkSync(link);
      if (existsSync(outside)) unlinkSync(outside);
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
