import { describe, expect, it } from 'vitest';
import {
  AtomRegistry,
  BUILTIN_ATOMS,
  getGlobalAtomRegistry,
  listBuiltinAtomIds,
  resetGlobalAtomRegistry,
} from './index.js';

describe('@neos-work/plugin-runtime', () => {
  it('registers at least 12 builtin atoms', () => {
    expect(BUILTIN_ATOMS.length).toBeGreaterThanOrEqual(12);
    expect(listBuiltinAtomIds()).toContain('editor.apply_patch');
    expect(listBuiltinAtomIds()).toContain('genui.form');
  });

  it('looks up atoms and filters by capability', () => {
    const reg = new AtomRegistry();
    expect(reg.get('editor.apply_patch')?.kind).toBe('editor');
    expect(reg.get('bad\nid')).toBeUndefined();
    const genui = reg.byCapability('genui');
    expect(genui.length).toBeGreaterThanOrEqual(3);
  });

  it('denies atoms by capability list', () => {
    const reg = new AtomRegistry();
    const denied = reg.deniedByCapabilities(
      ['tool.shell', 'prompt.system', 'nope'],
      ['tool.shell'],
    );
    expect(denied).toContain('tool.shell');
    expect(denied).toContain('nope');
    expect(denied).not.toContain('prompt.system');
  });

  it('pins and retrieves snapshots', () => {
    const reg = new AtomRegistry();
    const snap = reg.pinSnapshot({
      pluginId: 'demo-plugin',
      name: 'pin-1',
      atomIds: ['editor.apply_patch', 'unknown-atom'],
      fragments: { system: 'hi' },
    });
    expect(snap).not.toBeNull();
    expect(snap!.atomIds).toEqual(['editor.apply_patch']);
    expect(reg.getSnapshot(snap!.id)?.name).toBe('pin-1');
    expect(reg.listSnapshots('demo-plugin')).toHaveLength(1);
  });

  it('global registry resets', () => {
    resetGlobalAtomRegistry();
    const a = getGlobalAtomRegistry();
    const b = getGlobalAtomRegistry();
    expect(a).toBe(b);
    resetGlobalAtomRegistry();
    const c = getGlobalAtomRegistry();
    expect(c).not.toBe(a);
  });

  it('accepts extra atoms and skips unsafe ids', () => {
    const reg = new AtomRegistry({
      extra: [
        {
          id: 'custom.local_atom',
          kind: 'tool',
          title: 'Custom',
          capabilities: ['tool.custom'],
        },
        {
          id: 'bad\nid',
          kind: 'tool',
          title: 'Bad',
          capabilities: [],
        } as never,
      ],
    });
    expect(reg.get('custom.local_atom')?.title).toBe('Custom');
    expect(reg.get('custom.local_atom')?.trust).toBe('local');
    expect(reg.has('bad\nid')).toBe(false);
    expect(reg.has('custom.local_atom')).toBe(true);
  });
});
