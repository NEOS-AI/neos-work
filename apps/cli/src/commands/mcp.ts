import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdMcp(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listMcpServers();
      const list = (res.data ?? []) as Array<{
        id: string;
        name: string;
        transport?: string;
        enabled?: boolean;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map(
            (m) =>
              `${m.id}\t${m.name}\t${m.transport ?? '?'}\t${m.enabled === false ? 'off' : 'on'}`,
          ),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos mcp list');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
