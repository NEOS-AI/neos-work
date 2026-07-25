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
const WORKFLOW_KEY = 'neos-deployments-workflow';

const STATUS_ALLOWED = new Set<string>(['all', 'success', 'failed', 'deploying', 'pending']);
const PROVIDER_ALLOWED = new Set<string>(['all', 'vercel', 'cloudflare']);

function parseStatus(raw: unknown): DeploymentStatusFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return STATUS_ALLOWED.has(v) ? (v as DeploymentStatusFilter) : null;
}

function parseProvider(raw: unknown): DeploymentProviderFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return PROVIDER_ALLOWED.has(v) ? (v as DeploymentProviderFilter) : null;
}

export function loadDeploymentStatusFilter(): DeploymentStatusFilter {
  try {
    return parseStatus(localStorage.getItem(STATUS_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveDeploymentStatusFilter(status: DeploymentStatusFilter): void {
  try {
    const parsed = parseStatus(status);
    if (parsed) localStorage.setItem(STATUS_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}

export function loadDeploymentProviderFilter(): DeploymentProviderFilter {
  try {
    return parseProvider(localStorage.getItem(PROVIDER_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveDeploymentProviderFilter(provider: DeploymentProviderFilter): void {
  try {
    const parsed = parseProvider(provider);
    if (parsed) localStorage.setItem(PROVIDER_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}

/** Persist Deployments workflow dropdown (empty string = all workflows). */
export function loadDeploymentWorkflowFilter(): string {
  try {
    const raw = localStorage.getItem(WORKFLOW_KEY) ?? '';
    // Control-char stored values ignored (check before trim)
    if (!raw || /[\0\r\n]/.test(raw)) return '';
    const id = raw.trim();
    // Align with save cap (overlong → treat as all workflows)
    if (!id || id.length > 100) return '';
    return id;
  } catch {
    return '';
  }
}

export function saveDeploymentWorkflowFilter(workflowId: string): void {
  try {
    // Control-char workflow ids never persisted
    if (typeof workflowId !== 'string' || /[\0\r\n]/.test(workflowId)) {
      localStorage.removeItem(WORKFLOW_KEY);
      return;
    }
    const id = workflowId.trim();
    if (!id || id.length > 100) {
      localStorage.removeItem(WORKFLOW_KEY);
    } else {
      localStorage.setItem(WORKFLOW_KEY, id);
    }
  } catch {
    // ignore quota / private mode
  }
}
