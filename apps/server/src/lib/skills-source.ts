/**
 * parseInstallSource + SOURCE_ALIASES (PLAN_SKILLS_SH_MIGRATION Appendix B.0).
 * Kind order: github → direct SKILL.md URL → well-known → invalid_source.
 */

export const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills',
  'vercel-labs/vercel-skills': 'vercel-labs/agent-skills',
};

export type InstallSourceKind = 'github' | 'well-known' | 'direct';

export type InstallSource = {
  kind: InstallSourceKind;
  owner?: string;
  repo?: string;
  slug?: string;
  ref?: string;
  url?: string;
  id?: string;
};

export class SkillsHttpError extends Error {
  readonly http: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(http: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'SkillsHttpError';
    this.http = http;
    this.code = code;
    this.extra = extra;
  }
}

const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]+$/;
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

/** Printable ASCII, 1–200, no `..`. Catalog ids only — not UUID skill routes. */
export function safeCatalogId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > 200) return '';
  if (id.includes('..')) return '';
  if (!/^[a-zA-Z0-9._/-]+$/.test(id)) return '';
  return id;
}

export function applySourceAliases(raw: string): string {
  for (const [from, to] of Object.entries(SOURCE_ALIASES)) {
    if (raw === from || raw.startsWith(`${from}/`) || raw.startsWith(`${from}@`)) {
      return to + raw.slice(from.length);
    }
  }
  return raw;
}

function nonEmpty(raw: unknown, max = 200): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const t = raw.trim();
  if (!t || t.length > max) return '';
  return t;
}

function normalizeOwner(raw: string): string | null {
  const owner = raw.trim().toLowerCase();
  return OWNER_RE.test(owner) ? owner : null;
}

function normalizeRepo(raw: string): string | null {
  const repo = raw.trim().replace(/\.git$/i, '');
  return REPO_RE.test(repo) && repo.length <= 100 ? repo : null;
}

function normalizeSlug(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const slug = raw.trim();
  if (!slug || slug.length > 100 || !SLUG_RE.test(slug)) return undefined;
  return slug;
}

function githubSource(
  owner: string,
  repo: string,
  extra?: { slug?: string; ref?: string; id?: string },
): InstallSource {
  const id = extra?.id ?? (extra?.slug ? `${owner}/${repo}/${extra.slug}` : `${owner}/${repo}`);
  return {
    kind: 'github',
    owner,
    repo,
    slug: extra?.slug,
    ref: extra?.ref,
    id,
  };
}

function parseGithubShorthand(raw: string): InstallSource | null {
  let s = raw.trim();
  if (/^github:/i.test(s)) s = s.slice('github:'.length);

  const at = s.match(/^([^/@]+)\/([^/@]+)@(.+)$/);
  if (at) {
    const owner = normalizeOwner(at[1] ?? '');
    const repo = normalizeRepo(at[2] ?? '');
    const slug = normalizeSlug(at[3]);
    if (owner && repo && slug) return githubSource(owner, repo, { slug });
    return null;
  }

  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = normalizeOwner(parts[0] ?? '');
  const repo = normalizeRepo(parts[1] ?? '');
  if (!owner || !repo) return null;
  const slugPart = parts.length === 3 ? parts[2] : parts.length > 3 ? parts.slice(2).join('-') : undefined;
  return githubSource(owner, repo, { slug: normalizeSlug(slugPart) });
}

function isGitHostingHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!h) return true;
  if (h === 'github.com' || h === 'gitlab.com') return true;
  if (h === 'raw.githubusercontent.com' || h === 'codeload.github.com') return true;
  if (h.endsWith('.github.com') || h.endsWith('.gitlab.com')) return true;
  return false;
}

function parseGithubUrl(u: URL): InstallSource | null {
  const host = u.hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (host !== 'github.com') return null;
  const parts = u.pathname
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2) return null;
  const owner = normalizeOwner(parts[0] ?? '');
  const repo = normalizeRepo(parts[1] ?? '');
  if (!owner || !repo) return null;

  let ref: string | undefined;
  let slug: string | undefined;
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    ref = parts[3];
    const rest = parts.slice(4);
    const skillMd = rest[rest.length - 1]?.toLowerCase() === 'skill.md' ? rest.slice(0, -1) : rest;
    if (skillMd.length === 1) slug = normalizeSlug(skillMd[0]);
    else if (skillMd.length >= 2 && skillMd[0] === 'skills') {
      slug = normalizeSlug(skillMd[1]);
    }
  }

  if (u.hash && u.hash.length > 1) {
    try {
      const hashRef = decodeURIComponent(u.hash.slice(1)).trim();
      if (hashRef && !/[\0\r\n]/.test(hashRef) && hashRef.length <= 200) ref = hashRef;
    } catch {
      /* ignore bad hash */
    }
  }

  return githubSource(owner, repo, { slug, ref });
}

function parseHttpUrlLoose(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

export type ParseInstallSourceInput = {
  id?: unknown;
  source?: unknown;
  slug?: unknown;
  url?: unknown;
  ref?: unknown;
};

/**
 * HTTP보다 먼저 alias를 적용한 뒤 kind를 판정한다.
 * 실패 시 SkillsHttpError 400 invalid_source.
 */
export function parseInstallSource(input: ParseInstallSourceInput): InstallSource {
  const explicitSlug = normalizeSlug(nonEmpty(input.slug, 100) || undefined);
  const explicitRef = nonEmpty(input.ref, 200) || undefined;

  const idRaw = nonEmpty(input.id, 200);
  const urlRaw = nonEmpty(input.url, 2_048);
  const sourceRaw = nonEmpty(input.source, 400);

  let parsed: InstallSource | null = null;

  if (idRaw) {
    const aliased = applySourceAliases(idRaw);
    parsed = parseGithubShorthand(aliased);
  } else if (urlRaw) {
    const aliasedUrl = applySourceAliases(urlRaw);
    const u = parseHttpUrlLoose(aliasedUrl);
    if (u) {
      parsed = parseGithubUrl(u);
      if (!parsed) {
        const pathEndsSkillMd = /\/skill\.md$/i.test(u.pathname);
        if (pathEndsSkillMd) {
          parsed = { kind: 'direct', url: u.href, id: u.href };
        } else if (!isGitHostingHost(u.hostname) && !u.pathname.toLowerCase().endsWith('.git')) {
          parsed = { kind: 'well-known', url: u.href, id: u.href };
        }
      }
    } else {
      const aliased = applySourceAliases(urlRaw.replace(/^https?:\/\/(www\.)?github\.com\//i, ''));
      parsed = parseGithubShorthand(aliased);
    }
  } else if (sourceRaw) {
    const aliased = applySourceAliases(sourceRaw);
    const u = parseHttpUrlLoose(aliased);
    if (u) {
      parsed = parseGithubUrl(u);
      if (!parsed) {
        const pathEndsSkillMd = /\/skill\.md$/i.test(u.pathname);
        if (pathEndsSkillMd) {
          parsed = { kind: 'direct', url: u.href, id: u.href };
        } else if (!isGitHostingHost(u.hostname) && !u.pathname.toLowerCase().endsWith('.git')) {
          parsed = { kind: 'well-known', url: u.href, id: u.href };
        }
      }
    } else {
      parsed = parseGithubShorthand(aliased);
    }
  }

  if (!parsed) {
    throw new SkillsHttpError(400, 'invalid_source');
  }

  if (explicitSlug) parsed.slug = explicitSlug;
  if (explicitRef) parsed.ref = explicitRef;

  if (parsed.kind === 'github' && parsed.owner && parsed.repo) {
    parsed.id = parsed.slug
      ? `${parsed.owner}/${parsed.repo}/${parsed.slug}`
      : `${parsed.owner}/${parsed.repo}`;
  }

  return parsed;
}

/** Snapshot download path segments — github + slug only in PR 2a. */
export function snapshotDownloadPath(src: InstallSource): string | null {
  if (src.kind !== 'github' || !src.owner || !src.repo || !src.slug || src.ref) return null;
  return `${src.owner}/${src.repo}/${src.slug}`;
}
