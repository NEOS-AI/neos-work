/**
 * DeployNode — deploys content to Vercel or Cloudflare Pages via server API
 */

import { isValidDeployProjectName } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { safeServerUrl } from './server-url.js';
import { scrubErrorMessage } from '@neos-work/core';

export { isValidDeployProjectName };

export const DeployNode: ExecutableNode = {
  type: 'deploy',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    // Control-char before trim so leading \n cannot strip to a known provider
    const providerRaw0 = String(config?.provider ?? 'vercel');
    const rawProvider =
      /[\0\r\n]/.test(providerRaw0) ? 'vercel' : providerRaw0.trim().toLowerCase() || 'vercel';
    const provider = rawProvider === 'cloudflare' ? 'cloudflare' : 'vercel';
    const serverUrl = safeServerUrl(settings['SERVER_URL']);
    const rawServerToken = String(settings['SERVER_TOKEN'] ?? '');
    // Drop tokens that would break Authorization headers (check before trim)
    let serverToken =
      /[\0\r\n]/.test(rawServerToken) || rawServerToken.trim().length > 8_192
        ? ''
        : rawServerToken.trim();

    const DEPLOY_CONTENT_MAX = 2 * 1024 * 1024;
    const rawContent = inputs['content'] ?? config?.content ?? '';
    // Null-byte check before trim (trim does not strip \0)
    const contentUntrimmed =
      typeof rawContent === 'string' ? rawContent : String(rawContent);
    if (/[\0]/.test(contentUntrimmed)) {
      return {
        ok: false,
        output: null,
        error: 'content contains invalid control characters',
        durationMs: Date.now() - start,
      };
    }
    const content = contentUntrimmed.trim();
    if (!content) {
      return { ok: false, output: null, error: 'No content to deploy', durationMs: Date.now() - start };
    }
    if (content.length > DEPLOY_CONTENT_MAX) {
      return {
        ok: false,
        output: null,
        error: `content too large (max ${DEPLOY_CONTENT_MAX} characters)`,
        durationMs: Date.now() - start,
      };
    }

    const projectRaw = String(
      config?.projectName ?? inputs['projectName'] ?? 'neos-deploy',
    );
    // Control-char before trim — reject rather than strip to a valid name
    if (/[\0\r\n]/.test(projectRaw)) {
      return {
        ok: false,
        output: null,
        error: 'projectName contains invalid control characters',
        durationMs: Date.now() - start,
      };
    }
    const projectName = projectRaw.trim() || 'neos-deploy';
    if (!isValidDeployProjectName(projectName)) {
      return {
        ok: false,
        output: null,
        error:
          'Invalid project name: must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63)',
        durationMs: Date.now() - start,
      };
    }

    try {
      const res = await fetch(`${serverUrl}/api/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverToken}`,
        },
        body: JSON.stringify({
          provider,
          content,
          projectName,
          workflowId: ctx.workflowId,
          runId: ctx.runId,
        }),
        signal: ctx.signal,
      });

      const httpFailed =
        res.ok === false
        || (typeof res.status === 'number' && res.status >= 400);
      if (httpFailed) {
        const body = await res.text().catch(() => '');
        // Scrub control chars from deploy API error bodies
        const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
        const status = typeof res.status === 'number' ? res.status : 0;
        return {
          ok: false,
          output: null,
          error: detail
            ? `Deploy failed: ${status}: ${detail}`
            : `Deploy failed: ${status}`,
          durationMs: Date.now() - start,
        };
      }
      const data = await res.json() as {
        ok?: boolean;
        data?: { url?: string; deploymentId?: string };
        error?: string;
      };
      if (data.ok === false) {
        let errMsg = 'Deploy failed';
        if (typeof data.error === 'string' && !/[\0\r\n]/.test(data.error)) {
          const e = data.error.trim();
          if (e) errMsg = e;
        }
        return {
          ok: false,
          output: null,
          error: errMsg,
          durationMs: Date.now() - start,
        };
      }
      // Only keep http(s) deployment URLs (control-char / non-http → empty)
      let url = '';
      if (typeof data.data?.url === 'string' && !/[\0\r\n]/.test(data.data.url)) {
        const u = data.data.url.trim();
        if (u && u.length <= 2_048) {
          try {
            const parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u) ? u : `https://${u}`);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = u;
          } catch {
            url = '';
          }
        }
      }
      return {
        ok: true,
        output: `Deployed to ${provider}: ${url || 'unknown URL'}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: scrubErrorMessage(err instanceof Error ? err.message : 'Deploy failed') || 'Deploy failed',
        durationMs: Date.now() - start,
      };
    }
  },
};
