import { describe, expect, it } from 'vitest';
import {
  AtomRegistry,
  BUILTIN_ATOMS,
  atomIdsForStageKind,
  collectAtomIdsForPipeline,
  getGlobalAtomRegistry,
  listBuiltinAtomIds,
  resetGlobalAtomRegistry,
  stageKindToAtomKind,
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

describe('stage → atom mapping', () => {
  it('maps known stage kinds', () => {
    expect(atomIdsForStageKind('form')).toContain('genui.form');
    expect(atomIdsForStageKind('choice')).toContain('genui.choice');
    expect(atomIdsForStageKind('plan')).toContain('prompt.system');
    expect(atomIdsForStageKind('critique')).toContain('prompt.user');
    expect(atomIdsForStageKind('Discovery')).toContain('prompt.user');
    expect(atomIdsForStageKind('execute')).toContain('editor.apply_patch');
    expect(atomIdsForStageKind('unknown-stage')).toContain('editor.apply_patch');
    expect(atomIdsForStageKind('bad\nkind')).toContain('prompt.user');
    expect(atomIdsForStageKind(null)).toContain('editor.apply_patch');
    expect(atomIdsForStageKind(42)).toContain('editor.apply_patch');
  });

  it('collects unique pipeline atoms', () => {
    const ids = collectAtomIdsForPipeline([
      { kind: 'discovery' },
      { kind: 'execute' },
      { kind: 'form' },
      null,
      undefined,
    ]);
    expect(ids).toContain('gate.capability');
    expect(ids).toContain('genui.form');
    expect(ids).toContain('editor.apply_patch');
    expect(new Set(ids).size).toBe(ids.length);
    expect(collectAtomIdsForPipeline(null as never)).toEqual([]);
    // Empty stage list still pins capability gate for plugin pipelines
    expect(collectAtomIdsForPipeline([])).toEqual(['gate.capability']);
  });

  it('maps stage kinds to atom kinds', () => {
    expect(stageKindToAtomKind('form')).toBe('genui');
    expect(stageKindToAtomKind('choice')).toBe('genui');
    expect(stageKindToAtomKind('execute')).toBe('tool');
    expect(stageKindToAtomKind('plan')).toBe('prompt');
    expect(stageKindToAtomKind(null)).toBe('prompt');
    expect(stageKindToAtomKind(1)).toBe('prompt');
  });
});
