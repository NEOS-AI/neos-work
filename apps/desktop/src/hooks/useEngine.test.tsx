import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const startEngine = vi.fn(async () => false);
const stopEngine = vi.fn(async () => undefined);
const getAuthToken = vi.fn(async () => null as string | null);
const getEnginePort = vi.fn(async () => null as number | null);

vi.mock('../lib/tauri.js', () => ({
  startEngine: (...args: unknown[]) => startEngine(...args),
  stopEngine: (...args: unknown[]) => stopEngine(...args),
  getAuthToken: (...args: unknown[]) => getAuthToken(...args),
  getEnginePort: (...args: unknown[]) => getEnginePort(...args),
}));

const checkConnection = vi.fn(async () => false);
const setAuthToken = vi.fn();

vi.mock('../lib/engine.js', () => {
  class EngineClient {
    baseUrl: string;
    constructor(url: string) {
      this.baseUrl = url;
    }
    get url() {
      return this.baseUrl;
    }
    checkConnection = (...args: unknown[]) => checkConnection(...args);
    setAuthToken = (...args: unknown[]) => setAuthToken(...args);
  }
  return { EngineClient };
});

const { EngineProvider, useEngine } = await import('./useEngine.js');

function Probe() {
  const { status, mode, serverUrl, error, client, connect, disconnect } = useEngine();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="mode">{mode ?? 'null'}</span>
      <span data-testid="url">{serverUrl ?? 'null'}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <span data-testid="client">{client ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => void connect('host')}>
        host
      </button>
      <button type="button" onClick={() => void connect('client', 'http://192.168.1.10:57286')}>
        client
      </button>
      <button type="button" onClick={() => disconnect()}>
        disconnect
      </button>
    </div>
  );
}

describe('useEngine / EngineProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    startEngine.mockReset().mockResolvedValue(false);
    stopEngine.mockReset().mockResolvedValue(undefined);
    getAuthToken.mockReset().mockResolvedValue(null);
    getEnginePort.mockReset().mockResolvedValue(null);
    checkConnection.mockReset().mockResolvedValue(false);
    setAuthToken.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it('throws outside provider', () => {
    expect(() => render(<Probe />)).toThrow(/EngineProvider/);
  });

  it('starts disconnected', () => {
    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('disconnected');
    expect(screen.getByTestId('mode').textContent).toBe('null');
    expect(screen.getByTestId('client').textContent).toBe('no');
  });

  it('connect host succeeds, uses sidecar port/token, and disconnects', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkConnection.mockResolvedValue(true);
    getEnginePort.mockResolvedValue(60_001);
    getAuthToken.mockResolvedValue('sidecar-token');

    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'host' }));

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('connected');
    });

    expect(startEngine).toHaveBeenCalled();
    expect(screen.getByTestId('mode').textContent).toBe('host');
    expect(screen.getByTestId('url').textContent).toBe('http://127.0.0.1:60001');
    expect(screen.getByTestId('client').textContent).toBe('yes');
    expect(setAuthToken).toHaveBeenCalledWith('sidecar-token');

    await user.click(screen.getByRole('button', { name: 'disconnect' }));
    expect(stopEngine).toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('disconnected');
    expect(screen.getByTestId('client').textContent).toBe('no');
  });

  it('prefers sessionStorage devAuthToken over sidecar token', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    sessionStorage.setItem('devAuthToken', 'dev-override');
    checkConnection.mockResolvedValue(true);
    getAuthToken.mockResolvedValue('sidecar-token');

    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'client' }));
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('connected');
    });
    expect(setAuthToken).toHaveBeenCalledWith('dev-override');
    expect(screen.getByTestId('url').textContent).toBe('http://192.168.1.10:57286');
    // client mode should not start sidecar
    expect(startEngine).not.toHaveBeenCalled();
  });

  it('sets error when client retries exhaust', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkConnection.mockResolvedValue(false);

    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );

    // client mode: 3 retries × 1000ms (faster than host's 20 × 500ms)
    const clickPromise = user.click(screen.getByRole('button', { name: 'client' }));
    await act(async () => {
      // advance past connecting → retries
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
    });
    await clickPromise;

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });

    expect(screen.getByTestId('error').textContent).toMatch(
      /Could not connect to engine at http:\/\/192\.168\.1\.10:57286/,
    );
    expect(screen.getByTestId('client').textContent).toBe('no');
    expect(checkConnection.mock.calls.length).toBe(3);
  });

  it('scrubs control chars from connect failure server URL in error', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkConnection.mockResolvedValue(false);
    // Probe uses default remote URL from its button handler — exercise connect via URL with controls
    // by calling connect through a custom harness below would need Probe change; instead assert scrub helper path
    // via a direct EngineProvider consumer:
    function CustomProbe() {
      const { error, connect, status } = useEngine();
      return (
        <div>
          <button
            type="button"
            onClick={() => void connect('client', `http://evil.example/${'\0'}x${'\n'}y`)}
          >
            dirty
          </button>
          <span data-testid="status">{status}</span>
          <span data-testid="error">{error ?? ''}</span>
        </div>
      );
    }
    render(
      <EngineProvider>
        <CustomProbe />
      </EngineProvider>,
    );
    const clickPromise = user.click(screen.getByRole('button', { name: 'dirty' }));
    await act(async () => {
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
    });
    await clickPromise;
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    const msg = screen.getByTestId('error').textContent ?? '';
    expect(msg).toMatch(/Could not connect to engine at/);
    expect(msg).not.toContain('\0');
    expect(msg).not.toMatch(/[\r\n]/);
    expect(msg).toMatch(/evil\.example/);
  });

  it('sets error when host mode retries exhaust', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkConnection.mockResolvedValue(false);
    startEngine.mockResolvedValue(false);
    getEnginePort.mockResolvedValue(null);

    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );

    const clickPromise = user.click(screen.getByRole('button', { name: 'host' }));
    await act(async () => {
      // host waits 1s for sidecar, then 20 × 500ms retries
      await vi.advanceTimersByTimeAsync(1000);
      for (let i = 0; i < 25; i++) {
        await vi.advanceTimersByTimeAsync(500);
      }
    });
    await clickPromise;

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(startEngine).toHaveBeenCalled();
    expect(screen.getByTestId('error').textContent).toMatch(
      /Could not connect to engine at http:\/\/127\.0\.0\.1:57286/,
    );
    expect(checkConnection.mock.calls.length).toBe(20);
  });

  it('health check marks lost connection then recovers', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkConnection.mockResolvedValue(true);

    render(
      <EngineProvider>
        <Probe />
      </EngineProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'client' }));
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('connected');
    });

    // Next health poll fails
    checkConnection.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('error').textContent).toMatch(/Lost connection/);

    // Later poll recovers
    checkConnection.mockResolvedValue(true);
    await act(async () => {
      // backoff: failCount=1 → 10s
      await vi.advanceTimersByTimeAsync(10_100);
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('connected');
    });
    expect(screen.getByTestId('error').textContent).toBe('null');
  });
});
