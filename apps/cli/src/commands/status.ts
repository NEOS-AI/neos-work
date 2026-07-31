import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { formatServerLabel } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { printJson, type CmdContext } from '../util.js';

export async function cmdStatus(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
): Promise<ExitCode> {
  try {
    const res = await client.health();
    const data = res.data ?? { status: 'ok' };
    if (ctx.json) {
      printJson(ctx, {
        server: cfg.serverUrl,
        authenticated: Boolean(cfg.authToken),
        projectId: cfg.projectId,
        health: data,
      });
    } else {
      ctx.out(`server:  ${formatServerLabel(cfg)}`);
      ctx.out(`auth:    ${cfg.authToken ? 'token set' : 'none'}`);
      ctx.out(`health:  ${data.status ?? 'ok'}`);
      if (data.version) ctx.out(`version: ${data.version}`);
      if (typeof data.uptime === 'number') ctx.out(`uptime:  ${data.uptime}s`);
      if (cfg.projectId) ctx.out(`project: ${cfg.projectId}`);
    }
    return data.status === 'ok' || data.status == null ? EXIT.OK : EXIT.DAEMON_DOWN;
  } catch {
    if (ctx.json) {
      printJson(ctx, { server: cfg.serverUrl, health: { status: 'down' } });
    } else {
      ctx.err(`daemon down at ${formatServerLabel(cfg)}`);
    }
    return EXIT.DAEMON_DOWN;
  }
}
