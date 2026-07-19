import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPLOYMENT_PROVIDER_FILTERS,
  DEPLOYMENT_STATUS_FILTERS,
  loadDeploymentProviderFilter,
  loadDeploymentStatusFilter,
  loadDeploymentWorkflowFilter,
  saveDeploymentProviderFilter,
  saveDeploymentStatusFilter,
  saveDeploymentWorkflowFilter,
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

  it('round-trips workflow filter and clears on empty', () => {
    expect(loadDeploymentWorkflowFilter()).toBe('');
    saveDeploymentWorkflowFilter('wf-abc');
    expect(loadDeploymentWorkflowFilter()).toBe('wf-abc');
    saveDeploymentWorkflowFilter('');
    expect(loadDeploymentWorkflowFilter()).toBe('');
    expect(localStorage.getItem('neos-deployments-workflow')).toBeNull();
  });

  it('load returns empty when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadDeploymentWorkflowFilter()).toBe('');
    spy.mockRestore();
  });

  it('save swallows localStorage errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveDeploymentWorkflowFilter('wf-x')).not.toThrow();
    spy.mockRestore();
  });
});
