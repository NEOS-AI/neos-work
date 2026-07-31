/**
 * Deploy helpers — Vercel and Cloudflare Pages
 * These make REST API calls to each platform's deployment API.
 */

import { scrubErrorMessage } from '@neos-work/core';
import { isValidDeployProjectName } from '@neos-work/shared';
import { isBlockedSsrfHost } from './ssrf.js';

/** Re-export shared deploy project name validator (single source of truth). */
export { isValidDeployProjectName };
/** @deprecated Prefer isBlockedSsrfHost from ./ssrf.js */
export { isBlockedSsrfHost as isBlockedDeployCheckHost };

export interface DeployResult {
  url: string;
  deploymentId?: string;
}

export type RemoteDeployStatus = 'pending' | 'deploying' | 'success' | 'failed';

export interface RemoteDeployStatusResult {
  status: RemoteDeployStatus;
  url?: string;
  statusMessage?: string;
  readyState?: string;
}

function networkError(err: unknown, fallback: string): Error {
  // Scrub control chars so deploy provider errors never inject CR/LF/null into callers
  if (err instanceof Error) {
    const msg = scrubErrorMessage(err.message, 2_000) || fallback;
    return new Error(msg);
  }
  return new Error(fallback);
}

/** Scrub provider API error bodies before rethrowing. */
function providerApiError(raw: unknown, fallback: string): Error {
  const msg = scrubErrorMessage(raw, 2_000) || fallback;
  return new Error(msg);
}

/** Cap deploy API tokens / account / deployment ids (header / path hygiene). */
const DEPLOY_TOKEN_MAX = 8_192;
const DEPLOY_ID_MAX = 200;
const DEPLOY_ACCOUNT_MAX = 100;

function sanitizeDeployToken(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const t = raw.trim();
  if (!t || t.length > DEPLOY_TOKEN_MAX) return '';
  return t;
}

function sanitizeDeployId(raw: unknown, max = DEPLOY_ID_MAX): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

/** Cloudflare/Vercel project names: short, no control chars. */
function sanitizeProjectName(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const name = raw.trim();
  if (!name || name.length > 63) return '';
  return name;
}

/**
 * Normalize deployment host/URL to http(s) only.
 * Bare hosts become https://host; file:/javascript: rejected.
 */
export function safeDeployHostUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return undefined;
  const s = raw.trim();
  if (!s || s.length > 2_048) return undefined;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return withScheme.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Poll Vercel deployment status by deployment id. */
export async function getVercelDeploymentStatus(
  deploymentId: string,
  apiToken: string,
): Promise<RemoteDeployStatusResult> {
  const id = sanitizeDeployId(deploymentId);
  const token = sanitizeDeployToken(apiToken);
  if (!id) throw new Error('deploymentId is required');
  if (!token) throw new Error('apiToken is required');
  let res: Response;
  try {
    res = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw networkError(err, 'Vercel status network error');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw providerApiError(errBody.error?.message, `Vercel status error ${res.status}`);
  }
  const data = await res.json() as {
    readyState?: string;
    url?: string;
    alias?: string[];
  };
  const ready = (data.readyState ?? '').toUpperCase();
  let status: RemoteDeployStatus = 'deploying';
  if (ready === 'READY') status = 'success';
  else if (ready === 'ERROR' || ready === 'CANCELED') status = 'failed';
  else if (ready === 'QUEUED' || ready === 'INITIALIZING') status = 'pending';

  const host = data.url ?? data.alias?.[0];
  return {
    status,
    url: safeDeployHostUrl(host),
    statusMessage: data.readyState,
    readyState: data.readyState,
  };
}

/** Poll Cloudflare Pages deployment status. */
export async function getCloudflareDeploymentStatus(options: {
  accountId: string;
  projectName: string;
  deploymentId: string;
  apiToken: string;
}): Promise<RemoteDeployStatusResult> {
  const accountId = sanitizeDeployId(options.accountId, DEPLOY_ACCOUNT_MAX);
  const projectName = sanitizeProjectName(options.projectName);
  const deploymentId = sanitizeDeployId(options.deploymentId);
  const apiToken = sanitizeDeployToken(options.apiToken);
  if (!accountId) throw new Error('accountId is required');
  if (!projectName) throw new Error('projectName is required');
  if (!deploymentId) throw new Error('deploymentId is required');
  if (!apiToken) throw new Error('apiToken is required');
  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
  } catch (err) {
    throw networkError(err, 'Cloudflare status network error');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { errors?: { message: string }[] };
    throw providerApiError(errBody.errors?.[0]?.message, `Cloudflare status error ${res.status}`);
  }
  const data = await res.json() as {
    result?: { url?: string; latest_stage?: { status?: string; name?: string }; stages?: Array<{ status?: string }> };
  };
  const stageStatus = (data.result?.latest_stage?.status ?? '').toLowerCase();
  let status: RemoteDeployStatus = 'deploying';
  if (stageStatus === 'success') status = 'success';
  else if (stageStatus === 'failure' || stageStatus === 'canceled') status = 'failed';
  else if (stageStatus === 'idle' || stageStatus === 'active') status = 'pending';

  return {
    status,
    url: safeDeployHostUrl(data.result?.url),
    statusMessage: data.result?.latest_stage?.status,
    readyState: data.result?.latest_stage?.status,
  };
}

/** Cap deploy payload size (plan Task 8 — runaway HTML defense). */
export const DEPLOY_CONTENT_MAX_CHARS = 2 * 1024 * 1024;

function normalizeDeployContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw : String(raw ?? '');
  // Null-byte check before empty trim (trim does not strip \0)
  if (/\0/.test(content)) {
    throw new Error('content contains invalid control characters');
  }
  if (!content.trim()) throw new Error('content is required');
  if (content.length > DEPLOY_CONTENT_MAX_CHARS) {
    throw new Error(`content exceeds max size (${DEPLOY_CONTENT_MAX_CHARS} characters)`);
  }
  return content;
}

export async function deployToVercel(options: {
  projectName: string;
  content: string;
  apiToken: string;
}): Promise<DeployResult> {
  const projectName = sanitizeProjectName(options.projectName);
  const content = normalizeDeployContent(options.content);
  const apiToken = sanitizeDeployToken(options.apiToken);
  if (!projectName) throw new Error('projectName is required');
  if (!apiToken) throw new Error('apiToken is required');

  // Use Vercel's deployments API to create a file-based deployment
  const deployBody = {
    name: projectName,
    files: [
      {
        file: 'index.html',
        data: Buffer.from(content).toString('base64'),
        encoding: 'base64',
      },
    ],
    projectSettings: { framework: null },
    target: 'production',
  };

  let res: Response;
  try {
    res = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deployBody),
    });
  } catch (err) {
    throw networkError(err, 'Vercel deploy network error');
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw providerApiError(errBody.error?.message, `Vercel API error ${res.status}`);
  }

  const data = await res.json() as { url?: string; id?: string };
  if (!data.url) throw new Error('No deployment URL returned');

  const url = safeDeployHostUrl(data.url) ?? safeDeployHostUrl(`https://${data.url}`);
  if (!url) throw new Error('Invalid deployment URL returned');

  const deploymentId = sanitizeDeployId(data.id) || undefined;
  return {
    url,
    deploymentId,
  };
}

export async function deployToCloudflare(options: {
  projectName: string;
  content: string;
  accountId: string;
  apiToken: string;
}): Promise<DeployResult> {
  const projectName = sanitizeProjectName(options.projectName);
  const content = normalizeDeployContent(options.content);
  const accountId = sanitizeDeployId(options.accountId, DEPLOY_ACCOUNT_MAX);
  const apiToken = sanitizeDeployToken(options.apiToken);
  if (!projectName) throw new Error('projectName is required');
  if (!accountId) throw new Error('accountId is required');
  if (!apiToken) throw new Error('apiToken is required');

  // First ensure project exists
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: projectName, production_branch: 'main' }),
      },
    );
  } catch {
    // Ignore create-project network errors; deploy may still succeed if project exists
  }
  // Ignore "already exists" error

  // Create a direct upload deployment via multipart form
  const formData = new FormData();
  formData.append(
    'manifest',
    JSON.stringify({ '/index.html': await sha256Hex(content) }),
  );
  formData.append('/index.html', new Blob([content], { type: 'text/html' }), 'index.html');

  let deployRes: Response;
  try {
    deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}` },
        body: formData,
      },
    );
  } catch (err) {
    throw networkError(err, 'Cloudflare deploy network error');
  }

  if (!deployRes.ok) {
    const errBody = await deployRes.json().catch(() => ({})) as { errors?: { message: string }[] };
    throw providerApiError(errBody.errors?.[0]?.message, `Cloudflare API error ${deployRes.status}`);
  }

  const data = await deployRes.json() as { result?: { url?: string; id?: string } };
  const rawUrl = data.result?.url ?? `https://${projectName}.pages.dev`;
  const url = safeDeployHostUrl(rawUrl) ?? `https://${projectName}.pages.dev`;
  const deploymentId = sanitizeDeployId(data.result?.id) || undefined;
  return { url, deploymentId };
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Task 10 polish: secret mask, check-link, richer preflight ──

/**
 * Mask a secret for logs/UI (keep last `visible` chars when long enough).
 * Never returns the full secret.
 */
export function maskSecret(raw: unknown, visible = 4): string {
  if (typeof raw !== 'string' || !raw) return '';
  // Control chars → empty (do not leak multi-line secrets into UI)
  if (/[\0\r\n]/.test(raw)) return '***';
  const s = raw.trim();
  if (!s) return '';
  if (s.length <= visible) return '*'.repeat(Math.min(s.length, 8));
  // Cap mask length so multi-KB tokens do not explode UI/log strings
  const starCount = Math.min(Math.max(4, s.length - visible), 32);
  return `${'*'.repeat(starCount)}${s.slice(-visible)}`;
}

/**
 * Scrub known secret substrings and common token patterns from free text
 * (status messages, provider errors).
 */
export function scrubSecretsFromText(raw: unknown, knownSecrets: string[] = []): string {
  let text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (!text) return '';
  if (/\0/.test(text)) text = text.replace(/\0/g, '');
  text = text.replace(/[\r\n]+/g, ' ').trim();
  for (const secret of knownSecrets) {
    if (typeof secret !== 'string' || secret.length < 6) continue;
    if (text.includes(secret)) {
      text = text.split(secret).join(maskSecret(secret));
    }
  }
  // Common API token shapes
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1***');
  text = text.replace(/\b(sk-[A-Za-z0-9]{8,})/g, (m) => maskSecret(m));
  text = text.replace(/\b(xai-[A-Za-z0-9]{8,})/g, (m) => maskSecret(m));
  return text.slice(0, 2_000);
}

export interface CheckDeployLinkResult {
  url: string;
  reachable: boolean;
  blocked: boolean;
  status?: number;
  ok: boolean;
  reason?: string;
  contentType?: string;
}

/**
 * HEAD (fallback GET) reachability check for a deployment URL.
 * Blocks private/loopback hosts. Does not follow more than default redirect policy.
 */
export async function checkDeployLink(
  rawUrl: unknown,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<CheckDeployLinkResult> {
  const normalized = safeDeployHostUrl(rawUrl);
  if (!normalized) {
    // Never echo control chars from bad client input into the response body
    const safeEcho =
      typeof rawUrl === 'string'
        ? rawUrl.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 200)
        : '';
    return {
      url: safeEcho,
      reachable: false,
      blocked: false,
      ok: false,
      reason: 'Invalid or non-http(s) URL',
    };
  }
  let host: string;
  try {
    host = new URL(normalized).hostname;
  } catch {
    return {
      url: normalized,
      reachable: false,
      blocked: false,
      ok: false,
      reason: 'Invalid URL',
    };
  }
  if (isBlockedSsrfHost(host)) {
    return {
      url: normalized,
      reachable: false,
      blocked: true,
      ok: false,
      reason: 'Host is blocked (private/loopback/link-local)',
    };
  }

  const timeoutMs = Math.min(Math.max(opts?.timeoutMs ?? 8_000, 1_000), 30_000);
  const fetchFn = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // redirect:manual — avoid automatic hops onto private IPs via open redirects
    let res = await fetchFn(normalized, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    // Some CDNs reject HEAD — fall back to GET
    if (res.status === 405 || res.status === 501) {
      res = await fetchFn(normalized, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Range: 'bytes=0-0' },
      });
    }

    // One-hop redirect: only follow when Location host is also public
    if (res.status >= 300 && res.status < 400) {
      const locRaw = res.headers?.get?.('location') ?? '';
      if (locRaw && !/[\0\r\n]/.test(locRaw)) {
        let nextUrl: string | undefined;
        try {
          nextUrl = safeDeployHostUrl(new URL(locRaw, normalized).href);
        } catch {
          nextUrl = undefined;
        }
        if (!nextUrl) {
          return {
            url: normalized,
            reachable: false,
            blocked: false,
            status: res.status,
            ok: false,
            reason: 'Redirect target is not a valid http(s) URL',
          };
        }
        const nextHost = new URL(nextUrl).hostname;
        if (isBlockedSsrfHost(nextHost)) {
          return {
            url: normalized,
            reachable: false,
            blocked: true,
            status: res.status,
            ok: false,
            reason: 'Redirect target host is blocked (private/loopback)',
          };
        }
        // Follow one hop only
        res = await fetchFn(nextUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Range: 'bytes=0-0' },
        });
        // Second redirect → report without further follow
        if (res.status >= 300 && res.status < 400) {
          return {
            url: nextUrl,
            reachable: true,
            blocked: false,
            status: res.status,
            ok: true,
            reason: 'Redirect (not followed further)',
          };
        }
      } else {
        return {
          url: normalized,
          reachable: true,
          blocked: false,
          status: res.status,
          ok: true,
          reason: 'Redirect without usable Location',
        };
      }
    }

    const status = res.status;
    const reachable = status > 0 && status < 500;
    const contentType = res.headers?.get?.('content-type') ?? undefined;
    return {
      url: normalized,
      reachable,
      blocked: false,
      status,
      ok: status >= 200 && status < 400,
      contentType: contentType ? contentType.split(';')[0]?.trim().slice(0, 100) : undefined,
      reason: reachable ? undefined : `HTTP ${status}`,
    };
  } catch (err) {
    const msg = scrubErrorMessage(err instanceof Error ? err.message : 'network error', 200);
    return {
      url: normalized,
      reachable: false,
      blocked: false,
      ok: false,
      reason: msg || 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PreflightCheck {
  key: string;
  ok: boolean;
  message: string;
  /** Optional severity for UI (info|warn|error). */
  severity?: 'info' | 'warn' | 'error';
}

/** Placeholder / demo token patterns that should not pass preflight. */
export function looksLikePlaceholderToken(raw: unknown): boolean {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return true;
  const t = raw.trim().toLowerCase();
  if (!t) return true;
  if (t.length < 8) return true;
  if (
    /^(x+|your[-_]?token|changeme|todo|xxx|test|dummy|placeholder|example)/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function buildDeployPreflight(options: {
  provider: 'vercel' | 'cloudflare';
  projectName: string;
  vercelToken?: string;
  cloudflareToken?: string;
  cloudflareAccountId?: string;
}): { provider: 'vercel' | 'cloudflare'; ready: boolean; checks: PreflightCheck[] } {
  const checks: PreflightCheck[] = [];
  const provider = options.provider;

  if (provider === 'vercel') {
    const token = options.vercelToken;
    const present = Boolean(token);
    checks.push({
      key: 'VERCEL_API_TOKEN',
      ok: present,
      message: present ? 'Vercel API token configured' : 'Missing Vercel API token in Settings',
      severity: present ? 'info' : 'error',
    });
    if (present) {
      const placeholder = looksLikePlaceholderToken(token);
      checks.push({
        key: 'VERCEL_API_TOKEN_FORMAT',
        ok: !placeholder,
        message: placeholder
          ? 'Vercel token looks like a placeholder (too short or demo value)'
          : 'Vercel token format looks acceptable',
        severity: placeholder ? 'warn' : 'info',
      });
    }
  } else {
    const token = options.cloudflareToken;
    const accountId = options.cloudflareAccountId;
    checks.push({
      key: 'CLOUDFLARE_API_TOKEN',
      ok: Boolean(token),
      message: token ? 'Cloudflare API token configured' : 'Missing Cloudflare API token in Settings',
      severity: token ? 'info' : 'error',
    });
    checks.push({
      key: 'CLOUDFLARE_ACCOUNT_ID',
      ok: Boolean(accountId),
      message: accountId
        ? 'Cloudflare Account ID configured'
        : 'Missing Cloudflare Account ID in Settings',
      severity: accountId ? 'info' : 'error',
    });
    if (token) {
      const placeholder = looksLikePlaceholderToken(token);
      checks.push({
        key: 'CLOUDFLARE_API_TOKEN_FORMAT',
        ok: !placeholder,
        message: placeholder
          ? 'Cloudflare token looks like a placeholder'
          : 'Cloudflare token format looks acceptable',
        severity: placeholder ? 'warn' : 'info',
      });
    }
    if (accountId) {
      const idOk =
        typeof accountId === 'string'
        && !/[\0\r\n]/.test(accountId)
        && accountId.trim().length >= 8
        && accountId.trim().length <= 100;
      checks.push({
        key: 'CLOUDFLARE_ACCOUNT_ID_FORMAT',
        ok: idOk,
        message: idOk
          ? 'Cloudflare Account ID length looks acceptable'
          : 'Cloudflare Account ID length looks invalid',
        severity: idOk ? 'info' : 'warn',
      });
    }
  }

  const projectOk = isValidDeployProjectName(options.projectName);
  checks.push({
    key: 'projectName',
    ok: projectOk,
    message: projectOk
      ? `Project name: ${options.projectName}`
      : 'Project name must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63).',
    severity: projectOk ? 'info' : 'error',
  });

  // ready when every non-warning check is ok (warnings never block)
  const ready = checks.every((ch) => ch.ok || ch.severity === 'warn');

  return { provider, ready, checks };
}
