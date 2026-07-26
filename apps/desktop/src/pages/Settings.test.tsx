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
const createMcpServerFromPreset = vi.fn();
const listMcpPresets = vi.fn();
const checkTradingViewCdp = vi.fn();
const toggleMcpServer = vi.fn();
const deleteMcpServer = vi.fn();
const revokeMcpOAuth = vi.fn();
const startMcpOAuth = vi.fn();
const listCliAgents = vi.fn();
const setAuthToken = vi.fn();
const setTheme = vi.fn();
const changeLanguage = vi.fn();

const clientApi = {
  getSettings,
  getSetting,
  saveSetting,
  verifyApiKey,
  health,
  getMediaConfig,
  listMcpServers,
  getMcpOAuthStatus,
  createMcpServer,
  createMcpServerFromPreset,
  listMcpPresets,
  checkTradingViewCdp,
  toggleMcpServer,
  deleteMcpServer,
  revokeMcpOAuth,
  startMcpOAuth,
  listCliAgents,
  setAuthToken,
};

let engine = {
  status: 'connected' as string,
  mode: 'host' as string | null,
  serverUrl: 'http://127.0.0.1:57286' as string | null,
  client: clientApi as typeof clientApi | null,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => engine,
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

// Dynamic import in handleOAuthConnect; prevent unhandled Tauri invoke in tests
const shellOpen = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (...args: unknown[]) => shellOpen(...args),
}));

const { Settings, safeOAuthAuthUrl } = await import('./Settings.js');

describe('safeOAuthAuthUrl', () => {
  it('allows http(s) and rejects control chars / non-http schemes', () => {
    expect(safeOAuthAuthUrl('https://auth.example/start')).toBe('https://auth.example/start');
    expect(safeOAuthAuthUrl('http://localhost:3000/oauth')).toBe('http://localhost:3000/oauth');
    expect(safeOAuthAuthUrl(`https://x.example/${'\0'}`)).toBe('');
    expect(safeOAuthAuthUrl('javascript:alert(1)')).toBe('');
    expect(safeOAuthAuthUrl('ftp://files.example')).toBe('');
    expect(safeOAuthAuthUrl('not a url')).toBe('');
    expect(safeOAuthAuthUrl(null)).toBe('');
    expect(safeOAuthAuthUrl('  https://ok.example  ')).toBe('https://ok.example');
  });
});

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
    createMcpServerFromPreset.mockReset().mockResolvedValue({ ok: true, data: { id: 'tv-1', name: 'TradingView' } });
    listMcpPresets.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'tradingview', name: 'TradingView', domain: 'finance', toolHints: ['tv_health_check'] }],
    });
    checkTradingViewCdp.mockReset().mockResolvedValue({
      ok: true,
      data: { ok: true, cdpConnected: true, port: 9222, browser: 'Chrome/120', targetCount: 2 },
    });
    toggleMcpServer.mockReset().mockResolvedValue({ ok: true });
    deleteMcpServer.mockReset().mockResolvedValue({ ok: true });
    revokeMcpOAuth.mockReset().mockResolvedValue({ ok: true });
    startMcpOAuth.mockReset().mockResolvedValue({ ok: true, data: { authUrl: 'https://auth.example' } });
    shellOpen.mockReset().mockResolvedValue(undefined);
    listCliAgents.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'claude', name: 'Claude Code', path: '/usr/local/bin/claude', version: '1.0.0' }],
    });
    setTheme.mockReset();
    changeLanguage.mockReset();
    setAuthToken.mockReset();
    sessionStorage.clear();
    engine = {
      status: 'connected',
      mode: 'host',
      serverUrl: 'http://127.0.0.1:57286',
      client: clientApi,
    };
  });

  it('renders sections and engine/media status', async () => {
    render(<Settings />);
    expect(screen.getByText('settings:title')).toBeInTheDocument();
    expect(screen.getByText('settings:apiKeys.title')).toBeInTheDocument();
    expect(screen.getByText('settings:workflowKeys.title')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Media generation')).toBeInTheDocument();
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('TradingView MCP')).toBeInTheDocument();
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


  it('adds TradingView MCP from preset path and probes CDP', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('TradingView MCP')).toBeInTheDocument();
    });

    const pathInput = screen.getByPlaceholderText(/Full path to tradingview-mcp/i);
    await user.type(pathInput, '/Users/me/tradingview-mcp');
    await user.click(screen.getByRole('button', { name: 'Add TradingView' }));

    await waitFor(() => {
      expect(createMcpServerFromPreset).toHaveBeenCalledWith({
        presetId: 'tradingview',
        installPath: '/Users/me/tradingview-mcp',
        name: 'TradingView',
      });
    });

    await user.click(screen.getByRole('button', { name: /Test CDP/i }));
    await waitFor(() => {
      expect(checkTradingViewCdp).toHaveBeenCalledWith(9222);
      expect(screen.getByText(/Connected on port 9222/i)).toBeInTheDocument();
    });
  });

  it('shows TradingView connected badge when server already listed', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-tv',
          name: 'TradingView',
          transport: 'stdio',
          command: 'node',
          args: ['/tmp/tv/src/server.js'],
          url: null,
          enabled: true,
          createdAt: '2026-01-01',
        },
      ],
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('● Connected')).toBeInTheDocument();
    });
    // Path form hidden when connected
    expect(screen.queryByPlaceholderText(/Full path to tradingview-mcp/i)).not.toBeInTheDocument();
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

  it('ignores control-char defaults from getSettings', async () => {
    getSettings.mockResolvedValue({
      ok: true,
      data: {
        'defaults.provider': `google${'\0'}`,
        'defaults.model': `gemini${'\n'}bad`,
      },
    });
    render(<Settings />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    // Built-in defaults remain (Anthropic / default model), not hostile strings
    await waitFor(() => {
      expect(screen.getByDisplayValue('Anthropic')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('adds TradingView MCP from preset and checks CDP status', async () => {
    const user = userEvent.setup();
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('TradingView MCP')).toBeInTheDocument());

    await user.type(
      screen.getByPlaceholderText(/Full path to tradingview-mcp/),
      '/tmp/tradingview-mcp',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add TradingView' }));
    await waitFor(() => {
      expect(createMcpServerFromPreset).toHaveBeenCalledWith({
        presetId: 'tradingview',
        installPath: '/tmp/tradingview-mcp',
        name: 'TradingView',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /Test CDP/i }));
    await waitFor(() => {
      expect(checkTradingViewCdp).toHaveBeenCalledWith(9222);
      expect(screen.getByText(/Connected on port 9222/)).toBeInTheDocument();
    });
  });

  it('alerts scrubbed error when TradingView from-preset fails', async () => {
    createMcpServerFromPreset.mockResolvedValue({
      ok: false,
      error: `entry${'\n'}missing${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('TradingView MCP')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Full path to tradingview-mcp/), {
      target: { value: '/tmp/tv' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add TradingView' }));
    await waitFor(() => {
      expect(createMcpServerFromPreset).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('entry missing!');
    });
    expect(String((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '')).not.toContain(
      '\0',
    );
  });

  it('rejects control-char TradingView install path without calling API', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    createMcpServerFromPreset.mockClear();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('TradingView MCP')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Full path to tradingview-mcp/), {
      target: { value: `/tmp/tv${'\0'}x` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add TradingView' }));
    expect(createMcpServerFromPreset).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Install path contains invalid control characters');
  });

  it('shows scrubbed CDP unreachable status', async () => {
    checkTradingViewCdp.mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        cdpConnected: false,
        port: 9222,
        error: `CDP${'\n'}down${'\0'}!`,
      },
    });
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('TradingView MCP')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Test CDP/i }));
    await waitFor(() => {
      expect(screen.getByText(/CDP down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('changes theme and language', async () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'settings:appearance.light' }));
    expect(setTheme).toHaveBeenCalledWith('light');

    fireEvent.click(screen.getByRole('button', { name: 'settings:appearance.system' }));
    expect(setTheme).toHaveBeenCalledWith('system');

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

  it('shows scrubbed MCP load error when listMcpServers fails', async () => {
    listMcpServers.mockResolvedValue({
      ok: false,
      error: `mcp${'\n'}down${'\0'}!`,
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('mcp down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No MCP servers configured/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
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

  it('alerts scrubbed errors when MCP delete or toggle fails', async () => {
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
    deleteMcpServer.mockResolvedValue({
      ok: false,
      error: `in${'\n'}use${'\0'}!`,
    });
    toggleMcpServer.mockResolvedValue({
      ok: false,
      error: `toggle${'\n'}denied${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Remote MCP')).toBeInTheDocument());

    const row = screen.getByText('Remote MCP').closest('div.rounded-lg.border') as HTMLElement;
    const rowButtons = Array.from(row.querySelectorAll('button'));
    // enable toggle is second-to-last, delete is last
    fireEvent.click(rowButtons[rowButtons.length - 2]!);
    await waitFor(() => {
      expect(toggleMcpServer).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('toggle denied!');
    });
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(rowButtons[rowButtons.length - 1]!);
    await waitFor(() => {
      expect(deleteMcpServer).toHaveBeenCalledWith('mcp-1');
      expect(window.alert).toHaveBeenCalledWith('in use!');
    });
    expect(screen.getByText('Remote MCP')).toBeInTheDocument();
  });

  it('rejects control-char / blank MCP OAuth fields without calling API', async () => {
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
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Remote MCP')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: Remote MCP')).toBeInTheDocument());

    const authEp = screen.getByPlaceholderText('Authorization Endpoint');
    const tokenEp = screen.getByPlaceholderText('Token Endpoint');
    const clientId = screen.getByPlaceholderText('Client ID');
    const scope = screen.getByPlaceholderText('Scope (optional)');
    const open = () => fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));

    // Use null-byte only — single-line inputs may strip bare \n/\r in jsdom
    fireEvent.change(authEp, { target: { value: `https://auth.example${'\0'}/authorize` } });
    fireEvent.change(tokenEp, { target: { value: 'https://auth.example/token' } });
    fireEvent.change(clientId, { target: { value: 'client-id' } });
    open();
    expect(startMcpOAuth).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('OAuth fields contain invalid control characters');

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(authEp, { target: { value: 'https://auth.example/authorize' } });
    fireEvent.change(tokenEp, { target: { value: `https://auth.example/token${'\0'}` } });
    open();
    expect(startMcpOAuth).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('OAuth fields contain invalid control characters');

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(tokenEp, { target: { value: 'https://auth.example/token' } });
    fireEvent.change(clientId, { target: { value: `cid${'\0'}bad` } });
    open();
    expect(startMcpOAuth).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('OAuth fields contain invalid control characters');

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(clientId, { target: { value: 'client-id' } });
    fireEvent.change(scope, { target: { value: `openid${'\0'}profile` } });
    open();
    expect(startMcpOAuth).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('OAuth fields contain invalid control characters');

    // Blank-after-trim required fields no-op (no control-char alert)
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(scope, { target: { value: '' } });
    fireEvent.change(authEp, { target: { value: '   ' } });
    fireEvent.change(tokenEp, { target: { value: 'https://auth.example/token' } });
    fireEvent.change(clientId, { target: { value: 'client-id' } });
    open();
    expect(startMcpOAuth).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('starts MCP OAuth with trimmed fields when connect succeeds', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-oauth',
          name: 'OAuth Target',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({ ok: true, data: { connected: false } });
    startMcpOAuth.mockResolvedValue({ ok: true, data: { authUrl: 'https://auth.example/start' } });

    render(<Settings />);
    await waitFor(() => expect(screen.getByText('OAuth Target')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: OAuth Target')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: '  https://auth.example/authorize  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: '  https://auth.example/token  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: '  my-client  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Scope (optional)'), {
      target: { value: '  openid profile  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));

    await waitFor(() => {
      expect(startMcpOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'mcp-oauth',
          authorizationEndpoint: 'https://auth.example/authorize',
          tokenEndpoint: 'https://auth.example/token',
          clientId: 'my-client',
          scope: 'openid profile',
        }),
      );
    });
    await waitFor(() => {
      expect(shellOpen).toHaveBeenCalledWith('https://auth.example/start');
    });
  });

  it('rejects non-http(s) OAuth authUrl without opening the browser', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-bad-url',
          name: 'Bad Auth URL',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({ ok: true, data: { connected: false } });
    startMcpOAuth.mockResolvedValue({
      ok: true,
      data: { authUrl: 'javascript:alert(1)' },
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Bad Auth URL')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: Bad Auth URL')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: 'https://auth.example/authorize' },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: 'https://auth.example/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: 'client-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));

    await waitFor(() => {
      expect(startMcpOAuth).toHaveBeenCalled();
    });
    expect(shellOpen).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringMatching(/invalid authorization URL/i),
    );
    alertSpy.mockRestore();
  });

  it('isolates OAuth status poll throw after successful browser open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-poll',
          name: 'Poll Target',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus
      .mockResolvedValueOnce({ ok: true, data: { connected: false } })
      .mockRejectedValueOnce(new Error('poll boom'));
    startMcpOAuth.mockResolvedValue({
      ok: true,
      data: { authUrl: 'https://auth.example/start' },
    });

    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Poll Target')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: Poll Target')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: 'https://auth.example/authorize' },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: 'https://auth.example/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: 'client-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));

    await waitFor(() => {
      expect(shellOpen).toHaveBeenCalledWith('https://auth.example/start');
    });

    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => {
      // Initial list probe + post-connect poll
      expect(getMcpOAuthStatus).toHaveBeenCalledWith('mcp-poll');
    });
    // Server list still intact; no poll error banner
    expect(screen.getByText('Poll Target')).toBeInTheDocument();
    expect(screen.queryByText(/poll boom/i)).not.toBeInTheDocument();
    vi.useRealTimers();
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

  it('rejects control-char API keys and dev auth tokens', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
    });

    // Dev token with control char never applied
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(screen.getByPlaceholderText('Override Bearer token'), {
      target: { value: `tok${'\0'}bad` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(sessionStorage.getItem('devAuthToken')).toBeNull();
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Token contains invalid control characters');

    // Simple key (Tavily) control-char rejected with alert
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    const tavily = screen.getByPlaceholderText('tvly-...');
    fireEvent.change(tavily, { target: { value: `tvly${'\0'}bad` } });
    const tavilyRow = tavily.closest('div')!.parentElement!;
    const tavilySave = Array.from(tavilyRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    expect(tavilySave).toBeTruthy();
    fireEvent.click(tavilySave!);
    expect(saveSetting).not.toHaveBeenCalledWith('TAVILY_API_KEY', expect.anything());
    expect(window.alert).toHaveBeenCalledWith('Value contains invalid control characters');

    // Provider API key verify/save reject control chars (save alerts)
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    const anthropic = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(anthropic, { target: { value: `sk-ant${'\0'}bad` } });
    const verifyButtons = screen.getAllByRole('button', { name: 'common:action.verify' });
    fireEvent.click(verifyButtons[0]!);
    expect(verifyApiKey).not.toHaveBeenCalled();
    const saveButtons = screen.getAllByRole('button', { name: 'common:action.save' });
    fireEvent.click(saveButtons[0]!);
    expect(saveSetting).not.toHaveBeenCalledWith('apiKey.anthropic', expect.anything());
    expect(window.alert).toHaveBeenCalledWith('Key contains invalid control characters');
  });

  it('shows empty CLI agents message when none detected', async () => {
    listCliAgents.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No CLI agents detected/)).toBeInTheDocument();
    });
  });

  it('shows CLI agents load error and recovers on Refresh', async () => {
    listCliAgents
      .mockResolvedValueOnce({ ok: false, error: `scan${'\n'}boom${'\0'}!` })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: 'cli-claude',
            name: 'Claude Code',
            path: '/usr/bin/claude',
            version: '1.0',
          },
        ],
      });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('scan boom!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    fireEvent.click(screen.getByRole('button', { name: '↺ Refresh' }));
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
      expect(screen.queryByText('scan boom!')).not.toBeInTheDocument();
    });
  });

  it('keeps MCP add form open when createMcpServer fails', async () => {
    const user = userEvent.setup();
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    createMcpServer.mockResolvedValue({
      ok: false,
      error: `name${'\n'}taken${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Server name'), 'Dup');
    await user.type(screen.getByPlaceholderText('Command (e.g. npx)'), 'npx');
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    await waitFor(() => {
      expect(createMcpServer).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('name taken!');
    });
    // Form stays open for correction
    expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument();
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('alerts scrubbed error when API key save fails', async () => {
    const user = userEvent.setup();
    saveSetting.mockResolvedValue({
      ok: false,
      error: `quota${'\n'}hit${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('sk-ant-...'), 'sk-ant-fail');
    fireEvent.click(screen.getAllByRole('button', { name: 'common:action.save' })[0]!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('apiKey.anthropic', 'sk-ant-fail');
      expect(window.alert).toHaveBeenCalledWith('quota hit!');
    });
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
  });

  it('rejects control-char MCP name/command/url without calling API', async () => {
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument());

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(screen.getByPlaceholderText('Server name'), {
      target: { value: `bad${'\0'}name` },
    });
    fireEvent.change(screen.getByPlaceholderText('Command (e.g. npx)'), {
      target: { value: 'npx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Name contains invalid control characters');

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(screen.getByPlaceholderText('Server name'), {
      target: { value: 'ok-name' },
    });
    fireEvent.change(screen.getByPlaceholderText('Command (e.g. npx)'), {
      target: { value: `npx${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Command contains invalid control characters');

    // HTTP transport: control-char URL rejected
    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'http' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Server URL (e.g. http://localhost:3000/sse)')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText('Server URL (e.g. http://localhost:3000/sse)'), {
      target: { value: `http://x${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('URL contains invalid control characters');
  });

  it('shows scrubbed media config load error', async () => {
    getMediaConfig.mockResolvedValue({
      ok: false,
      error: `media${'\n'}down${'\0'}!`,
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('media down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('scrubs control-char media base URL in status section', async () => {
    getMediaConfig.mockResolvedValue({
      ok: true,
      data: {
        openaiConfigured: true,
        openaiBaseUrl: `https://api.example${'\n'}.com${'\0'}/v1`,
        surfaces: [`image${'\0'}`],
        imageModels: [`dall-e${'\n'}3`],
        audioModels: [],
      },
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Configured')).toBeInTheDocument();
    });
    expect(document.body.textContent).toMatch(/https:\/\/api\.example/);
    expect(document.body.textContent).not.toContain('\0');
    expect(document.body.textContent).toMatch(/dall-e 3|dall-e3/);
  });

  it('shows invalid verify status and not-configured media', async () => {
    const user = userEvent.setup();
    verifyApiKey.mockResolvedValue({ ok: true, data: { valid: false } });
    getMediaConfig.mockResolvedValue({
      ok: true,
      data: {
        openaiConfigured: false,
        openaiBaseUrl: null,
        surfaces: [],
        imageModels: [],
        audioModels: [],
      },
    });
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Not set')).toBeInTheDocument();
    });

    await waitFor(() => expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('sk-ant-...'), 'sk-bad');
    const verifyButtons = screen.getAllByRole('button', { name: 'common:action.verify' });
    fireEvent.click(verifyButtons[0]!);
    await waitFor(() => {
      expect(verifyApiKey).toHaveBeenCalledWith('anthropic', 'sk-bad');
    });
    await waitFor(() => {
      expect(screen.getByText('settings:apiKeys.invalid')).toBeInTheDocument();
    });
  });

  it('saves workflow deploy keys via simple key inputs', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Deploy')).toBeInTheDocument());

    const vercel = screen.getByPlaceholderText('vercel_...');
    await user.type(vercel, 'vercel_tok');
    const vercelRow = vercel.closest('div')!.parentElement!;
    const vercelSave = Array.from(vercelRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    expect(vercelSave).toBeTruthy();
    fireEvent.click(vercelSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('VERCEL_API_TOKEN', 'vercel_tok');
    });

    const kis = screen.getByPlaceholderText('PSxxxxxx...');
    await user.type(kis, 'PS-kis-key');
    const kisRow = kis.closest('div')!.parentElement!;
    const kisSave = Array.from(kisRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    expect(kisSave).toBeTruthy();
    fireEvent.click(kisSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('KIS_APP_KEY', 'PS-kis-key');
    });
  });

  it('revokes connected MCP OAuth and saves OpenAI/Ollama base URLs', async () => {
    const user = userEvent.setup();
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-oauth-1',
          name: 'OAuth MCP',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({
      ok: true,
      data: { connected: true, expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    revokeMcpOAuth.mockResolvedValue({ ok: true });
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('OAuth MCP')).toBeInTheDocument());
    expect(screen.getByText('● OAuth')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(revokeMcpOAuth).toHaveBeenCalledWith('mcp-oauth-1'));
    expect(screen.queryByText('● OAuth')).not.toBeInTheDocument();

    const oaiBase = screen.getByPlaceholderText('https://api.openai.com/v1');
    await user.type(oaiBase, 'https://openai.example/v1');
    const oaiRow = oaiBase.closest('div')!.parentElement!;
    const oaiSave = Array.from(oaiRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(oaiSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('OPENAI_BASE_URL', 'https://openai.example/v1');
    });

    const ollama = screen.getByPlaceholderText('http://localhost:11434');
    await user.type(ollama, 'http://127.0.0.1:11434');
    const ollamaRow = ollama.closest('div')!.parentElement!;
    const ollamaSave = Array.from(ollamaRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(ollamaSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
    });
  });

  it('alerts scrubbed error when OAuth revoke fails and keeps connected badge', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-oauth-1',
          name: 'OAuth MCP',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({
      ok: true,
      data: { connected: true, expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    revokeMcpOAuth.mockResolvedValue({
      ok: false,
      error: `token${'\n'}busy${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('OAuth MCP')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => {
      expect(revokeMcpOAuth).toHaveBeenCalledWith('mcp-oauth-1');
      expect(window.alert).toHaveBeenCalledWith('token busy!');
    });
    expect(screen.getByText('● OAuth')).toBeInTheDocument();
  });

  it('alerts scrubbed error when OAuth start fails and keeps modal open', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-oauth',
          name: 'OAuth Target',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({ ok: true, data: { connected: false } });
    startMcpOAuth.mockResolvedValue({
      ok: false,
      error: `auth${'\n'}down${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<Settings />);
    await waitFor(() => expect(screen.getByText('OAuth Target')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: OAuth Target')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: 'https://auth.example/authorize' },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: 'https://auth.example/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: 'my-client' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));

    await waitFor(() => {
      expect(startMcpOAuth).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('auth down!');
    });
    expect(screen.getByText('Connect: OAuth Target')).toBeInTheDocument();
  });

  it('alerts scrubbed error when simple key save fails', async () => {
    const user = userEvent.setup();
    saveSetting.mockResolvedValue({
      ok: false,
      error: `disk${'\n'}full${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Deploy')).toBeInTheDocument());

    const vercel = screen.getByPlaceholderText('vercel_...');
    await user.type(vercel, 'vercel_tok');
    const vercelRow = vercel.closest('div')!.parentElement!;
    const vercelSave = Array.from(vercelRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(vercelSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('VERCEL_API_TOKEN', 'vercel_tok');
      expect(window.alert).toHaveBeenCalledWith('disk full!');
    });
  });

  it('alerts scrubbed error when simple key save throws', async () => {
    const user = userEvent.setup();
    saveSetting.mockRejectedValue(new Error(`io${'\n'}err${'\0'}!`));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Deploy')).toBeInTheDocument());

    const vercel = screen.getByPlaceholderText('vercel_...');
    await user.type(vercel, 'vercel_tok');
    const vercelRow = vercel.closest('div')!.parentElement!;
    const vercelSave = Array.from(vercelRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(vercelSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('VERCEL_API_TOKEN', 'vercel_tok');
      expect(window.alert).toHaveBeenCalledWith('io err!');
    });
  });

  it('shows disconnected and connecting engine status labels', async () => {
    engine = {
      status: 'disconnected',
      mode: null,
      serverUrl: null,
      client: null,
    };
    const { unmount } = render(<Settings />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(health).not.toHaveBeenCalled();
    unmount();

    engine = {
      status: 'connecting',
      mode: 'client',
      serverUrl: 'http://remote.example',
      client: null,
    };
    render(<Settings />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
  });

  it('saves Tavily and Slack workflow keys', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByPlaceholderText('tvly-...')).toBeInTheDocument());

    const tavily = screen.getByPlaceholderText('tvly-...');
    await user.type(tavily, 'tvly-test-key');
    const tavilyRow = tavily.closest('div')!.parentElement!;
    const tavilySave = Array.from(tavilyRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(tavilySave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('TAVILY_API_KEY', 'tvly-test-key');
    });

    const slack = screen.getByPlaceholderText('xoxb-...');
    await user.type(slack, 'xoxb-test-token');
    const slackRow = slack.closest('div')!.parentElement!;
    const slackSave = Array.from(slackRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(slackSave!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('SLACK_BOT_TOKEN', 'xoxb-test-token');
    });
  });

  it('verifies Google API key and shows verified status then saves', async () => {
    const user = userEvent.setup();
    verifyApiKey.mockResolvedValue({ ok: true, data: { valid: true } });
    render(<Settings />);
    await waitFor(() => expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('AIza...'), 'AIza-test-key');
    // Google verify is the second verify button (anthropic first, google second, openai third)
    const verifyButtons = screen.getAllByRole('button', { name: 'common:action.verify' });
    expect(verifyButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(verifyButtons[1]!);
    await waitFor(() => {
      expect(verifyApiKey).toHaveBeenCalledWith('google', 'AIza-test-key');
    });
    await waitFor(() => {
      expect(screen.getAllByText('settings:apiKeys.verified').length).toBeGreaterThan(0);
    });

    const saveButtons = screen.getAllByRole('button', { name: 'common:action.save' });
    // Google save is second among provider key saves
    fireEvent.click(saveButtons[1]!);
    await waitFor(() => {
      expect(saveSetting).toHaveBeenCalledWith('apiKey.google', 'AIza-test-key');
    });
  });

  it('scrubs control-char MCP server name and CLI agent path display', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'm1',
          name: 'Srv' + String.fromCharCode(0) + 'X',
          transport: 'http',
          url: 'https://mcp.example' + String.fromCharCode(10) + '/v1',
          enabled: true,
        },
        {
          id: 'm2',
          name: 'Local' + String.fromCharCode(10) + 'MCP',
          transport: 'stdio',
          command: 'npx' + String.fromCharCode(0),
          args: ['-y', 'pkg' + String.fromCharCode(10) + 'x', 'bad\0arg'],
          enabled: true,
        },
      ],
    });
    listCliAgents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'cli' + String.fromCharCode(0) + 'claude',
          name: 'Claude' + String.fromCharCode(10) + 'Code',
          path: '/usr/bin/claude' + String.fromCharCode(0),
          version: '1.0' + String.fromCharCode(10) + 'x',
          available: true,
        },
      ],
    });
    health.mockResolvedValue({ status: 'ok', version: '0.3.1' + String.fromCharCode(10) + 'z', uptime: 10 });
    engine.status = 'connected';
    engine.serverUrl = 'http://127.0.0.1:1' + String.fromCharCode(0);
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('SrvX')).toBeInTheDocument());
    // URL newline collapsed to space
    expect(document.body.textContent).toMatch(/mcp\.example/);
    // stdio: control-char command omitted entirely; only control-free args shown
    expect(document.body.textContent).toMatch(/Local MCP/);
    expect(document.body.textContent).toMatch(/-y/);
    expect(document.body.textContent).not.toMatch(/badarg|pkg x/);
    await waitFor(() => {
      // Scrubbed CLI path (null-byte stripped) + name/id
      expect(document.body.textContent).toContain('/usr/bin/claude');
      expect(document.body.textContent).toMatch(/Claude Code/);
      expect(document.body.textContent).toMatch(/1\.0 x/);
      expect(document.body.textContent).toMatch(/cliclaude/);
    });
    // Engine version + URL scrubbed
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/v0\.3\.1 z/);
      expect(document.body.textContent).toContain('http://127.0.0.1:1');
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('hides engine URL row when scrubbed URL is blank and scrubs OAuth title', async () => {
    engine.status = 'connected';
    // Control-only URL scrubs empty → URL row omitted
    engine.serverUrl = String.fromCharCode(0) + String.fromCharCode(10);
    health.mockResolvedValue({ status: 'ok', version: '0.3.140', uptime: 12 });
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-oauth-title',
          name: 'Auth' + String.fromCharCode(10) + 'Srv' + String.fromCharCode(0) + 'X',
          transport: 'http',
          url: 'https://mcp.example/v1',
          enabled: true,
          oauth: { configured: true, connected: false },
        },
      ],
    });

    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(health).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/v0\.3\.140/);
    });
    // Blank-after-scrub URL must not render a URL row value of pure whitespace/control
    expect(document.body.textContent).not.toContain('\0');
    // No raw control-only URL fragment shown as a cell
    const dts = Array.from(document.querySelectorAll('dt')).map((el) => el.textContent);
    // If URL label is present, its sibling must not be empty control junk
    if (dts.includes('URL')) {
      const urlDt = Array.from(document.querySelectorAll('dt')).find((el) => el.textContent === 'URL');
      const urlDd = urlDt?.nextElementSibling?.textContent ?? '';
      expect(urlDd.trim().length).toBeGreaterThan(0);
      expect(urlDd).not.toMatch(/[\0\r\n]/);
    }

    await waitFor(() => expect(screen.getByText(/Auth SrvX|AuthSrvX/)).toBeInTheDocument());
    // Open OAuth connect UI if available
    const connectBtns = screen.queryAllByRole('button', { name: /oauth|connect/i });
    if (connectBtns.length > 0) {
      await user.click(connectBtns[0]!);
      await waitFor(() => {
        expect(document.body.textContent).toMatch(/Connect:.*Auth/);
      });
      expect(document.body.textContent).not.toContain('\0');
    }
  });

  it('surfaces scrubbed engine health error when health throws', async () => {
    engine.status = 'connected';
    health.mockRejectedValue(new Error(`health${'\n'}down${'\0'}!`));
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('health down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    // Version/uptime fall back to dashes
    expect(document.body.textContent).toMatch(/Version/);
  });

  it('surfaces health error when status is not ok', async () => {
    engine.status = 'connected';
    health.mockResolvedValue({ status: 'degraded', version: '0.3.1', uptime: 1 });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Health check failed')).toBeInTheDocument();
    });
  });

  it('keeps MCP server list when OAuth status probe throws', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'mcp-keep',
          name: 'Keep Me',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'pkg'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockRejectedValue(new Error('oauth status boom'));
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Keep Me')).toBeInTheDocument();
    });
    // List load error must not appear — servers survived OAuth probe failure
    expect(screen.queryByText(/Failed to load MCP/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/oauth status boom/i)).not.toBeInTheDocument();
  });

  it('rejects MCP toggle/delete/revoke when server id has control chars', async () => {
    listMcpServers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `mcp${'\0'}evil`,
          name: 'Evil MCP',
          transport: 'http',
          command: null,
          args: null,
          url: 'https://mcp.example/sse',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getMcpOAuthStatus.mockResolvedValue({
      ok: true,
      data: { connected: true, expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Evil MCP')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument());

    // Disconnect = revoke
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(revokeMcpOAuth).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('MCP server id contains invalid control characters');

    // Walk up from name to the card row that holds action buttons
    let el: HTMLElement | null = screen.getByText('Evil MCP');
    let actionButtons: HTMLButtonElement[] = [];
    for (let i = 0; i < 8 && el; i++) {
      const btns = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
      if (btns.length >= 3) {
        actionButtons = btns;
        break;
      }
      el = el.parentElement;
    }
    expect(actionButtons.length).toBeGreaterThanOrEqual(3);

    alertSpy.mockClear();
    // Toggle: switch-like button without text content
    const toggleBtn =
      actionButtons.find((b) => !(b.textContent || '').trim()) ?? actionButtons[1]!;
    fireEvent.click(toggleBtn);
    expect(toggleMcpServer).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('MCP server id contains invalid control characters');

    alertSpy.mockClear();
    // Delete is the last action button (X icon)
    fireEvent.click(actionButtons[actionButtons.length - 1]!);
    expect(deleteMcpServer).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('MCP server id contains invalid control characters');
    alertSpy.mockRestore();
  });

});
