import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdDesignSystems(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listDesignSystems();
      const list = (res.data ?? []) as Array<{
        id: string;
        name: string;
        source?: string;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map((d) => `${d.id}\t${d.name}\t${d.source ?? ''}`),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos design-systems list');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
