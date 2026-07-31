import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { formatServerLabel } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { printJson, type CmdContext } from '../util.js';

/**
 * daemon status — discover/reachability only.
 * start/stop are owned by desktop Tauri sidecar or process manager (documented).
 */
export async function cmdDaemon(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'status';
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
  if (sub === 'start' || sub === 'stop') {
    ctx.err(
      `neos daemon ${sub}: start/stop the engine via desktop Host Mode or \`pnpm --filter @neos-work/server dev\`. CLI only discovers status.`,
    );
    return EXIT.USAGE;
  }
  ctx.err('usage: neos daemon status');
  return EXIT.USAGE;
}
