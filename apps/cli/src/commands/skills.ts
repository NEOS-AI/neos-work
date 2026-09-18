import { CliHttpError, type NeosApiClient } from '../client.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import {
  fail,
  flagValue,
  hasFlag,
  positional,
  printJson,
  printLines,
  type CmdContext,
} from '../util.js';

const USAGE =
  'usage: neos skills list|scan|find|add|update|remove';
const ADD_USAGE =
  'usage: neos skills add <owner/repo|url> [--skill <slug>] [--scope global|workspace] [--yes]';
const FIND_USAGE = 'usage: neos skills find <query> [--owner <owner>]';
const REMOVE_USAGE = 'usage: neos skills remove|rm <name-or-id> [--yes]';
const CONFIRM_HINT = 'pass --yes to confirm';

type ListedSkill = { id: string; name: string; source?: string };

function requireYes(ctx: CmdContext, rest: string[]): boolean {
  if (hasFlag(rest, '--yes')) return true;
  ctx.err(CONFIRM_HINT);
  return false;
}

/** Pack / Notion / SSH / local path — engine parse is in-process; these stay out of v1. */
function outOfScopeInstallSource(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^git@/i.test(s) || /^ssh:\/\//i.test(s)) return true;
  if (/^file:/i.test(s)) return true;
  if (s.startsWith('./') || s.startsWith('../') || s.startsWith('~/') || s.startsWith('/')) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(s) || s.includes('\\')) return true;
  if (/skills\.sh\/p\//i.test(s)) return true;
  if (/notion\.(so|site)\b/i.test(s)) return true;
  return false;
}

function skillAmbiguousCandidates(err: CliHttpError): Array<{ slug: string; name?: string }> {
  const body = err.body;
  if (!body || typeof body !== 'object') return [];
  const raw = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ slug: string; name?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { slug?: unknown; name?: unknown };
    if (typeof rec.slug !== 'string' || /[\0\r\n]/.test(rec.slug)) continue;
    const slug = rec.slug.trim();
    if (!slug) continue;
    const name =
      typeof rec.name === 'string' && !/[\0\r\n]/.test(rec.name) ? rec.name.trim() : '';
    out.push(name ? { slug, name } : { slug });
  }
  return out;
}

function isSkillAmbiguous(err: unknown): err is CliHttpError {
  if (!(err instanceof CliHttpError)) return false;
  if (err.message === 'skill_ambiguous') return true;
  const body = err.body;
  return Boolean(
    body && typeof body === 'object' && (body as { error?: unknown }).error === 'skill_ambiguous',
  );
}

function handleSkillError(ctx: CmdContext, err: unknown): ExitCode {
  if (isSkillAmbiguous(err)) {
    const candidates = skillAmbiguousCandidates(err);
    if (ctx.json) printJson(ctx, { error: 'skill_ambiguous', candidates });
    else {
      ctx.err('multiple skills in source; pass --skill <slug>');
      for (const c of candidates) {
        ctx.err(c.name ? `${c.slug}\t${c.name}` : c.slug);
      }
    }
    return EXIT.VALIDATION;
  }
  return fail(err);
}

async function listInstalled(client: NeosApiClient): Promise<ListedSkill[]> {
  const res = await client.listSkills();
  return ((res.data ?? []) as ListedSkill[]).filter(
    (s) => typeof s?.id === 'string' && typeof s?.name === 'string',
  );
}

function matchSkill(list: ListedSkill[], nameOrId: string): ListedSkill | undefined {
  const key = nameOrId.trim();
  const byId = list.find((s) => s.id === key);
  if (byId) return byId;
  const lower = key.toLowerCase();
  return list.find((s) => s.name.toLowerCase() === lower);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSkill(
  ctx: CmdContext,
  client: NeosApiClient,
  nameOrId: string,
): Promise<ListedSkill | null> {
  const key = nameOrId.trim();
  if (!key || /[\0\r\n]/.test(key)) {
    ctx.err('invalid name or id');
    return null;
  }
  const list = await listInstalled(client);
  const hit = matchSkill(list, key);
  if (hit) return hit;
  if (UUID_RE.test(key)) return { id: key, name: key };
  ctx.err(`skill not found: ${key}`);
  return null;
}

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
    if (sub === 'find') {
      const query = positional(rest).slice(1).join(' ').trim();
      const owner = flagValue(rest, '--owner');
      if (!query) {
        ctx.err(FIND_USAGE);
        return EXIT.USAGE;
      }
      if (/[\0\r\n]/.test(query)) {
        ctx.err('invalid query');
        return EXIT.VALIDATION;
      }
      const res = await client.findSkills(query, owner ? { owner } : undefined);
      const data = (res.data ?? {}) as {
        skills?: Array<{
          id?: string;
          name?: string;
          source?: string;
          installs?: number;
          installed?: boolean;
        }>;
      };
      if (ctx.json) printJson(ctx, res.data ?? data);
      else {
        const hits = Array.isArray(data.skills) ? data.skills : [];
        printLines(
          ctx,
          hits.map((s) => {
            const installed = s.installed ? 'installed' : '';
            return `${s.id ?? ''}\t${s.name ?? ''}\t${s.source ?? ''}\t${s.installs ?? 0}\t${installed}`.trimEnd();
          }),
        );
      }
      return EXIT.OK;
    }
    if (sub === 'add') {
      const sourceRaw = positional(rest)[1];
      if (!sourceRaw?.trim()) {
        ctx.err(ADD_USAGE);
        return EXIT.USAGE;
      }
      if (/[\0\r\n]/.test(sourceRaw)) {
        ctx.err('invalid source');
        return EXIT.VALIDATION;
      }
      if (outOfScopeInstallSource(sourceRaw)) {
        ctx.err(ADD_USAGE);
        ctx.err('pack, Notion, SSH, and local paths are out of scope');
        return EXIT.USAGE;
      }
      const slug = flagValue(rest, '--skill');
      const scopeRaw = flagValue(rest, '--scope');
      let scope: 'global' | 'workspace' | undefined;
      if (scopeRaw) {
        if (scopeRaw !== 'global' && scopeRaw !== 'workspace') {
          ctx.err('--scope must be global|workspace');
          return EXIT.VALIDATION;
        }
        scope = scopeRaw;
      }
      if (!requireYes(ctx, rest)) return EXIT.USAGE;
      const looksUrl = /^https?:\/\//i.test(sourceRaw.trim());
      const res = await client.addSkill({
        source: looksUrl ? undefined : sourceRaw.trim(),
        url: looksUrl ? sourceRaw.trim() : undefined,
        slug,
        scope,
        confirm: true,
      });
      if (ctx.json) printJson(ctx, res.data);
      else {
        const d = res.data as { id?: string; name?: string };
        ctx.out(`installed ${d.id ?? ''} ${d.name ?? ''}`.trim());
      }
      return EXIT.OK;
    }
    if (sub === 'update') {
      if (!requireYes(ctx, rest)) return EXIT.USAGE;
      const nameOrId = positional(rest)[1];
      if (nameOrId) {
        const skill = await resolveSkill(ctx, client, nameOrId);
        if (!skill) return EXIT.NOT_FOUND;
        const res = await client.updateSkill(skill.id);
        if (ctx.json) printJson(ctx, res.data);
        else {
          const d = res.data as { id?: string; name?: string; unchanged?: boolean };
          const verb = d.unchanged ? 'unchanged' : 'updated';
          ctx.out(`${verb} ${d.id ?? skill.id} ${d.name ?? skill.name}`.trim());
        }
        return EXIT.OK;
      }
      const remotes = (await listInstalled(client)).filter((s) => s.source === 'remote');
      const results: unknown[] = [];
      for (const skill of remotes) {
        const res = await client.updateSkill(skill.id);
        results.push(res.data ?? { id: skill.id });
        if (!ctx.json) {
          const d = (res.data ?? {}) as { id?: string; name?: string; unchanged?: boolean };
          const verb = d.unchanged ? 'unchanged' : 'updated';
          ctx.out(`${verb} ${d.id ?? skill.id} ${d.name ?? skill.name}`.trim());
        }
      }
      if (ctx.json) printJson(ctx, { updated: remotes.length, results });
      else if (remotes.length === 0) ctx.out('0 remotes updated');
      return EXIT.OK;
    }
    if (sub === 'remove' || sub === 'rm') {
      const nameOrId = positional(rest)[1];
      if (!nameOrId) {
        ctx.err(REMOVE_USAGE);
        return EXIT.USAGE;
      }
      if (!requireYes(ctx, rest)) return EXIT.USAGE;
      const skill = await resolveSkill(ctx, client, nameOrId);
      if (!skill) return EXIT.NOT_FOUND;
      const res = await client.removeSkill(skill.id);
      const data = (res.data ?? {}) as { filesRemoved?: boolean; restored?: string };
      if (ctx.json) printJson(ctx, { id: skill.id, name: skill.name, ...data });
      else {
        // DELETE is registry-only until PR 3 file-delete lands.
        const note = data.filesRemoved === true ? 'files deleted' : 'registry only';
        ctx.out(`removed ${skill.id} ${skill.name} (${note})`);
      }
      return EXIT.OK;
    }
    ctx.err(USAGE);
    return EXIT.USAGE;
  } catch (err) {
    return handleSkillError(ctx, err);
  }
}
