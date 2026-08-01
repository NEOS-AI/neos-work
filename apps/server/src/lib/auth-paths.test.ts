import { describe, expect, it } from 'vitest';
import { isAuthExemptPath } from './auth-paths.js';

describe('isAuthExemptPath', () => {
  it('exempts health, webhooks, tool-token routes, and MCP OAuth callback', () => {
    expect(isAuthExemptPath('/api/health')).toBe(true);
    expect(isAuthExemptPath('/api/webhook/wf-1')).toBe(true);
    expect(isAuthExemptPath('/api/tools/live-artifacts/list')).toBe(true);
    expect(isAuthExemptPath('/api/mcp-servers/oauth/callback')).toBe(true);
    // Documented alias path (desktop historically used /api/mcp/oauth/callback)
    expect(isAuthExemptPath('/api/mcp/oauth/callback')).toBe(true);
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
