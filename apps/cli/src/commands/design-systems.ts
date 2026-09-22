import { readFile } from 'node:fs/promises';
import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, hasFlag, printJson, printLines, type CmdContext } from '../util.js';

const USAGE = [
  'usage:',
  '  neos design-systems list',
  '  neos design-systems content <id>',
  '  neos design-systems content <id> --file <path>',
  '  neos design-systems rules <id>',
  '  neos design-systems rules <id> --file <path>',
  '  neos design-systems tokens <id>',
  '  neos design-systems tokens <id> --file <path>',
].join('\n');

const FILE_LABEL = {
  content: 'DESIGN.md',
  rules: 'RULES.md',
  tokens: 'tokens.css',
} as const;

type FileSub = keyof typeof FILE_LABEL;

function isFileSub(sub: string): sub is FileSub {
  return sub === 'content' || sub === 'rules' || sub === 'tokens';
}

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

    if (isFileSub(sub)) {
      const id = rest[1];
      if (!id || id.startsWith('-') || (hasFlag(rest, '--file') && flagValue(rest, '--file') == null)) {
        ctx.err(USAGE);
        return EXIT.USAGE;
      }
      const filePath = flagValue(rest, '--file');
      if (filePath) {
        let content: string;
        try {
          content = await readFile(filePath, 'utf8');
        } catch (err) {
          const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
          ctx.err(code === 'ENOENT' ? `file not found: ${filePath}` : err instanceof Error ? err.message : 'failed to read file');
          return EXIT.VALIDATION;
        }
        if (/\0/.test(content)) {
          ctx.err('content contains null bytes');
          return EXIT.VALIDATION;
        }
        const res =
          sub === 'content'
            ? await client.saveDesignSystemContent(id, content)
            : sub === 'rules'
              ? await client.saveDesignSystemRules(id, content)
              : await client.saveDesignSystemTokens(id, content);
        if (ctx.json) printJson(ctx, res.data ?? { ok: true });
        else ctx.out(`saved ${FILE_LABEL[sub]}`);
        return EXIT.OK;
      }

      const res =
        sub === 'content'
          ? await client.getDesignSystemContent(id)
          : sub === 'rules'
            ? await client.getDesignSystemRules(id)
            : await client.getDesignSystemTokens(id);
      const content = (res.data as { content?: string } | undefined)?.content ?? '';
      if (ctx.json) printJson(ctx, res.data);
      else ctx.out(content);
      return EXIT.OK;
    }

    ctx.err(USAGE);
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
