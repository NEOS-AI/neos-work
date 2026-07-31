import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { formatServerLabel } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { printJson, type CmdContext } from '../util.js';

export async function cmdDoctor(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
): Promise<ExitCode> {
  const checks: Array<{ key: string; ok: boolean; message: string }> = [];

  checks.push({
    key: 'server_url',
    ok: Boolean(cfg.serverUrl),
    message: `NEOS_SERVER_URL=${formatServerLabel(cfg)}`,
  });
  checks.push({
    key: 'auth_token',
    ok: Boolean(cfg.authToken),
    message: cfg.authToken
      ? 'NEOS_AUTH_TOKEN is set'
      : 'NEOS_AUTH_TOKEN missing (required for most APIs)',
  });

  let healthOk = false;
  try {
    const h = await client.health();
    healthOk = h.data?.status === 'ok' || h.ok;
    checks.push({
      key: 'daemon_health',
      ok: healthOk,
      message: healthOk
        ? `daemon ok${h.data?.version ? ` (v${h.data.version})` : ''}`
        : 'daemon health not ok',
    });
  } catch (err) {
    checks.push({
      key: 'daemon_health',
      ok: false,
      message: err instanceof Error ? err.message : 'daemon unreachable',
    });
  }

  if (cfg.authToken && healthOk) {
    try {
      await client.listProjects();
      checks.push({
        key: 'auth_projects',
        ok: true,
        message: 'authenticated list projects ok',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'auth failed';
      checks.push({
        key: 'auth_projects',
        ok: false,
        message: msg,
      });
    }
  }

  const ready = checks.every((c) => c.ok || c.key === 'auth_token');
  // auth_token optional for health-only; overall doctor fails if daemon down
  const exit = healthOk ? EXIT.OK : EXIT.DAEMON_DOWN;

  if (ctx.json) {
    printJson(ctx, { ready: healthOk, checks });
  } else {
    for (const c of checks) {
      ctx.out(`${c.ok ? 'ok' : '!!'}  ${c.key}: ${c.message}`);
    }
    ctx.out(healthOk ? 'doctor: pass' : 'doctor: fail');
  }
  void ready;
  return exit;
}
