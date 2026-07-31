import type { NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, printJson, printLines, type CmdContext } from '../util.js';

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
    if (sub === 'config') {
      const res = await client.mediaConfig();
      if (ctx.json) printJson(ctx, res.data);
      else ctx.out(JSON.stringify(res.data, null, 2));
      return EXIT.OK;
    }
    if (sub === 'generate') {
      const surfaceRaw = (flagValue(rest, '--surface') || 'image').toLowerCase();
      if (surfaceRaw !== 'image' && surfaceRaw !== 'audio' && surfaceRaw !== 'video') {
        ctx.err('surface must be image|audio|video');
        return EXIT.VALIDATION;
      }
      const prompt = flagValue(rest, '--prompt') || flagValue(rest, '--text');
      if (!prompt?.trim()) {
        ctx.err('usage: neos media generate --surface image|audio|video --prompt <text> [--provider id]');
        return EXIT.USAGE;
      }
      if (surfaceRaw === 'image' || surfaceRaw === 'video') {
        if (/[\0\r\n]/.test(prompt)) {
          ctx.err('prompt contains invalid control characters');
          return EXIT.VALIDATION;
        }
      } else if (/\0/.test(prompt)) {
        ctx.err('text contains invalid control characters');
        return EXIT.VALIDATION;
      }
      const res = await client.generateMedia({
        surface: surfaceRaw,
        prompt: surfaceRaw !== 'audio' ? prompt.trim() : undefined,
        text: surfaceRaw === 'audio' ? prompt.trim() : undefined,
        provider: flagValue(rest, '--provider'),
        model: flagValue(rest, '--model'),
        size: flagValue(rest, '--size'),
        quality: flagValue(rest, '--quality'),
        voice: flagValue(rest, '--voice'),
      });
      if (ctx.json) printJson(ctx, res.data);
      else {
        const d = res.data as {
          filename?: string;
          jobId?: string;
          status?: string;
          surface?: string;
        };
        if (d.jobId) ctx.out(`job ${d.jobId}\t${d.status ?? 'queued'}`);
        else ctx.out(`${d.surface ?? surfaceRaw}\t${d.filename ?? 'ok'}`);
      }
      return EXIT.OK;
    }
    ctx.err('usage: neos media list|config|generate');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
