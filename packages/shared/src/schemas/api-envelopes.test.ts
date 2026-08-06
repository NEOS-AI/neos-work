import { describe, expect, it } from 'vitest';
import {
  collabLockConflictSchema,
  openApiWireFragments,
  parseCollabLockConflict,
  parseProjectFileWriteResponse,
  parseWithSchema,
  peerSelectionSchema,
  projectFileWriteResultSchema,
} from './api-envelopes.js';

describe('projectFileWriteResultSchema', () => {
  it('accepts live write data with hash', () => {
    const r = parseWithSchema(projectFileWriteResultSchema, {
      path: 'index.html',
      hash: 'deadbeef',
      bytes: 12,
      created: false,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects missing hash', () => {
    const r = parseWithSchema(projectFileWriteResultSchema, {
      path: 'index.html',
      contentHash: 'deadbeef',
      bytes: 12,
      created: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe('parseProjectFileWriteResponse', () => {
  it('accepts ok envelope with hash', () => {
    const r = parseProjectFileWriteResponse({
      ok: true,
      data: { path: 'a.html', hash: 'abc', bytes: 1, created: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.data?.hash).toBe('abc');
  });

  it('rejects contentHash-only write masquerade', () => {
    const r = parseProjectFileWriteResponse({
      ok: true,
      data: { path: 'a.html', contentHash: 'abc', bytes: 1, created: true },
    });
    expect(r.ok).toBe(false);
  });
});

describe('collabLockConflictSchema', () => {
  it('requires ok:false and optional holder', () => {
    const ok = parseCollabLockConflict({
      ok: false,
      error: 'File locked by Alice',
      data: { holder: { sessionId: 's1', displayName: 'Alice' } },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.data?.holder?.displayName).toBe('Alice');

    const bad = parseWithSchema(collabLockConflictSchema, {
      ok: true,
      data: { holder: { sessionId: 's1', displayName: 'Alice' } },
    });
    expect(bad.ok).toBe(false);
  });
});

describe('peerSelectionSchema multi-select', () => {
  it('accepts selectors array', () => {
    const r = parseWithSchema(peerSelectionSchema, {
      sessionId: 'abc',
      path: 'index.html',
      selector: '#b',
      selectors: ['#a', '#b'],
      colorHint: 12,
    });
    expect(r.ok).toBe(true);
  });
});

describe('openApiWireFragments', () => {
  it('documents write hash field', () => {
    expect(openApiWireFragments.ProjectFileWriteResult.properties.hash).toBeDefined();
    expect(
      openApiWireFragments.ProjectFileWriteResult.required,
    ).toContain('hash');
    expect(
      openApiWireFragments.ProjectFileWriteResult.required,
    ).not.toContain('contentHash');
  });

  it('documents run summary and revision contentHash', () => {
    expect(openApiWireFragments.ProjectRunSummary.required).toContain('status');
    expect(openApiWireFragments.FileRevisionListItem.required).toContain('contentHash');
    expect(openApiWireFragments.ProjectFileEventPayload.properties.hash).toBeDefined();
  });
});

describe('run + revision schemas', () => {
  it('parses run summary envelope', async () => {
    const { parseProjectRunSummaryResponse } = await import('./api-envelopes.js');
    const r = parseProjectRunSummaryResponse({
      ok: true,
      data: { id: 'r1', status: 'succeeded', eventCount: 3 },
    });
    expect(r.ok).toBe(true);
  });

  it('parses revision list (contentHash domain)', async () => {
    const { parseFileRevisionListResponse } = await import('./api-envelopes.js');
    const r = parseFileRevisionListResponse({
      ok: true,
      data: [
        {
          id: 'rev1',
          path: 'index.html',
          contentHash: 'deadbeef',
          source: 'user',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('parses file SSE payload', async () => {
    const { parseProjectFileEventPayload } = await import('./api-envelopes.js');
    const r = parseProjectFileEventPayload({
      projectId: 'p1',
      path: 'index.html',
      hash: 'abc',
      source: 'user',
    });
    expect(r.ok).toBe(true);
  });

  it('parses preview comment list (v0.9 M3)', async () => {
    const { parsePreviewCommentListResponse, openApiWireFragments } =
      await import('./api-envelopes.js');
    const r = parsePreviewCommentListResponse({
      ok: true,
      data: [
        {
          id: 'c1',
          projectId: 'p1',
          filePath: 'index.html',
          selector: '#hero',
          body: 'nudge spacing',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(openApiWireFragments.PreviewComment.required).toContain('filePath');
  });
});
