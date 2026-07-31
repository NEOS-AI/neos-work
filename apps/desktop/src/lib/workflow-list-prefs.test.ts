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

  it('round-trips domain filter including research', () => {
    saveWorkflowListDomain('coding');
    expect(loadWorkflowListDomain()).toBe('coding');
    saveWorkflowListDomain('research');
    expect(loadWorkflowListDomain()).toBe('research');
    saveWorkflowListDomain('all');
    expect(loadWorkflowListDomain()).toBe('all');
  });

  it('ignores invalid domain', () => {
    localStorage.setItem('neos-workflows-domain', 'ops');
    expect(loadWorkflowListDomain()).toBe('all');
  });

  it('ignores control-char sort/domain storage', () => {
    localStorage.setItem('neos-workflows-sort', `name${'\0'}`);
    expect(loadWorkflowListSort()).toBe('updated');
    localStorage.setItem('neos-workflows-sort', '  name  ');
    expect(loadWorkflowListSort()).toBe('name');
    localStorage.setItem('neos-workflows-domain', '\ncoding');
    expect(loadWorkflowListDomain()).toBe('all');
  });

});

describe('workflow-list-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when storage throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadWorkflowListSort()).toBe('updated');
      expect(loadWorkflowListDomain()).toBe('all');
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
      expect(() => saveWorkflowListSort('name')).not.toThrow();
      expect(() => saveWorkflowListDomain('coding')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
