/**
 * DeployNode — deploys content to Vercel or Cloudflare Pages via server API
 */

import { isValidDeployProjectName } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

export { isValidDeployProjectName };

export const DeployNode: ExecutableNode = {
  type: 'deploy',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    const rawProvider = String(config?.provider ?? 'vercel').trim().toLowerCase();
    const provider = rawProvider === 'cloudflare' ? 'cloudflare' : 'vercel';
    const serverUrl = String(settings['SERVER_URL'] ?? 'http://localhost:3001').trim()
      || 'http://localhost:3001';
    const serverToken = String(settings['SERVER_TOKEN'] ?? '').trim();

    const rawContent = inputs['content'] ?? config?.content ?? '';
    const content = typeof rawContent === 'string' ? rawContent.trim() : String(rawContent).trim();
    if (!content) {
      return { ok: false, output: null, error: 'No content to deploy', durationMs: Date.now() - start };
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

      const data = await res.json() as { ok: boolean; data?: { url: string; deploymentId?: string }; error?: string };
      if (!data.ok) {
        return {
          ok: false,
          output: null,
          error: data.error ?? 'Deploy failed',
          durationMs: Date.now() - start,
        };
      }
      return {
        ok: true,
        output: `Deployed to ${provider}: ${data.data?.url ?? 'unknown URL'}`,
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
