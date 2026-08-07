import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const getSettings = vi.fn(async () => ({
  ok: true,
  data: { ANTHROPIC_API_KEY: 'sk-a...xyz1' },
}));

const saveSetting = vi.fn(async () => ({ ok: true }));
const verifyApiKey = vi.fn(async () => ({ ok: true, data: { valid: true } }));
const getCollabStatus = vi.fn(async () => ({
  ok: true,
  data: {
    bus: 'memory',
    nodeId: 'node-test',
    ready: true,
    detail: null,
    presence: { kind: 'memory', ready: true, detail: null },
    locks: { kind: 'memory', ready: true, detail: null },
    sharedEdit: { hardEnforce: true, agentsHardEnforce: false },
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
      getSettings = getSettings;
      saveSetting = saveSetting;
      verifyApiKey = verifyApiKey;
      getCollabStatus = getCollabStatus;
    },
  };
});

const { Settings } = await import('./Settings.js');

describe('Web Settings', () => {
  beforeEach(() => {
    getMcpInstallInfo.mockClear();
    getSettings.mockClear();
    saveSetting.mockClear();
    verifyApiKey.mockClear();
    getCollabStatus.mockClear();
    getSettings.mockResolvedValue({
      ok: true,
      data: { ANTHROPIC_API_KEY: 'sk-a...xyz1' },
    });
    verifyApiKey.mockResolvedValue({ ok: true, data: { valid: true } });
    saveSetting.mockResolvedValue({ ok: true });
    getCollabStatus.mockResolvedValue({
      ok: true,
      data: {
        bus: 'memory',
        nodeId: 'node-test',
        ready: true,
        detail: null,
        presence: { kind: 'memory', ready: true, detail: null },
        locks: { kind: 'memory', ready: true, detail: null },
        sharedEdit: { hardEnforce: true, agentsHardEnforce: false },
      },
    });
  });

  function renderSettings() {
    return render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('loads install-info into shared McpInstallPanel', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('mcp-expose-section')).toBeInTheDocument();
    });
    expect(getMcpInstallInfo).toHaveBeenCalled();
    expect(screen.getByTestId('mcp-expose-tools').textContent).toContain('neos_files_read');
    expect(screen.getByTestId('mcp-expose-shell').textContent).toContain('NEOS_SERVER_URL');
  });

  it('shows masked API keys and verifies then saves', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('api-keys-section')).toBeInTheDocument();
    });
    expect(getSettings).toHaveBeenCalled();
    expect(screen.getByTestId('api-key-masked-ANTHROPIC_API_KEY').textContent).toMatch(/sk-a/);

    const input = screen.getByTestId('api-key-input-ANTHROPIC_API_KEY') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-ant-test-key' } });
    fireEvent.click(screen.getByTestId('api-key-verify-ANTHROPIC_API_KEY'));
    await waitFor(() => {
      expect(verifyApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test-key');
    });
    await waitFor(() => {
      expect(screen.getByTestId('api-key-verify-ANTHROPIC_API_KEY').textContent).toMatch(/Valid/);
    });

    fireEvent.click(screen.getByTestId('api-key-save-ANTHROPIC_API_KEY'));
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    });
  });

  it('loads collab status ops panel', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('collab-status-section')).toBeInTheDocument();
      expect(screen.getByTestId('collab-status-bus').textContent).toMatch(/memory/);
      expect(screen.getByTestId('collab-status-node').textContent).toBe('node-test');
      expect(screen.getByTestId('collab-status-presence').textContent).toMatch(/memory/);
      expect(screen.getByTestId('collab-status-locks').textContent).toMatch(/memory/);
      expect(screen.getByTestId('collab-status-shared-edit').textContent).toMatch(
        /on.*agents off/i,
      );
    });
    expect(getCollabStatus).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('collab-status-refresh'));
    await waitFor(() => {
      expect(getCollabStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows desktop-only dual-surface badge (v0.9.3 Q29)', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('dual-surface-badge')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dual-surface-badge').textContent).toMatch(
      /marketplace|Plugins/i,
    );
    expect(screen.getByTestId('dual-surface-badge').textContent).toMatch(
      /dual-surface/i,
    );
  });
});
