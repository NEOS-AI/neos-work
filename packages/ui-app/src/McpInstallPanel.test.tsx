import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { McpInstallPanel } from './McpInstallPanel.js';

describe('McpInstallPanel', () => {
  it('renders tools and shell snippet; refresh callback', () => {
    const onRefresh = vi.fn();
    render(
      <McpInstallPanel
        info={{
          serverName: 'neos-work',
          version: '0.5.30',
          shellSnippet: 'export NEOS_AUTH_TOKEN=…',
          tools: [{ name: 'neos_files_read', description: 'read' }],
        }}
        onRefresh={onRefresh}
        showCodexActions={false}
      />,
    );
    expect(screen.getByTestId('mcp-expose-section')).toBeTruthy();
    expect(screen.getByTestId('mcp-expose-tools').textContent).toContain('neos_files_read');
    expect(screen.getByTestId('mcp-expose-shell').textContent).toContain('NEOS_AUTH_TOKEN');
    fireEvent.click(screen.getByTestId('mcp-expose-refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('shows error and codex install when available', () => {
    const onInstall = vi.fn();
    render(
      <McpInstallPanel
        info={{ serverName: 'neos-work', codexAddCommand: 'codex mcp add neos-work' }}
        error="boom"
        codexStatus={{ available: true, installed: false }}
        onInstallCodex={onInstall}
      />,
    );
    expect(screen.getByTestId('mcp-expose-error').textContent).toBe('boom');
    fireEvent.click(screen.getByTestId('mcp-expose-codex-install'));
    expect(onInstall).toHaveBeenCalled();
  });
});
