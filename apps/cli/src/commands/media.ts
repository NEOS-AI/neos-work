import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdMedia(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listMedia(100);
      const files = (res.data ?? []) as Array<{ filename: string; kind?: string; size?: number }>;
      if (ctx.json) printJson(ctx, files);
      else {
        printLines(
          ctx,
          files.map((f) => `${f.filename}\t${f.kind ?? '?'}\t${f.size ?? ''}`),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos media list');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
