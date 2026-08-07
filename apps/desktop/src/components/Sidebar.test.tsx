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

  it('renders full nav catalog including secondary destinations', () => {
    renderSidebar();
    for (const id of [
      'dashboard',
      'sessions',
      'workflows',
      'projects',
      'workers',
      'blocks',
      'templates',
      'skills',
      'memory',
      'design-systems',
      'routines',
      'plugins',
      'deployments',
      'media',
      'settings',
    ]) {
      expect(screen.getByText(`nav.${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText('app.name')).toBeInTheDocument();
    // NavLink hrefs
    expect(screen.getByRole('link', { name: /nav\.deployments/i })).toHaveAttribute(
      'href',
      '/deployments',
    );
    expect(screen.getByRole('link', { name: /nav\.templates/i })).toHaveAttribute('href', '/templates');
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

  it('scrubs control-char engine version from health', async () => {
    health.mockResolvedValue({
      status: 'ok',
      version: `0.3.54${'\n'}x${'\0'}`,
    });
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText(/Engine v0\.3\.54 x/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
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

  it('shows client mode without local-only assumptions', async () => {
    engine = {
      status: 'connected',
      mode: 'client',
      serverUrl: 'https://remote.example:8443',
      disconnect,
      client: { health },
    };
    renderSidebar();
    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.getByText('https://remote.example:8443')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Engine v0\.3\.54 · client/)).toBeInTheDocument();
    });
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

  it('scrubs control-char engine version and remote URL', async () => {
    health.mockResolvedValue({ status: 'ok', version: '0.3.54' + String.fromCharCode(10) + 'evil' });
    engine = {
      status: 'connected',
      mode: 'client',
      serverUrl: 'https://remote.example' + String.fromCharCode(0) + '.app',
      disconnect: vi.fn(),
      client: { health },
    };
    renderSidebar();
    await waitFor(() => expect(health).toHaveBeenCalled());
    // null-byte stripped from URL display
    expect(screen.getByText('https://remote.example.app')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Engine v0\.3\.54 evil · client/)).toBeInTheDocument();
    });
  });

  it('scrubs control-char mode token in engine footer', async () => {
    health.mockResolvedValue({ status: 'ok', version: '1.2.3' });
    engine = {
      status: 'connected',
      mode: 'cli' + String.fromCharCode(0) + 'ent' + String.fromCharCode(10) + 'x',
      serverUrl: null,
      disconnect: vi.fn(),
      client: { health },
    };
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText(/Engine v1\.2\.3 · client x|Engine v1\.2\.3 · clientx/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(document.body.textContent).not.toMatch(/cli\0ent/);
  });

});
