import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getSettings = vi.fn();
const getSetting = vi.fn();
const saveSetting = vi.fn();
const verifyApiKey = vi.fn();
const health = vi.fn();
const getMediaConfig = vi.fn();
const listMcpServers = vi.fn();
const getMcpOAuthStatus = vi.fn();
const createMcpServer = vi.fn();
const toggleMcpServer = vi.fn();
const deleteMcpServer = vi.fn();
const listCliAgents = vi.fn();
const setAuthToken = vi.fn();
const setTheme = vi.fn();
const changeLanguage = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    status: 'connected',
    mode: 'host',
    serverUrl: 'http://127.0.0.1:57286',
    client: {
      getSettings,
      getSetting,
      saveSetting,
      verifyApiKey,
      health,
      getMediaConfig,
      listMcpServers,
      getMcpOAuthStatus,
      createMcpServer,
      toggleMcpServer,
      deleteMcpServer,
      listCliAgents,
      setAuthToken,
    },
  }),
}));

vi.mock('../hooks/useTheme.js', () => ({
  useTheme: () => ({ theme: 'dark', setTheme }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage },
  }),
}));

const { Settings } = await import('./Settings.js');

describe('Settings page', () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue({
      ok: true,
      data: {
        'defaults.provider': 'google',
        'defaults.model': 'gemini-2.0-flash',
      },
    });
    getSetting.mockReset().mockResolvedValue({ ok: true, data: null });
    saveSetting.mockReset().mockResolvedValue({ ok: true });
    verifyApiKey.mockReset();
    health.mockReset().mockResolvedValue({ status: 'ok', version: '0.3.59', uptime: 3661 });
    getMediaConfig.mockReset().mockResolvedValue({
      ok: true,
      data: {
        openaiConfigured: true,
        openaiBaseUrl: 'https://api.openai.com/v1',
        surfaces: ['workflow', 'chat'],
        imageModels: ['dall-e-3'],
        audioModels: ['tts-1'],
      },
    });
    listMcpServers.mockReset().mockResolvedValue({ ok: true, data: [] });
    getMcpOAuthStatus.mockReset().mockResolvedValue({ ok: true, data: { connected: false } });
    createMcpServer.mockReset().mockResolvedValue({ ok: true });
    toggleMcpServer.mockReset().mockResolvedValue({ ok: true });
    deleteMcpServer.mockReset().mockResolvedValue({ ok: true });
    listCliAgents.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'claude', name: 'Claude Code', path: '/usr/local/bin/claude', version: '1.0.0' }],
    });
    setTheme.mockReset();
    changeLanguage.mockReset();
    setAuthToken.mockReset();
    sessionStorage.clear();
  });

  it('renders sections and engine/media status', async () => {
    render(<Settings />);
    expect(screen.getByText('settings:title')).toBeInTheDocument();
    expect(screen.getByText('settings:apiKeys.title')).toBeInTheDocument();
    expect(screen.getByText('settings:workflowKeys.title')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Media generation')).toBeInTheDocument();
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('CLI Agents')).toBeInTheDocument();
    expect(screen.getByText('Dev Tools')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('Local')).toBeInTheDocument();
      expect(screen.getByText('v0.3.59')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Configured')).toBeInTheDocument();
      expect(screen.getByText('workflow, chat')).toBeInTheDocument();
    });
  });

  it('loads defaults and saves provider/model changes', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(getSettings).toHaveBeenCalled();
    });
    // getByDisplayValue matches selected <option> text, not value
    await waitFor(() => {
      expect(screen.getByDisplayValue('Google AI')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Gemini 2.0 Flash')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Google AI'), { target: { value: 'anthropic' } });
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('defaults.provider', 'anthropic');
    });

    fireEvent.change(screen.getByDisplayValue('Gemini 2.0 Flash'), {
      target: { value: 'claude-sonnet-4-5-20250929' },
    });
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('defaults.model', 'claude-sonnet-4-5-20250929');
    });
  });

  it('changes theme and language', async () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'settings:appearance.light' }));
    expect(setTheme).toHaveBeenCalledWith('light');

    fireEvent.change(screen.getByDisplayValue('English'), { target: { value: 'ko' } });
    expect(changeLanguage).toHaveBeenCalledWith('ko');
  });

  it('saves API key after verify flow and simple keys', async () => {
    const user = userEvent.setup();
    verifyApiKey.mockResolvedValue({ ok: true, data: { valid: true } });
    getSetting.mockResolvedValue({ ok: true, data: null });
    render(<Settings />);

    await waitFor(() => expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument());

    const anthropicInput = screen.getByPlaceholderText('sk-ant-...');
    await user.type(anthropicInput, 'sk-ant-test-key');
    const verifyButtons = screen.getAllByRole('button', { name: 'common:action.verify' });
    fireEvent.click(verifyButtons[0]!);
    await waitFor(() => {
      expect(verifyApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test-key');
    });

    const saveButtons = screen.getAllByRole('button', { name: 'common:action.save' });
    fireEvent.click(saveButtons[0]!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('apiKey.anthropic', 'sk-ant-test-key');
    });

    const tavily = screen.getByPlaceholderText('tvly-...');
    await user.type(tavily, 'tvly-secret');
    const tavilyRow = tavily.closest('div')!.parentElement!;
    const tavilySave = Array.from(tavilyRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    expect(tavilySave).toBeTruthy();
    fireEvent.click(tavilySave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('TAVILY_API_KEY', 'tvly-secret');
    });
  });

  it('adds and lists MCP servers with Escape closing form', async () => {
    const user = userEvent.setup();
    listMcpServers
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'mcp-1',
            name: 'Filesystem',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            url: null,
            enabled: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    createMcpServer.mockResolvedValue({ ok: true });
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Server name'), 'Filesystem');
    await user.type(screen.getByPlaceholderText('Command (e.g. npx)'), 'npx');
    await user.type(
      screen.getByPlaceholderText('Args (space-separated, e.g. -y @server/pkg /path)'),
      '-y @modelcontextprotocol/server-filesystem',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));

    await waitFor(() => {
      expect(createMcpServer).toHaveBeenCalledWith({
        name: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        url: undefined,
      });
    });
    await waitFor(() => expect(screen.getByText('Filesystem')).toBeInTheDocument());
  });

  it('toggles and deletes MCP servers and opens OAuth modal', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-1',
          name: 'Remote MCP',
          transport: 'http',
          command: null,
          args: null,
          url: 'http://localhost:3000/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({ ok: true, data: { connected: false } });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('Remote MCP')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: Remote MCP')).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('Connect: Remote MCP')).not.toBeInTheDocument();
    });

    const row = screen.getByText('Remote MCP').closest('div.rounded-lg.border') as HTMLElement;
    const rowButtons = Array.from(row.querySelectorAll('button'));
    // actions: OAuth, enable toggle, delete (svg) — delete is last
    fireEvent.click(rowButtons[rowButtons.length - 1]!);
    await waitFor(() => expect(deleteMcpServer).toHaveBeenCalledWith('mcp-1'));
  });

  it('shows CLI agents and applies dev auth token', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
      expect(screen.getByText('detected')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Override Bearer token'), 'dev-token-1');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(sessionStorage.getItem('devAuthToken')).toBe('dev-token-1');
    expect(setAuthToken).toHaveBeenCalledWith('dev-token-1');
  });

  it('shows empty CLI agents message when none detected', async () => {
    listCliAgents.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No CLI agents detected/)).toBeInTheDocument();
    });
  });
});
