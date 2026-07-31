import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdPlugin(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listPlugins();
      const list = (res.data ?? []) as Array<{ id: string; name: string; channel?: string; version?: string }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map((p) => `${p.id}\t${p.name}\t${p.channel ?? ''}\tv${p.version ?? '?'}`),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos plugin list');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
