import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_PROVIDER_FILTERS,
  DEPLOYMENT_STATUS_FILTERS,
  loadDeploymentProviderFilter,
  loadDeploymentStatusFilter,
  saveDeploymentProviderFilter,
  saveDeploymentStatusFilter,
} from './deployment-filter-prefs.js';

describe('deployment-filter-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable chip options', () => {
    expect(DEPLOYMENT_STATUS_FILTERS).toEqual([
      'all',
      'success',
      'failed',
      'deploying',
      'pending',
    ]);
    expect(DEPLOYMENT_PROVIDER_FILTERS).toEqual(['all', 'vercel', 'cloudflare']);
  });

  it('defaults status and provider filters to all', () => {
    expect(loadDeploymentStatusFilter()).toBe('all');
    expect(loadDeploymentProviderFilter()).toBe('all');
  });

  it('round-trips status filters', () => {
    saveDeploymentStatusFilter('failed');
    expect(loadDeploymentStatusFilter()).toBe('failed');
    saveDeploymentStatusFilter('deploying');
    expect(loadDeploymentStatusFilter()).toBe('deploying');
    saveDeploymentStatusFilter('all');
    expect(loadDeploymentStatusFilter()).toBe('all');
  });

  it('round-trips provider filters', () => {
    saveDeploymentProviderFilter('vercel');
    expect(loadDeploymentProviderFilter()).toBe('vercel');
    saveDeploymentProviderFilter('cloudflare');
    expect(loadDeploymentProviderFilter()).toBe('cloudflare');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-deployments-status', 'running');
    localStorage.setItem('neos-deployments-provider', 'netlify');
    expect(loadDeploymentStatusFilter()).toBe('all');
    expect(loadDeploymentProviderFilter()).toBe('all');
  });
});
