import { describe, expect, it } from 'vitest';
import { isAuthExemptPath } from './auth-paths.js';

describe('isAuthExemptPath', () => {
  it('exempts health, webhook trigger, tool-token routes, and MCP OAuth callback', () => {
    expect(isAuthExemptPath('/api/health')).toBe(true);
    // Trigger path only (single segment after /webhook/)
    expect(isAuthExemptPath('/api/webhook/wf-1')).toBe(true);
    expect(isAuthExemptPath('/api/tools/live-artifacts/list')).toBe(true);
    expect(isAuthExemptPath('/api/mcp-servers/oauth/callback')).toBe(true);
    // Documented alias path is auth-exempt and mounted as a forwarder in index.ts
    expect(isAuthExemptPath('/api/mcp/oauth/callback')).toBe(true);
  });

  it('does not exempt webhook secret/regenerate/rate-limit (Bearer required)', () => {
    expect(isAuthExemptPath('/api/webhook/wf-1/secret')).toBe(false);
    expect(isAuthExemptPath('/api/webhook/wf-1/regenerate')).toBe(false);
    expect(isAuthExemptPath('/api/webhook/wf-1/rate-limit')).toBe(false);
    expect(isAuthExemptPath('/api/webhook/wf-1/secret/')).toBe(false);
    expect(isAuthExemptPath('/api/webhook/')).toBe(false);
    // Trailing slash on trigger still exempt (normalized)
    expect(isAuthExemptPath('/api/webhook/wf-1/')).toBe(true);
  });

  it('does not exempt ordinary API routes', () => {
    expect(isAuthExemptPath('/api/mcp-servers')).toBe(false);
    expect(isAuthExemptPath('/api/mcp-servers/oauth/start')).toBe(false);
    expect(isAuthExemptPath('/api/settings')).toBe(false);
    expect(isAuthExemptPath('/api/session')).toBe(false);
    expect(isAuthExemptPath('/')).toBe(false);
  });

  it('rejects blank / control-char / non-string paths', () => {
    expect(isAuthExemptPath('')).toBe(false);
    expect(isAuthExemptPath('   ')).toBe(false);
    expect(isAuthExemptPath('/api/health\n')).toBe(false);
    expect(isAuthExemptPath(`\n/api/health`)).toBe(false);
    expect(isAuthExemptPath(null as unknown as string)).toBe(false);
  });
});
