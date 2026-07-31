import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdProject(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listProjects();
      const list = (res.data ?? []) as Array<{ id: string; name: string; baseDir?: string }>;
      if (ctx.json) printJson(ctx, list);
      else if (list.length === 0) ctx.out('(no projects)');
      else {
        printLines(
          ctx,
          list.map((p) => `${p.id}\t${p.name}${p.baseDir ? `\t${p.baseDir}` : ''}`),
        );
      }
      return EXIT.OK;
    }

    if (sub === 'create') {
      const name = flagValue(rest, '--name') || rest[1];
      if (!name || /[\0\r\n]/.test(name) || !name.trim()) {
        ctx.err('usage: neos project create --name <name> [--base-dir <path>]');
        return EXIT.USAGE;
      }
      const baseDir = flagValue(rest, '--base-dir');
      const res = await client.createProject({
        name: name.trim(),
        baseDir: baseDir || undefined,
      });
      if (ctx.json) printJson(ctx, res.data);
      else {
        const p = res.data as { id?: string; name?: string };
        ctx.out(`created ${p.id ?? ''} ${p.name ?? name}`.trim());
      }
      return EXIT.OK;
    }

    if (sub === 'get') {
      const id = rest[1] || cfg.projectId;
      if (!id) {
        ctx.err('usage: neos project get <id>  (or set NEOS_PROJECT_ID)');
        return EXIT.USAGE;
      }
      const res = await client.getProject(id);
      if (ctx.json) printJson(ctx, res.data);
      else {
        const p = res.data as Record<string, unknown>;
        ctx.out(JSON.stringify(p, null, 2));
      }
      return EXIT.OK;
    }

    ctx.err('usage: neos project list|create|get');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
