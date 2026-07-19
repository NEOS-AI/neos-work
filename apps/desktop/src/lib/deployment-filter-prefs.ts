/** Persist Deployments page status / provider chips (PLAN Task 8 polish). */

export type DeploymentStatusFilter = 'all' | 'success' | 'failed' | 'deploying' | 'pending';
export type DeploymentProviderFilter = 'all' | 'vercel' | 'cloudflare';

export const DEPLOYMENT_STATUS_FILTERS: readonly DeploymentStatusFilter[] = [
  'all',
  'success',
  'failed',
  'deploying',
  'pending',
] as const;

export const DEPLOYMENT_PROVIDER_FILTERS: readonly DeploymentProviderFilter[] = [
  'all',
  'vercel',
  'cloudflare',
] as const;

const STATUS_KEY = 'neos-deployments-status';
const PROVIDER_KEY = 'neos-deployments-provider';

export function loadDeploymentStatusFilter(): DeploymentStatusFilter {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    if (
      v === 'all' ||
      v === 'success' ||
      v === 'failed' ||
      v === 'deploying' ||
      v === 'pending'
    ) {
      return v;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveDeploymentStatusFilter(status: DeploymentStatusFilter): void {
  try {
    if (
      status === 'all' ||
      status === 'success' ||
      status === 'failed' ||
      status === 'deploying' ||
      status === 'pending'
    ) {
      localStorage.setItem(STATUS_KEY, status);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function loadDeploymentProviderFilter(): DeploymentProviderFilter {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    if (v === 'all' || v === 'vercel' || v === 'cloudflare') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveDeploymentProviderFilter(provider: DeploymentProviderFilter): void {
  try {
    if (provider === 'all' || provider === 'vercel' || provider === 'cloudflare') {
      localStorage.setItem(PROVIDER_KEY, provider);
    }
  } catch {
    // ignore quota / private mode
  }
}
