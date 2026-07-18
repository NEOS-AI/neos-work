import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadWorkflowListDomain,
  loadWorkflowListSort,
  saveWorkflowListDomain,
  saveWorkflowListSort,
} from './workflow-list-prefs.js';

describe('workflow-list-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to updated when empty', () => {
    expect(loadWorkflowListSort()).toBe('updated');
  });

  it('round-trips name and updated', () => {
    saveWorkflowListSort('name');
    expect(loadWorkflowListSort()).toBe('name');
    saveWorkflowListSort('updated');
    expect(loadWorkflowListSort()).toBe('updated');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-workflows-sort', 'created');
    expect(loadWorkflowListSort()).toBe('updated');
  });

  it('defaults domain to all', () => {
    expect(loadWorkflowListDomain()).toBe('all');
  });

  it('round-trips domain filter', () => {
    saveWorkflowListDomain('coding');
    expect(loadWorkflowListDomain()).toBe('coding');
    saveWorkflowListDomain('all');
    expect(loadWorkflowListDomain()).toBe('all');
  });

  it('ignores invalid domain', () => {
    localStorage.setItem('neos-workflows-domain', 'ops');
    expect(loadWorkflowListDomain()).toBe('all');
  });
});
