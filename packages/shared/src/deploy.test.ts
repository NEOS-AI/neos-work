import { describe, expect, it } from 'vitest';
import { isValidDeployProjectName } from './deploy.js';

describe('isValidDeployProjectName', () => {
  it('accepts valid names', () => {
    expect(isValidDeployProjectName('neos-deploy')).toBe(true);
    expect(isValidDeployProjectName('  neos-deploy  ')).toBe(true);
    expect(isValidDeployProjectName('My_App1')).toBe(true);
    expect(isValidDeployProjectName('a')).toBe(true);
    expect(isValidDeployProjectName('A' + 'b'.repeat(62))).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidDeployProjectName('')).toBe(false);
    expect(isValidDeployProjectName('   ')).toBe(false);
    expect(isValidDeployProjectName('-bad')).toBe(false);
    expect(isValidDeployProjectName('_bad')).toBe(false);
    expect(isValidDeployProjectName('has space')).toBe(false);
    expect(isValidDeployProjectName('dot.name')).toBe(false);
    expect(isValidDeployProjectName('A' + 'b'.repeat(63))).toBe(false);
  });
});
