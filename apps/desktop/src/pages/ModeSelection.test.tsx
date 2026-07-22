import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const connect = vi.fn(async () => undefined);
let engineState = {
  status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
  error: null as string | null,
  connect,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => engineState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { ModeSelection } = await import('./ModeSelection.js');

describe('ModeSelection', () => {
  beforeEach(() => {
    connect.mockReset();
    engineState = {
      status: 'disconnected',
      error: null,
      connect,
    };
    sessionStorage.clear();
    localStorage.clear();
  });

  it('renders host and client mode cards', () => {
    render(<ModeSelection />);
    expect(screen.getByText('mode.host.title')).toBeInTheDocument();
    expect(screen.getByText('mode.client.title')).toBeInTheDocument();
    expect(screen.getByText('connection.disconnected')).toBeInTheDocument();
  });

  it('shows connecting and error status copy', () => {
    engineState = { status: 'connecting', error: null, connect };
    const { rerender } = render(<ModeSelection />);
    expect(screen.getAllByText('connection.connecting').length).toBeGreaterThan(0);

    engineState = { status: 'error', error: 'Could not connect', connect };
    rerender(<ModeSelection />);
    expect(screen.getByText('Could not connect')).toBeInTheDocument();
  });

  it('connects as host without remote url', async () => {
    const user = userEvent.setup();
    render(<ModeSelection />);
    await user.click(screen.getByRole('button', { name: /mode.host.title/i }));
    expect(connect).toHaveBeenCalledWith('host', undefined);
  });

  it('does not connect as client without remote url', async () => {
    const user = userEvent.setup();
    render(<ModeSelection />);
    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    expect(connectBtn).toBeDisabled();
    await user.click(connectBtn);
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects as client with remote url and optional bearer token', async () => {
    const user = userEvent.setup();
    render(<ModeSelection />);

    const urlInput = screen.getByPlaceholderText('http://192.168.1.100:57286');
    const tokenInput = screen.getByPlaceholderText('Bearer token (optional)');
    await user.type(urlInput, 'http://10.0.0.5:57286');
    await user.type(tokenInput, 'tok-dev');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(sessionStorage.getItem('devAuthToken')).toBe('tok-dev');
    expect(localStorage.getItem('neos-remote-url')).toBe('http://10.0.0.5:57286');
    expect(connect).toHaveBeenCalledWith('client', 'http://10.0.0.5:57286');
  });

  it('disables host while connecting', () => {
    engineState = { status: 'connecting', error: null, connect };
    render(<ModeSelection />);
    const hostBtn = screen.getByRole('button', { name: /mode.host.title/i });
    expect(hostBtn).toBeDisabled();
  });

  it('Escape clears dev token and preventDefault', async () => {
    const user = userEvent.setup();
    render(<ModeSelection />);
    const tokenInput = screen.getByPlaceholderText('Bearer token (optional)');
    await user.type(tokenInput, 'secret');
    expect((tokenInput as HTMLInputElement).value).toBe('secret');

    // wait for effect to attach (depends on devToken)
    await waitFor(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Bearer token (optional)') as HTMLInputElement).value).toBe('');
    });
  });

  it('ignores Escape when defaultPrevented already set', async () => {
    const user = userEvent.setup();
    render(<ModeSelection />);
    const tokenInput = screen.getByPlaceholderText('Bearer token (optional)');
    await user.type(tokenInput, 'keep');

    // ensure listener attached
    await waitFor(() => {
      const probe = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      // will clear if not stopped — re-type after this probe if needed
    });

    // re-set token if probe cleared it
    if ((tokenInput as HTMLInputElement).value !== 'keep') {
      await user.clear(tokenInput);
      await user.type(tokenInput, 'keep');
    }

    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);

    expect((screen.getByPlaceholderText('Bearer token (optional)') as HTMLInputElement).value).toBe('keep');
  });

  it('does not clear token via Escape while connecting', async () => {
    const user = userEvent.setup();
    engineState = { status: 'disconnected', error: null, connect };
    const { rerender } = render(<ModeSelection />);
    const tokenInput = screen.getByPlaceholderText('Bearer token (optional)');
    await user.type(tokenInput, 'busy');

    engineState = { status: 'connecting', error: null, connect };
    rerender(<ModeSelection />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect((screen.getByPlaceholderText('Bearer token (optional)') as HTMLInputElement).value).toBe('busy');
  });
});
