import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdSkills(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listSkills();
      const list = (res.data ?? []) as Array<{
        id: string;
        name: string;
        enabled?: boolean;
        source?: string;
        version?: string;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map(
            (s) =>
              `${s.id}\t${s.name}\t${s.enabled === false ? 'off' : 'on'}\t${s.source ?? ''}\tv${s.version ?? '?'}`,
          ),
        );
      }
      return EXIT.OK;
    }
    if (sub === 'scan') {
      const res = await client.scanSkills();
      if (ctx.json) printJson(ctx, res.data ?? { ok: true });
      else ctx.out('skills scan complete');
      return EXIT.OK;
    }
    ctx.err('usage: neos skills list|scan');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
