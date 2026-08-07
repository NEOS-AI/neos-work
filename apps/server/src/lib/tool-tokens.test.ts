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

describe('tool-tokens edge cases', () => {
  it('rejects empty capabilities and invalid runId', () => {
    expect(() =>
      issueToolToken({ projectId: 'p1', capabilities: [] }),
    ).toThrow(/capability/i);
    expect(() =>
      issueToolToken({ projectId: 'p1', capabilities: ['nope'] }),
    ).toThrow(/capability/i);
    expect(() =>
      issueToolToken({ projectId: 'p1', runId: 'bad\nid', capabilities: ['media'] }),
    ).toThrow(/runId/i);
  });

  it('normalizes capabilities and clamps ttl', () => {
    const issued = issueToolToken({
      projectId: 'p1',
      capabilities: ['MEDIA', 'live-artifacts', 'media', 'x', 'files'],
      ttlMs: 1,
    });
    expect(issued.capabilities).toEqual(['media', 'live-artifacts', 'files']);
    expect(issued.expiresInMs).toBeGreaterThanOrEqual(10_000);
  });

  it('accepts files capability (v0.11 M2)', () => {
    const issued = issueToolToken({
      projectId: 'p1',
      capabilities: ['files'],
      runId: 'run-abc',
    });
    const rec = resolveToolToken(issued.token);
    requireToolCapability(rec, 'files');
    expect(rec.runId).toBe('run-abc');
  });

  it('expires tokens and purges', () => {
    const issued = issueToolToken({
      projectId: 'p1',
      capabilities: ['media'],
      ttlMs: 10_000,
    });
    const rec = resolveToolToken(issued.token);
    // force expire
    (rec as { expiresAt: number }).expiresAt = Date.now() - 1;
    expect(() => resolveToolToken(issued.token)).toThrow(/expired/i);
  });

  it('resolve rejects control/empty/oversize', () => {
    expect(() => resolveToolToken('bad\ntok')).toThrow(ToolTokenError);
    expect(() => resolveToolToken('')).toThrow(ToolTokenError);
    expect(() => resolveToolToken('x'.repeat(201))).toThrow(ToolTokenError);
    expect(() => resolveToolToken('unknown-token')).toThrow(/Unknown or expired/i);
  });

  it('assertNoScopeOverride rejects runId when token unbound', () => {
    const issued = issueToolToken({
      projectId: 'p1',
      capabilities: ['live-artifacts'],
    });
    const rec = resolveToolToken(issued.token);
    expect(() => assertNoScopeOverride(rec, { runId: 'r1' })).toThrow(/runId override/);
  });

  it('extractBearerToken rejects control header and empty bearer', () => {
    expect(extractBearerToken(undefined)).toBe('');
    expect(extractBearerToken('Bearer   ')).toBe('');
    expect(extractBearerToken('bearer token-ok')).toBe('token-ok');
  });

  it('evicts oldest when store is full', () => {
    // MAX_TOKENS = 500 — fill past cap so oldest is dropped
    for (let i = 0; i < 505; i++) {
      issueToolToken({ projectId: `p${i % 50}`, capabilities: ['media'] });
    }
    expect(toolTokenCount()).toBeLessThanOrEqual(500);
  });

  it('normalizeCaps drops non-array and control-char entries', () => {
    const issued = issueToolToken({
      projectId: 'p1',
      capabilities: ['media', 'bad\ncap', 'LIVE-ARTIFACTS', 12 as never, ''],
    });
    expect(issued.capabilities).toEqual(['media', 'live-artifacts']);
  });
});
