/**
 * Engine connection context and hook.
 * Manages connection state to the NEOS Work engine server.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { EngineClient } from '../lib/engine.js';
import { scrubDisplayText } from '../lib/format-duration.js';
import { startEngine, stopEngine, getAuthToken, getEnginePort } from '../lib/tauri.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type AppMode = 'host' | 'client';

interface EngineState {
  status: ConnectionStatus;
  mode: AppMode | null;
  serverUrl: string | null;
  error: string | null;
  client: EngineClient | null;
}

interface EngineContextValue extends EngineState {
  connect: (mode: AppMode, url?: string) => Promise<void>;
  disconnect: () => void;
}

const EngineContext = createContext<EngineContextValue | null>(null);

const DEFAULT_HOST_URL = 'http://127.0.0.1:57286';
const HEALTH_CHECK_INTERVAL = 5000;
const HOST_PORT_POLL_ATTEMPTS = 5;
const HOST_PORT_POLL_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EngineState>({
    status: 'disconnected',
    mode: null,
    serverUrl: null,
    error: null,
    client: null,
  });
  const healthIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthFailCountRef = useRef(0);

  const stopHealthCheck = useCallback(() => {
    if (healthIntervalRef.current) {
      clearTimeout(healthIntervalRef.current);
      healthIntervalRef.current = null;
    }
    healthFailCountRef.current = 0;
  }, []);

  const startHealthCheck = useCallback(
    (client: EngineClient) => {
      stopHealthCheck();

      const scheduleNext = () => {
        // Exponential backoff on failure: 5s, 10s, 20s, 40s, max 60s
        const delay =
          healthFailCountRef.current === 0
            ? HEALTH_CHECK_INTERVAL
            : Math.min(HEALTH_CHECK_INTERVAL * 2 ** healthFailCountRef.current, 60_000);

        healthIntervalRef.current = setTimeout(async () => {
          const ok = await client.checkConnection();
          if (ok) {
            healthFailCountRef.current = 0;
            setState((prev) =>
              prev.status === 'error' ? { ...prev, status: 'connected', error: null } : prev,
            );
          } else {
            healthFailCountRef.current++;
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: 'Lost connection to engine',
            }));
          }
          scheduleNext();
        }, delay);
      };

      scheduleNext();
    },
    [stopHealthCheck],
  );

  const connect = useCallback(
    async (mode: AppMode, url?: string) => {
      let serverUrl = mode === 'host' ? DEFAULT_HOST_URL : url ?? '';

      setState({
        status: 'connecting',
        mode,
        serverUrl,
        error: null,
        client: null,
      });

      // Host: reuse a healthy local daemon; only spawn if nothing is listening.
      // Sidecar (production) or Node @neos-work/server (dev placeholder sidecar)
      // is started by Tauri; stopEngine only kills a child this app stored.
      let startedHostEngine = false;
      if (mode === 'host') {
        const probe = new EngineClient(DEFAULT_HOST_URL);
        const alreadyUp = await probe.checkConnection();
        if (!alreadyUp) {
          startedHostEngine = await startEngine();
          for (let i = 0; i < HOST_PORT_POLL_ATTEMPTS; i++) {
            const port = await getEnginePort();
            if (port) {
              serverUrl = `http://127.0.0.1:${port}`;
              break;
            }
            if (i < HOST_PORT_POLL_ATTEMPTS - 1) await delay(HOST_PORT_POLL_MS);
          }
        }
      }

      const client = new EngineClient(serverUrl);

      const maxRetries = mode === 'host' ? (startedHostEngine ? 30 : 20) : 3;
      const retryDelay = mode === 'host' ? 500 : 1000;

      for (let i = 0; i < maxRetries; i++) {
        const ok = await client.checkConnection();
        if (ok) {
          // Set auth token: sessionStorage override takes priority over Tauri sidecar token
          // Control-char tokens never applied (EngineClient.setAuthToken also rejects)
          const overrideToken = sessionStorage.getItem('devAuthToken');
          const tauriToken = await getAuthToken();
          const explicit = overrideToken ?? tauriToken;
          if (typeof explicit === 'string' && explicit && !/[\0\r\n]/.test(explicit) && explicit.trim()) {
            client.setAuthToken(explicit);
          } else if (mode === 'host') {
            // Sidecar stub / separately started daemon: loopback bootstrap
            const local = await client.fetchLocalAuthToken();
            if (local) client.setAuthToken(local);
            else {
              setState({
                status: 'error',
                mode,
                serverUrl,
                error: 'Local engine is running but did not provide an auth token',
                client: null,
              });
              return;
            }
          }

          setState({
            status: 'connected',
            mode,
            serverUrl,
            error: null,
            client,
          });
          startHealthCheck(client);
          return;
        }
        await new Promise((r) => setTimeout(r, retryDelay));
      }

      const urlSafe =
        scrubDisplayText(serverUrl, { collapseLines: true, maxChars: 200 }) || 'server';
      setState({
        status: 'error',
        mode,
        serverUrl,
        error: `Could not connect to engine at ${urlSafe}`,
        client: null,
      });
    },
    [startHealthCheck],
  );

  const disconnect = useCallback(() => {
    stopHealthCheck();
    // Stop engine sidecar if running
    stopEngine();
    setState({
      status: 'disconnected',
      mode: null,
      serverUrl: null,
      error: null,
      client: null,
    });
  }, [stopHealthCheck]);

  return (
    <EngineContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used within EngineProvider');
  return ctx;
}
