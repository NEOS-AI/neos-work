import { describe, expect, it } from 'vitest';
import {
  createFirstHtmlArtifact,
  HTML_ARTIFACT_MAX_CHARS,
  isHtmlArtifactOutput,
} from './html-artifact.js';

describe('isHtmlArtifactOutput', () => {
  it('accepts doctype and html roots', () => {
    expect(isHtmlArtifactOutput('<!DOCTYPE html><html></html>')).toBe(true);
    expect(isHtmlArtifactOutput('  <html lang="en">')).toBe(true);
    expect(isHtmlArtifactOutput('<div>hi</div>')).toBe(true);
    expect(isHtmlArtifactOutput('<svg></svg>')).toBe(true);
  });

  it('rejects non-html', () => {
    expect(isHtmlArtifactOutput('plain text')).toBe(false);
    expect(isHtmlArtifactOutput({ html: true })).toBe(false);
    expect(isHtmlArtifactOutput('')).toBe(false);
  });

  it('only scans a bounded prefix for late markers', () => {
    // Marker far beyond 8 KiB scan window should not match
    const late = '<' + 'x'.repeat(10_000) + '<div>hi</div>';
    expect(isHtmlArtifactOutput(late)).toBe(false);
    const early = '<' + 'x'.repeat(100) + '<div>hi</div>';
    expect(isHtmlArtifactOutput(early)).toBe(true);
  });
});

describe('createFirstHtmlArtifact', () => {
  it('creates only the first completed HTML node', () => {
    const created: string[] = [];
    const id = createFirstHtmlArtifact({
      workflowId: 'wf',
      runId: 'run',
      nodeResults: {
        a: { status: 'completed', output: 'not html' },
        b: { status: 'completed', output: '<html>one</html>' },
        c: { status: 'completed', output: '<html>two</html>' },
      },
      create: (input) => {
        created.push(input.nodeId);
        return { id: `art-${input.nodeId}` };
      },
    });
    expect(id).toBe('art-b');
    expect(created).toEqual(['b']);
  });

  it('skips control-char status before completed check', () => {
    const id = createFirstHtmlArtifact({
      workflowId: 'wf',
      runId: 'run',
      nodeResults: {
        a: { status: 'completed\n', output: '<html>nope</html>' },
        b: { status: 'completed', output: '<html>yes</html>' },
      },
      create: (input) => ({ id: `art-${input.nodeId}` }),
    });
    expect(id).toBe('art-b');
  });

  it('returns undefined when no completed HTML outputs', () => {
    const id = createFirstHtmlArtifact({
      workflowId: 'wf',
      runId: 'run',
      nodeResults: {
        a: { status: 'failed', output: '<html>x</html>' },
        b: { status: 'completed', output: 'plain' },
      },
      create: () => ({ id: 'should-not' }),
    });
    expect(id).toBeUndefined();
  });

  it('treats padded COMPLETED status as completed', () => {
    const id = createFirstHtmlArtifact({
      workflowId: 'wf',
      runId: 'run',
      nodeResults: {
        a: { status: '  COMPLETED  ', output: '<div>ok</div>' },
      },
      create: () => ({ id: 'art-a' }),
    });
    expect(id).toBe('art-a');
  });

  it('returns undefined for control-char or overlong workflowId/runId', () => {
    const nodeResults = {
      a: { status: 'completed', output: '<html>x</html>' },
    };
    expect(
      createFirstHtmlArtifact({
        workflowId: 'wf\nid',
        runId: 'run',
        nodeResults,
        create: () => ({ id: 'nope' }),
      }),
    ).toBeUndefined();
    expect(
      createFirstHtmlArtifact({
        workflowId: 'wf',
        runId: 'r'.repeat(101),
        nodeResults,
        create: () => ({ id: 'nope' }),
      }),
    ).toBeUndefined();
  });

  it('returns undefined when workflowId/runId blank after trim', () => {
    const id = createFirstHtmlArtifact({
      workflowId: '  ',
      runId: 'run',
      nodeResults: {
        a: { status: 'completed', output: '<html>x</html>' },
      },
      create: () => ({ id: 'should-not' }),
    });
    expect(id).toBeUndefined();
  });

  it('passes trimmed content and node metadata to create', () => {
    let captured: {
      workflowId: string;
      runId: string;
      name: string;
      contentType: string;
      content: string;
      nodeId: string;
    } | null = null;
    createFirstHtmlArtifact({
      workflowId: 'wf-9',
      runId: 'run-9',
      nodeResults: {
        agent1: { status: 'completed', output: '  <div>hi</div>\n' },
      },
      create: (input) => {
        captured = input;
        return { id: 'art-1' };
      },
    });
    expect(captured).toEqual({
      workflowId: 'wf-9',
      runId: 'run-9',
      name: 'Output (agent1)',
      contentType: 'text/html',
      content: '<div>hi</div>',
      nodeId: 'agent1',
    });
  });

  it('skips oversized HTML and picks the next completed node', () => {
    const huge = `<div>${'x'.repeat(HTML_ARTIFACT_MAX_CHARS)}</div>`;
    expect(huge.length).toBeGreaterThan(HTML_ARTIFACT_MAX_CHARS);
    const created: string[] = [];
    const id = createFirstHtmlArtifact({
      workflowId: 'wf',
      runId: 'run',
      nodeResults: {
        big: { status: 'completed', output: huge },
        ok: { status: 'completed', output: '<html>small</html>' },
      },
      create: (input) => {
        created.push(input.nodeId);
        return { id: `art-${input.nodeId}` };
      },
    });
    expect(id).toBe('art-ok');
    expect(created).toEqual(['ok']);
  });
});
