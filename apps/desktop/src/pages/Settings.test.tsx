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
    revokeMcpOAuth.mockReset().mockResolvedValue({ ok: true });
    startMcpOAuth.mockReset().mockResolvedValue({ ok: true, data: { authUrl: 'https://auth.example' } });
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
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Remote MCP')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
    await waitFor(() => expect(screen.getByText('Connect: Remote MCP')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: `https://auth.example${'\0'}/authorize` },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: 'https://auth.example/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: 'client-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));
    expect(startMcpOAuth).not.toHaveBeenCalled();

    // Blank-after-trim required fields no-op
    fireEvent.change(screen.getByPlaceholderText('Authorization Endpoint'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Token Endpoint'), {
      target: { value: 'https://auth.example/token' },
    });
    fireEvent.change(screen.getByPlaceholderText('Client ID'), {
      target: { value: 'client-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Browser/i }));
    expect(startMcpOAuth).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByPlaceholderText('Override Bearer token'), {
      target: { value: `tok${'\0'}bad` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(sessionStorage.getItem('devAuthToken')).toBeNull();
    expect(setAuthToken).not.toHaveBeenCalled();

    // Simple key (Tavily) control-char rejected
    const tavily = screen.getByPlaceholderText(/tvly-/i);
    fireEvent.change(tavily, { target: { value: `tvly${'\0'}bad` } });
    // nearest Save in the same row
    const row = tavily.closest('div')?.parentElement;
    const saveBtn = row?.querySelector('button');
    if (saveBtn) fireEvent.click(saveBtn);
    expect(saveSetting).not.toHaveBeenCalledWith('TAVILY_API_KEY', expect.anything());

    // Provider API key verify/save reject control chars
    const anthropic = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(anthropic, { target: { value: `sk-ant${'\0'}bad` } });
    const verifyButtons = screen.getAllByRole('button', { name: 'common:action.verify' });
    fireEvent.click(verifyButtons[0]!);
    expect(verifyApiKey).not.toHaveBeenCalled();
    const saveButtons = screen.getAllByRole('button', { name: 'common:action.save' });
    fireEvent.click(saveButtons[0]!);
    expect(saveSetting).not.toHaveBeenCalledWith('apiKey.anthropic', expect.anything());
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
      .mockResolvedValueOnce({ ok: false, error: 'boom' })
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
      expect(screen.getByText('Failed to load CLI agents')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '↺ Refresh' }));
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
      expect(screen.queryByText('Failed to load CLI agents')).not.toBeInTheDocument();
    });
  });

  it('keeps MCP add form open when createMcpServer fails', async () => {
    const user = userEvent.setup();
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    createMcpServer.mockResolvedValue({ ok: false, error: 'name taken' });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Server name'), 'Dup');
    await user.type(screen.getByPlaceholderText('Command (e.g. npx)'), 'npx');
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    await waitFor(() => expect(createMcpServer).toHaveBeenCalled());
    // Form stays open for correction
    expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument();
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('rejects control-char MCP name/command/url without calling API', async () => {
    listMcpServers.mockResolvedValue({ ok: true, data: [] });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Server name')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Server name'), {
      target: { value: `bad${'\0'}name` },
    });
    fireEvent.change(screen.getByPlaceholderText('Command (e.g. npx)'), {
      target: { value: 'npx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Server name'), {
      target: { value: 'ok-name' },
    });
    fireEvent.change(screen.getByPlaceholderText('Command (e.g. npx)'), {
      target: { value: `npx${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();

    // HTTP transport: control-char URL rejected
    fireEvent.click(screen.getByRole('button', { name: 'http' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Server URL (e.g. http://localhost:3000/sse)')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText('Server URL (e.g. http://localhost:3000/sse)'), {
      target: { value: `http://x${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
    expect(createMcpServer).not.toHaveBeenCalled();
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
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('OAuth MCP')).toBeInTheDocument());
    expect(screen.getByText('● OAuth')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(revokeMcpOAuth).toHaveBeenCalledWith('mcp-oauth-1'));

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
});
