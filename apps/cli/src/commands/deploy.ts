import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdDeploy(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const projectId = flagValue(rest, '--project') || cfg.projectId || undefined;
      const workflowId = flagValue(rest, '--workflow') || undefined;
      const res = await client.listDeployments({ projectId, workflowId });
      const list = (res.data ?? []) as Array<{
        id: string;
        provider: string;
        status: string;
        url?: string;
        projectName?: string;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map(
            (d) =>
              `${d.id}\t${d.provider}\t${d.status}\t${d.projectName ?? ''}\t${d.url ?? ''}`,
          ),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos deploy list [--project id] [--workflow id]');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
