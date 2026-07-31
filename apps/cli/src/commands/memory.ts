import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, printJson, printLines, type CmdContext } from '../util.js';

export async function cmdMemory(
  ctx: CmdContext,
  client: NeosApiClient,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'list';
  try {
    if (sub === 'list' || sub === 'ls') {
      const res = await client.listMemories();
      const list = (res.data ?? []) as Array<{
        id: string;
        name: string;
        type?: string;
        enabled?: boolean;
      }>;
      if (ctx.json) printJson(ctx, list);
      else {
        printLines(
          ctx,
          list.map(
            (m) =>
              `${m.id}\t${m.name}\t${m.type ?? '?'}\t${m.enabled === false ? 'off' : 'on'}`,
          ),
        );
      }
      return EXIT.OK;
    }
    if (sub === 'add' || sub === 'create') {
      const name = flagValue(rest, '--name') || rest[1];
      const type = flagValue(rest, '--type') || 'user';
      const content = flagValue(rest, '--content') || rest.slice(2).filter((a) => !a.startsWith('-')).join(' ');
      if (!name?.trim() || !content?.trim()) {
        ctx.err('usage: neos memory add --name <n> --type <user|session|skill|reference> --content <text>');
        return EXIT.USAGE;
      }
      if (/[\0\r\n]/.test(name) || /\0/.test(content) || /[\0\r\n]/.test(type)) {
        ctx.err('invalid control characters in name/type/content');
        return EXIT.VALIDATION;
      }
      // Align with @neos-work/shared MemoryType
      const typeNorm = type.trim().toLowerCase();
      if (!['user', 'session', 'skill', 'reference'].includes(typeNorm)) {
        ctx.err('type must be user|session|skill|reference');
        return EXIT.VALIDATION;
      }
      const res = await client.createMemory({
        name: name.trim(),
        type: typeNorm,
        content: content.trim(),
      });
      if (ctx.json) printJson(ctx, res.data);
      else {
        const d = res.data as { id?: string; name?: string };
        ctx.out(`created ${d.id ?? ''} ${d.name ?? name}`.trim());
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos memory list|add');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
