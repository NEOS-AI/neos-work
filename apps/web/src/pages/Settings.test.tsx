import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getMcpInstallInfo = vi.fn(async () => ({
  ok: true,
  data: {
    serverName: 'neos-work',
    version: '0.5.30',
    shellSnippet: 'export NEOS_SERVER_URL=http://127.0.0.1:3000',
    tools: [{ name: 'neos_files_read' }],
  },
}));

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({
    serverUrl: 'http://127.0.0.1:3000',
    token: 'test-token',
  }),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    WebApiClient: class {
      getMcpInstallInfo = getMcpInstallInfo;
    },
  };
});

const { Settings } = await import('./Settings.js');

describe('Web Settings MCP panel', () => {
  beforeEach(() => {
    getMcpInstallInfo.mockClear();
  });

  it('loads install-info into shared McpInstallPanel', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('mcp-expose-section')).toBeInTheDocument();
    });
    expect(getMcpInstallInfo).toHaveBeenCalled();
    expect(screen.getByTestId('mcp-expose-tools').textContent).toContain('neos_files_read');
    expect(screen.getByTestId('mcp-expose-shell').textContent).toContain('NEOS_SERVER_URL');
  });
});
