import { describe, expect, it } from 'vitest';
import { safeServerUrl } from './server-url.js';

describe('safeServerUrl', () => {
  it('trims and strips trailing slashes for http(s)', () => {
    expect(safeServerUrl('  https://api.example/v1/  ')).toBe('https://api.example/v1');
    expect(safeServerUrl('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it('falls back for blank, non-http, or invalid URLs', () => {
    expect(safeServerUrl('')).toBe('http://localhost:3001');
    expect(safeServerUrl('   ')).toBe('http://localhost:3001');
    expect(safeServerUrl('file:///etc/passwd')).toBe('http://localhost:3001');
    expect(safeServerUrl('javascript:alert(1)')).toBe('http://localhost:3001');
    expect(safeServerUrl('not a url')).toBe('http://localhost:3001');
    expect(safeServerUrl(null)).toBe('http://localhost:3001');
  });

  it('accepts custom fallback', () => {
    expect(safeServerUrl('file://x', 'http://localhost:3579')).toBe('http://localhost:3579');
  });

  it('strips multiple trailing slashes and rejects ftp/data schemes', () => {
    expect(safeServerUrl('https://api.example.com///')).toBe('https://api.example.com');
    expect(safeServerUrl('ftp://files.example')).toBe('http://localhost:3001');
    expect(safeServerUrl('data:text/plain,hi')).toBe('http://localhost:3001');
    expect(safeServerUrl(undefined)).toBe('http://localhost:3001');
    expect(safeServerUrl(123 as unknown as string)).toBe('http://localhost:3001');
  });
});
