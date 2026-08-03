import { describe, expect, it } from 'vitest';
import {
  isActiveRunStatus,
  isEditContextSelectionLines,
  isEditContextSelectionSelector,
  isTerminalRunStatus,
  normalizeEditContext,
  normalizeRunStatus,
  type DesignProject,
  type EditContext,
  type FileRevision,
  type LayerNode,
  type PreviewComment,
} from './project.js';

describe('normalizeEditContext', () => {
  it('accepts replace-selection with selector', () => {
    const ctx = normalizeEditContext({
      filePath: 'index.html',
      mode: 'replace-selection',
      selection: { selector: '#hero > h1' },
      snippet: '<h1>Hi</h1>',
    });
    expect(ctx).toEqual({
      filePath: 'index.html',
      mode: 'replace-selection',
      selection: { selector: '#hero > h1' },
      snippet: '<h1>Hi</h1>',
    });
    expect(isEditContextSelectionSelector(ctx!.selection)).toBe(true);
  });

  it('defaults mode to replace-selection (Q10)', () => {
    const ctx = normalizeEditContext({ filePath: 'src/a.html' });
    expect(ctx?.mode).toBe('replace-selection');
    expect(ctx?.filePath).toBe('src/a.html');
  });

  it('accepts line selection and patch mode', () => {
    const ctx = normalizeEditContext({
      filePath: '/pages/home.html',
      mode: 'patch',
      selection: { startLine: 2, endLine: 10 },
    });
    expect(ctx?.filePath).toBe('pages/home.html');
    expect(ctx?.mode).toBe('patch');
    expect(isEditContextSelectionLines(ctx!.selection)).toBe(true);
  });

  it('rejects control chars, bad mode, bad lines', () => {
    expect(normalizeEditContext({ filePath: 'a\nb' })).toBeNull();
    expect(normalizeEditContext({ filePath: 'a.html', mode: 'wipe' })).toBeNull();
    expect(
      normalizeEditContext({
        filePath: 'a.html',
        selection: { startLine: 0, endLine: 1 },
      }),
    ).toBeNull();
    expect(normalizeEditContext({ filePath: 'a.html', selection: { startLine: 1 } })).toBeNull();
    expect(normalizeEditContext({ filePath: 'a.html', selection: {} })).toBeNull();
    expect(normalizeEditContext({ filePath: 'a.html', selection: 'h1' })).toBeNull();
    expect(normalizeEditContext(null)).toBeNull();
    expect(normalizeEditContext('x')).toBeNull();
  });

  it('strips leading slashes from filePath', () => {
    const ctx = normalizeEditContext({ filePath: '///docs/a.html' });
    expect(ctx?.filePath).toBe('docs/a.html');
  });
});

describe('Design Project contracts (type smoke)', () => {
  it('shapes project, revision, comment, layer', () => {
    const project: DesignProject = {
      id: 'p1',
      name: 'Landing',
      baseDir: '/tmp/p1',
      entryFile: 'index.html',
      designSystemId: null,
      meta: {},
      createdAt: 't0',
      updatedAt: 't0',
    };
    const rev: FileRevision = {
      id: 'r1',
      projectId: project.id,
      path: 'index.html',
      contentHash: 'abc',
      source: 'user',
      createdAt: 't0',
    };
    const comment: PreviewComment = {
      id: 'c1',
      projectId: project.id,
      filePath: 'index.html',
      selector: 'body > main',
      body: 'tighten spacing',
      createdAt: 't0',
    };
    const layer: LayerNode = {
      id: 'n1',
      tag: 'div',
      name: '#root',
      selector: 'div#root',
      depth: 0,
      children: [],
      visible: true,
      locked: false,
    };
    const edit: EditContext = {
      filePath: 'index.html',
      mode: 'patch',
      selection: { selector: 'h1' },
    };
    expect(project.entryFile).toBe('index.html');
    expect(rev.source).toBe('user');
    expect(comment.selector).toContain('main');
    expect(layer.children).toEqual([]);
    expect(edit.mode).toBe('patch');
  });
});

describe('run status helpers', () => {
  it('isTerminalRunStatus covers canonical + aliases', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('canceled')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('error')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus(null)).toBe(false);
  });

  it('isActiveRunStatus and normalizeRunStatus', () => {
    expect(isActiveRunStatus('running')).toBe(true);
    expect(isActiveRunStatus('succeeded')).toBe(false);
    expect(normalizeRunStatus('cancelled')).toBe('canceled');
    expect(normalizeRunStatus('ERROR')).toBe('failed');
    expect(normalizeRunStatus('running')).toBe('running');
  });
});
