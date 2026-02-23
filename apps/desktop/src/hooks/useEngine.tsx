/**
 * Engine connection context and hook.
 * Manages connection state to the NEOS Work engine server.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { EngineClient } from '../lib/engine.js';
import { startEngine, stopEngine } from '../lib/tauri.js';

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
      const serverUrl = mode === 'host' ? DEFAULT_HOST_URL : url ?? '';
      const client = new EngineClient(serverUrl);

      setState({
        status: 'connecting',
        mode,
        serverUrl,
        error: null,
        client,
      });

      // For host mode, try starting the engine via Tauri sidecar.
      // If sidecar is unavailable (dev mode), the server must be running manually.
      if (mode === 'host') {
        await startEngine();
      }

      const maxRetries = mode === 'host' ? 20 : 3;
      const retryDelay = mode === 'host' ? 500 : 1000;

      for (let i = 0; i < maxRetries; i++) {
        const ok = await client.checkConnection();
        if (ok) {
          // Load saved API keys before marking as connected
          await client.loadApiKeys();
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

      setState({
        status: 'error',
        mode,
        serverUrl,
        error: `Could not connect to engine at ${serverUrl}`,
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
