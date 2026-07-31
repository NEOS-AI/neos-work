import type { NeosApiClient } from '../client.js';
import type { CliConfig } from '../config.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import { fail, flagValue, hasFlag, printJson, type CmdContext } from '../util.js';

export async function cmdRun(
  ctx: CmdContext,
  client: NeosApiClient,
  cfg: CliConfig,
  rest: string[],
): Promise<ExitCode> {
  const sub = rest[0] ?? 'create';
  try {
    if (sub === 'create') {
      const projectId = flagValue(rest, '--project') || cfg.projectId;
      const prompt = flagValue(rest, '--prompt') || rest.slice(1).filter((a) => !a.startsWith('-')).join(' ');
      if (!projectId || !prompt?.trim()) {
        ctx.err('usage: neos run create --project <id> --prompt <text> [--agent <cli-id>] [--dry-run]');
        return EXIT.USAGE;
      }
      if (/[\0\r\n]/.test(prompt)) {
        ctx.err('prompt contains invalid control characters');
        return EXIT.VALIDATION;
      }
      const agentId = flagValue(rest, '--agent');
      const dryRun = hasFlag(rest, '--dry-run');
      // Optional edit context as JSON
      let editContext: unknown;
      const ecRaw = flagValue(rest, '--edit-context');
      if (ecRaw) {
        try {
          editContext = JSON.parse(ecRaw);
        } catch {
          ctx.err('--edit-context must be JSON');
          return EXIT.VALIDATION;
        }
      }
      const res = await client.createRun({
        projectId,
        prompt: prompt.trim(),
        agentId: agentId || undefined,
        dryRun: dryRun || !agentId,
        editContext,
      });
      if (ctx.json) printJson(ctx, res.data);
      else {
        const d = res.data as { id?: string; status?: string };
        ctx.out(`${d.id ?? ''}\t${d.status ?? 'created'}`.trim());
      }
      return EXIT.OK;
    }

    if (sub === 'status' || sub === 'get') {
      const id = rest[1];
      if (!id) {
        ctx.err('usage: neos run status <runId>');
        return EXIT.USAGE;
      }
      const res = await client.getRun(id);
      if (ctx.json) printJson(ctx, res.data);
      else {
        const d = res.data as { id?: string; status?: string; error?: string };
        ctx.out(`${d.id ?? id}\t${d.status ?? '?'}${d.error ? `\t${d.error}` : ''}`);
      }
      return EXIT.OK;
    }

    if (sub === 'cancel') {
      const id = rest[1];
      if (!id) {
        ctx.err('usage: neos run cancel <runId>');
        return EXIT.USAGE;
      }
      const res = await client.cancelRun(id);
      if (ctx.json) printJson(ctx, res.data ?? { ok: true });
      else ctx.out(`canceled ${id}`);
      return EXIT.OK;
    }

    ctx.err('usage: neos run create|status|cancel');
    return EXIT.USAGE;
  } catch (err) {
    return fail(err);
  }
}
