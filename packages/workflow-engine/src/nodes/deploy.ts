/**
 * DeployNode — deploys content to Vercel or Cloudflare Pages via server API
 */

import { isValidDeployProjectName } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { safeServerUrl } from './server-url.js';

export { isValidDeployProjectName };

export const DeployNode: ExecutableNode = {
  type: 'deploy',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    const rawProvider = String(config?.provider ?? 'vercel').trim().toLowerCase();
    const provider = rawProvider === 'cloudflare' ? 'cloudflare' : 'vercel';
    const serverUrl = safeServerUrl(settings['SERVER_URL']);
    const serverToken = String(settings['SERVER_TOKEN'] ?? '').trim();

    const DEPLOY_CONTENT_MAX = 2 * 1024 * 1024;
    const rawContent = inputs['content'] ?? config?.content ?? '';
    const content = typeof rawContent === 'string' ? rawContent.trim() : String(rawContent).trim();
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

    const projectName = String(
      config?.projectName ?? inputs['projectName'] ?? 'neos-deploy',
    ).trim() || 'neos-deploy';
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
        const detail = body.trim().slice(0, 500);
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
        return {
          ok: false,
          output: null,
          error: typeof data.error === 'string' && data.error.trim()
            ? data.error.trim()
            : 'Deploy failed',
          durationMs: Date.now() - start,
        };
      }
      const url = typeof data.data?.url === 'string' ? data.data.url.trim() : '';
      return {
        ok: true,
        output: `Deployed to ${provider}: ${url || 'unknown URL'}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : 'Deploy failed',
        durationMs: Date.now() - start,
      };
    }
  },
};
