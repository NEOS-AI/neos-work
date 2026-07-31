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

  it('trims workflow filter ids on load and save', () => {
    saveDeploymentWorkflowFilter('  wf-trim  ');
    expect(localStorage.getItem('neos-deployments-workflow')).toBe('wf-trim');
    expect(loadDeploymentWorkflowFilter()).toBe('wf-trim');
    localStorage.setItem('neos-deployments-workflow', '  spaced  ');
    expect(loadDeploymentWorkflowFilter()).toBe('spaced');
    saveDeploymentWorkflowFilter('   ');
    expect(localStorage.getItem('neos-deployments-workflow')).toBeNull();
  });

  it('rejects control-char workflow filter ids', () => {
    saveDeploymentWorkflowFilter('wf-ok');
    saveDeploymentWorkflowFilter('wf\nbad');
    expect(loadDeploymentWorkflowFilter()).toBe('');
    saveDeploymentWorkflowFilter('wf-ok');
    saveDeploymentWorkflowFilter('\nwf-ok');
    expect(loadDeploymentWorkflowFilter()).toBe('');
    localStorage.setItem('neos-deployments-workflow', 'bad\nid');
    expect(loadDeploymentWorkflowFilter()).toBe('');
  });

  it('rejects overlong workflow filter ids', () => {
    saveDeploymentWorkflowFilter('wf-ok');
    saveDeploymentWorkflowFilter('w'.repeat(101));
    expect(loadDeploymentWorkflowFilter()).toBe('');
    expect(localStorage.getItem('neos-deployments-workflow')).toBeNull();

    // Pre-existing overlong storage ignored on load
    localStorage.setItem('neos-deployments-workflow', 'w'.repeat(101));
    expect(loadDeploymentWorkflowFilter()).toBe('');
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

  it('ignores control-char status/provider storage', () => {
    localStorage.setItem('neos-deployments-status', `failed${'\0'}`);
    expect(loadDeploymentStatusFilter()).toBe('all');
    localStorage.setItem('neos-deployments-status', '  success  ');
    expect(loadDeploymentStatusFilter()).toBe('success');
    localStorage.setItem('neos-deployments-provider', '\nvercel');
    expect(loadDeploymentProviderFilter()).toBe('all');
  });

});

describe('deployment-filter-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when storage throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadDeploymentStatusFilter()).toBe('all');
      expect(loadDeploymentProviderFilter()).toBe('all');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('save ignores setItem failures', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => saveDeploymentStatusFilter('failed')).not.toThrow();
      expect(() => saveDeploymentProviderFilter('vercel')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
