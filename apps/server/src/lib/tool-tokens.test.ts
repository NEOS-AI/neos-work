import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoScopeOverride,
  clearToolTokens,
  extractBearerToken,
  issueToolToken,
  requireToolCapability,
  resolveToolToken,
  ToolTokenError,
  toolTokenCount,
} from './tool-tokens.js';

afterEach(() => {
  clearToolTokens();
});

describe('tool-tokens', () => {
  it('issues and resolves a token', () => {
    const issued = issueToolToken({
      projectId: 'proj-1',
      capabilities: ['live-artifacts'],
    });
    expect(issued.token.startsWith('ntt_')).toBe(true);
    expect(toolTokenCount()).toBe(1);
    const rec = resolveToolToken(issued.token);
    expect(rec.projectId).toBe('proj-1');
    requireToolCapability(rec, 'live-artifacts');
  });

  it('rejects capability mismatch and overrides', () => {
    const issued = issueToolToken({
      projectId: 'proj-1',
      runId: 'run-1',
      capabilities: ['live-artifacts'],
    });
    const rec = resolveToolToken(issued.token);
    expect(() => requireToolCapability(rec, 'media')).toThrow(ToolTokenError);
    expect(() => assertNoScopeOverride(rec, { projectId: 'other' })).toThrow(/override/);
    expect(() => assertNoScopeOverride(rec, { runId: 'run-2' })).toThrow(/override/);
    expect(() => assertNoScopeOverride(rec, { projectId: 'proj-1', runId: 'run-1' })).not.toThrow();
  });

  it('extractBearerToken parses Authorization header', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('Basic x')).toBe('');
    expect(extractBearerToken(`Bearer bad\ntok`)).toBe('');
  });

  it('rejects invalid projectId on issue', () => {
    expect(() =>
      issueToolToken({ projectId: '', capabilities: ['live-artifacts'] }),
    ).toThrow(ToolTokenError);
  });
});
