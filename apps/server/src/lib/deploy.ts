/**
 * Deploy helpers — Vercel and Cloudflare Pages
 * These make REST API calls to each platform's deployment API.
 */

/** Re-export shared deploy project name validator (single source of truth). */
export { isValidDeployProjectName } from '@neos-work/shared';

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
  if (err instanceof Error) return err;
  return new Error(fallback);
}

/** Poll Vercel deployment status by deployment id. */
export async function getVercelDeploymentStatus(
  deploymentId: string,
  apiToken: string,
): Promise<RemoteDeployStatusResult> {
  let res: Response;
  try {
    res = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`, {
      headers: { Authorization: `Bearer ${apiToken.trim()}` },
    });
  } catch (err) {
    throw networkError(err, 'Vercel status network error');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(errBody.error?.message ?? `Vercel status error ${res.status}`);
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
    url: host ? (host.startsWith('http') ? host : `https://${host}`) : undefined,
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
  const { accountId, projectName, deploymentId, apiToken } = options;
  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
      { headers: { Authorization: `Bearer ${apiToken.trim()}` } },
    );
  } catch (err) {
    throw networkError(err, 'Cloudflare status network error');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { errors?: { message: string }[] };
    throw new Error(errBody.errors?.[0]?.message ?? `Cloudflare status error ${res.status}`);
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
    url: data.result?.url,
    statusMessage: data.result?.latest_stage?.status,
    readyState: data.result?.latest_stage?.status,
  };
}

export async function deployToVercel(options: {
  projectName: string;
  content: string;
  apiToken: string;
}): Promise<DeployResult> {
  const { projectName, content, apiToken } = options;

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
        Authorization: `Bearer ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deployBody),
    });
  } catch (err) {
    throw networkError(err, 'Vercel deploy network error');
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(errBody.error?.message ?? `Vercel API error ${res.status}`);
  }

  const data = await res.json() as { url?: string; id?: string };
  if (!data.url) throw new Error('No deployment URL returned');

  return {
    url: `https://${data.url}`,
    deploymentId: data.id,
  };
}

export async function deployToCloudflare(options: {
  projectName: string;
  content: string;
  accountId: string;
  apiToken: string;
}): Promise<DeployResult> {
  const { projectName, content, accountId, apiToken } = options;

  // First ensure project exists
  try {
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: projectName, production_branch: 'main' }),
    });
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
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken.trim()}` },
        body: formData,
      },
    );
  } catch (err) {
    throw networkError(err, 'Cloudflare deploy network error');
  }

  if (!deployRes.ok) {
    const errBody = await deployRes.json().catch(() => ({})) as { errors?: { message: string }[] };
    throw new Error(errBody.errors?.[0]?.message ?? `Cloudflare API error ${deployRes.status}`);
  }

  const data = await deployRes.json() as { result?: { url?: string; id?: string } };
  const url = data.result?.url ?? `https://${projectName}.pages.dev`;
  return { url, deploymentId: data.result?.id };
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
