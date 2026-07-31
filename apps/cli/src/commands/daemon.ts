import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { formatServerLabel } from '../config.js';
import {
  defaultDaemonSessionPath,
  readDaemonSession,
  startDaemonProcess,
  writeDaemonSession,
  type SpawnFn,
} from '../daemon-start.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { flagValue, printJson, type CmdContext } from '../util.js';

export interface DaemonCmdDeps {
  startDaemon?: typeof startDaemonProcess;
  sessionPath?: string;
  spawnFn?: SpawnFn;
}

/**
 * daemon status|start|stop
 * start spawns the engine and prints export lines for the new token.
 */
export async function cmdDaemon(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
  deps: DaemonCmdDeps = {},
): Promise<ExitCode> {
  const sub = rest[0] ?? 'status';
  const sessionPath = deps.sessionPath ?? defaultDaemonSessionPath();

  if (sub === 'status') {
    try {
      const h = await client.health();
      if (ctx.json) {
        printJson(ctx, { running: true, server: cfg.serverUrl, health: h.data });
      } else {
        ctx.out(`running  ${formatServerLabel(cfg)}`);
        if (h.data?.version) ctx.out(`version  ${h.data.version}`);
      }
      return EXIT.OK;
    } catch {
      if (ctx.json) printJson(ctx, { running: false, server: cfg.serverUrl });
      else ctx.err(`not running  ${formatServerLabel(cfg)}`);
      return EXIT.DAEMON_DOWN;
    }
  }

  if (sub === 'start') {
    // If already healthy, report
    try {
      await client.health();
      if (ctx.json) {
        printJson(ctx, { alreadyRunning: true, server: cfg.serverUrl });
      } else {
        ctx.out(`already running  ${formatServerLabel(cfg)}`);
      }
      return EXIT.OK;
    } catch {
      // proceed to start
    }

    const portRaw = flagValue(rest, '--port');
    const port = portRaw ? Number(portRaw) : undefined;
    const entry = flagValue(rest, '--entry');
    const start = deps.startDaemon ?? startDaemonProcess;

    try {
      const result = await start({
        port: Number.isFinite(port) ? port : undefined,
        serverEntry: entry,
        spawnFn: deps.spawnFn,
        onLine: (line) => {
          if (!ctx.json && line.startsWith('NEOS_')) {
            // don't echo token lines unless json path; token printed once below
          }
        },
      });
      try {
        writeDaemonSession(sessionPath, {
          pid: result.pid,
          port: result.port,
          token: result.token,
          serverUrl: result.serverUrl,
        });
      } catch {
        // non-fatal
      }
      if (ctx.json) {
        printJson(ctx, {
          started: true,
          pid: result.pid,
          port: result.port,
          serverUrl: result.serverUrl,
          token: result.token,
          sessionPath,
        });
      } else {
        ctx.out(`started  pid=${result.pid}  ${result.serverUrl}`);
        ctx.out(`export NEOS_SERVER_URL='${result.serverUrl}'`);
        ctx.out(`export NEOS_AUTH_TOKEN='${result.token}'`);
        ctx.out(`# session: ${sessionPath}`);
      }
      return EXIT.OK;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start daemon';
      ctx.err(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 500));
      return EXIT.INTERNAL;
    }
  }

  if (sub === 'stop') {
    const session = readDaemonSession(sessionPath);
    if (!session) {
      ctx.err(`No CLI daemon session at ${sessionPath}`);
      return EXIT.NOT_FOUND;
    }
    try {
      process.kill(session.pid, 'SIGTERM');
      if (ctx.json) printJson(ctx, { stopped: true, pid: session.pid });
      else ctx.out(`stopped  pid=${session.pid}`);
      return EXIT.OK;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'kill failed';
      ctx.err(msg);
      return EXIT.INTERNAL;
    }
  }

  ctx.err('usage: neos daemon status|start|stop');
  return EXIT.USAGE;
}
