import { describe, expect, it } from 'vitest';
import { createFirstHtmlArtifact, isHtmlArtifactOutput } from './html-artifact.js';

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
});
