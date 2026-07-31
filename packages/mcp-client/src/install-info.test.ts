import { describe, expect, it } from 'vitest';
import {
  buildMcpInstallInfo,
  NEOS_MCP_CONFIG_NAME,
  resolveNeosBinPath,
} from './install-info.js';

describe('resolveNeosBinPath', () => {
  it('prefers explicit absolute path', () => {
    expect(resolveNeosBinPath({ explicit: '/usr/local/bin/neos' })).toBe('/usr/local/bin/neos');
  });

  it('resolves relative explicit against cwd', () => {
    expect(resolveNeosBinPath({ explicit: 'bin/neos', cwd: '/app' })).toBe('/app/bin/neos');
  });

  it('falls back to argv1', () => {
    expect(resolveNeosBinPath({ argv1: '/opt/neos/dist/index.js', explicit: '' })).toBe(
      '/opt/neos/dist/index.js',
    );
  });

  it('rejects control chars', () => {
    expect(resolveNeosBinPath({ explicit: 'neos\n' })).not.toContain('\n');
  });
});

describe('buildMcpInstallInfo', () => {
  it('builds claude desktop fragment and codex commands', () => {
    const info = buildMcpInstallInfo({
      neosBin: '/Users/me/.local/bin/neos',
      serverUrl: 'http://127.0.0.1:3000',
      authToken: 'secret-token',
      projectId: 'proj_1',
      webBaseUrl: 'http://127.0.0.1:5173',
    });
    expect(info.serverName).toBe(NEOS_MCP_CONFIG_NAME);
    expect(info.command).toBe('/Users/me/.local/bin/neos');
    expect(info.args).toEqual(['mcp', 'serve']);
    expect(info.env.NEOS_SERVER_URL).toBe('http://127.0.0.1:3000');
    expect(info.env.NEOS_AUTH_TOKEN).toBe('secret-token');
    expect(info.env.NEOS_PROJECT_ID).toBe('proj_1');
    expect(info.claudeDesktop.mcpServers['neos-work']?.command).toBe('/Users/me/.local/bin/neos');
    expect(info.codexAddCommand).toMatch(/^codex mcp add neos-work/);
    expect(info.codexAddCommand).toContain('--env');
    expect(info.codexAddCommand).toContain('/Users/me/.local/bin/neos');
    expect(info.codexRemoveCommand).toBe('codex mcp remove neos-work');
    expect(info.shellSnippet).toMatch(/NEOS_AUTH_TOKEN/);
    expect(info.webDeepLink).toMatch(/settings\?focus=mcp-expose/);
  });

  it('omits token when unset', () => {
    const info = buildMcpInstallInfo({
      neosBin: 'neos',
      serverUrl: 'http://127.0.0.1:3000',
    });
    expect(info.env.NEOS_AUTH_TOKEN).toBeUndefined();
    expect(info.codexAddCommand).not.toMatch(/AUTH_TOKEN/);
  });

  it('rejects shell-dangerous paths', () => {
    const info = buildMcpInstallInfo({
      neosBin: 'neos"; rm -rf /',
      serverUrl: 'http://127.0.0.1:3000',
    });
    // path with quotes is rejected → falls back to 'neos' default via cleanPath empty + || 'neos' in command?
    // Actually cleanPath returns '' then `cleanPath(...) || 'neos'` → 'neos'
    expect(info.command).toBe('neos');
  });
});
