import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, printJson, printLines, type CmdContext } from '../util.js';

/**
 * CLI agents catalog / detection (P2: wire listCliAgents + /catalog).
 * usage: neos cli-agents list|catalog
 */
export async function cmdCliAgents(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls' || sub === 'detected') {
      const res = await client.listCliAgents();
      const list = (res.data ?? []) as Array<{
        id?: string;
        name?: string;
        available?: boolean;
        path?: string;
        family?: string;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map((a) => {
            const id = a.id ?? '?';
            const name = a.name ?? '';
            const avail =
              a.available === false ? 'missing' : a.available === true ? 'available' : '';
            const path = typeof a.path === 'string' ? a.path : '';
            return [id, name, avail, path].filter(Boolean).join('\t');
          }),
        );
      }
      return EXIT.OK;
    }
    if (sub === 'catalog' || sub === 'defs') {
      const res = await client.listCliAgentsCatalog();
      const list = (res.data ?? []) as Array<{
        id?: string;
        name?: string;
        family?: string;
        binary?: string;
        enabledByDefault?: boolean;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map((a) => {
            const id = a.id ?? '?';
            const name = a.name ?? '';
            const family = a.family ?? '';
            const bin = a.binary ?? '';
            const en = a.enabledByDefault ? 'default-on' : 'default-off';
            return `${id}\t${name}\t${family}\t${bin}\t${en}`;
          }),
        );
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos cli-agents list|catalog');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
