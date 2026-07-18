/**
 * Process-local runtime context for the engine server.
 * Auth token and listen port are set at startup (index.ts) and read by
 * CLI spawn / workflow helpers so child processes can call back into the API.
 */

let authToken = '';
let port = 3000;

export function setRuntimeContext(ctx: { authToken: string; port: number }): void {
  authToken = ctx.authToken;
  port = ctx.port;
}

export function getRuntimeAuthToken(): string {
  return authToken;
}

export function getRuntimeServerUrl(): string {
  return `http://127.0.0.1:${port}`;
}

export function getRuntimePort(): number {
  return port;
}
