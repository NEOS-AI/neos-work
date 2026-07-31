import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, printJson, printLines, type CmdContext } from '../util.js';

function resolveProjectId(cfg: CliConfig, rest: string[]): string | null {
  return flagValue(rest, '--project') || flagValue(rest, '-p') || cfg.projectId;
}

export async function cmdFiles(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'ls';
  const projectId = resolveProjectId(cfg, rest);
  try {
    if (sub === 'ls' || sub === 'list') {
      if (!projectId) {
        ctx.err('usage: neos files ls --project <id>  (or NEOS_PROJECT_ID)');
        return EXIT.USAGE;
      }
      const res = await client.listProjectFiles(projectId);
      const files = (res.data ?? []) as Array<{ path: string; type?: string }>;
      if (ctx.json) printJson(ctx, files);
      else printLines(ctx, files.map((f) => f.path));
      return EXIT.OK;
    }

    if (sub === 'read') {
      const path = flagValue(rest, '--path') || rest[1];
      if (!projectId || !path) {
        ctx.err('usage: neos files read --project <id> --path <rel>');
        return EXIT.USAGE;
      }
      const res = await client.readProjectFile(projectId, path);
      const content = (res.data as { content?: string } | undefined)?.content ?? '';
      if (ctx.json) printJson(ctx, res.data);
      else ctx.out(content);
      return EXIT.OK;
    }

    if (sub === 'write') {
      const path = flagValue(rest, '--path') || rest[1];
      const contentFlag = flagValue(rest, '--content');
      if (!projectId || !path) {
        ctx.err('usage: neos files write --project <id> --path <rel> --content <text>');
        return EXIT.USAGE;
      }
      let content = contentFlag ?? '';
      if (contentFlag == null && !process.stdin.isTTY) {
        // read stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        content = Buffer.concat(chunks).toString('utf8');
      }
      if (/\0/.test(content)) {
        ctx.err('content contains null bytes');
        return EXIT.VALIDATION;
      }
      const res = await client.writeProjectFile(projectId, path, content);
      if (ctx.json) printJson(ctx, res.data ?? { ok: true });
      else ctx.out(`wrote ${path}`);
      return EXIT.OK;
    }

    ctx.err('usage: neos files ls|read|write');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
