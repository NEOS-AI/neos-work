/**
 * DeployNode — deploys content to Vercel or Cloudflare Pages via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

export const DeployNode: ExecutableNode = {
  type: 'deploy',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const { config, settings, inputs } = ctx;
    const provider = (config?.provider as string) ?? 'vercel';
    const serverUrl = settings['SERVER_URL'] ?? 'http://localhost:3001';
    const serverToken = settings['SERVER_TOKEN'] ?? '';

    const content = (inputs['content'] as string) ?? (config?.content as string) ?? '';
    if (!content) return { ok: false, error: 'No content to deploy' };

    const projectName = (config?.projectName as string) ?? (inputs['projectName'] as string) ?? 'neos-deploy';

    const res = await fetch(`${serverUrl}/api/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serverToken}`,
      },
      body: JSON.stringify({ provider, content, projectName }),
      signal: ctx.signal,
    });

    const data = await res.json() as { ok: boolean; data?: { url: string; deploymentId?: string }; error?: string };
    if (!data.ok) return { ok: false, error: data.error ?? 'Deploy failed' };
    return {
      ok: true,
      output: `Deployed to ${provider}: ${data.data?.url ?? 'unknown URL'}`,
    };
  },
};
