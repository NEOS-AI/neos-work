import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const disconnect = vi.fn();
const health = vi.fn(async () => ({ status: 'ok', version: '0.3.54' }));

let engine = {
  status: 'connected' as string,
  mode: 'host' as string | null,
  serverUrl: 'http://127.0.0.1:57286' as string | null,
  disconnect,
  client: { health } as { health: typeof health } | null,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => engine,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { Sidebar } = await import('./Sidebar.js');

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    disconnect.mockReset();
    health.mockReset().mockResolvedValue({ status: 'ok', version: '0.3.54' });
    engine = {
      status: 'connected',
      mode: 'host',
      serverUrl: 'http://127.0.0.1:57286',
      disconnect,
      client: { health },
    };
  });

  it('renders primary nav destinations', () => {
    renderSidebar();
    expect(screen.getByText('nav.dashboard')).toBeInTheDocument();
    expect(screen.getByText('nav.sessions')).toBeInTheDocument();
    expect(screen.getByText('nav.workflows')).toBeInTheDocument();
    expect(screen.getByText('nav.settings')).toBeInTheDocument();
    expect(screen.getByText('nav.media')).toBeInTheDocument();
  });

  it('shows connected status, server url, and engine version', async () => {
    renderSidebar();
    expect(screen.getByText('connection.connected')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:57286')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Engine v0\.3\.54/)).toBeInTheDocument();
    });
    expect(screen.getByText(/· host/)).toBeInTheDocument();
  });

  it('shows disconnected status without health fetch', () => {
    engine = {
      status: 'disconnected',
      mode: null,
      serverUrl: null,
      disconnect,
      client: null,
    };
    renderSidebar();
    expect(screen.getByText('connection.disconnected')).toBeInTheDocument();
    expect(health).not.toHaveBeenCalled();
  });

  it('shows connecting status', () => {
    engine = {
      status: 'connecting',
      mode: 'client',
      serverUrl: 'http://x',
      disconnect,
      client: null,
    };
    renderSidebar();
    expect(screen.getByText('connection.connecting')).toBeInTheDocument();
  });

  it('calls disconnect when disconnect button clicked', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'connection.stop' }));
    expect(disconnect).toHaveBeenCalled();
  });

  it('hides disconnect when not connected', () => {
    engine = {
      status: 'error',
      mode: 'host',
      serverUrl: 'http://x',
      disconnect,
      client: null,
    };
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'connection.stop' })).not.toBeInTheDocument();
  });

  it('swallows health errors without crashing', async () => {
    health.mockRejectedValue(new Error('offline'));
    renderSidebar();
    await waitFor(() => {
      expect(health).toHaveBeenCalled();
    });
    expect(screen.getByText('connection.connected')).toBeInTheDocument();
    expect(screen.queryByText(/Engine v/)).not.toBeInTheDocument();
  });
});
