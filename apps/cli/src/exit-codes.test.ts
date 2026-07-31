import { describe, expect, it } from 'vitest';
import { EXIT, exitCodeFromHttp } from './exit-codes.js';

describe('exitCodeFromHttp', () => {
  it('maps status classes', () => {
    expect(exitCodeFromHttp(401)).toBe(EXIT.UNAUTHORIZED);
    expect(exitCodeFromHttp(403)).toBe(EXIT.CAPABILITY_DENIED);
    expect(exitCodeFromHttp(404)).toBe(EXIT.NOT_FOUND);
    expect(exitCodeFromHttp(400)).toBe(EXIT.VALIDATION);
    expect(exitCodeFromHttp(500)).toBe(EXIT.INTERNAL);
    expect(exitCodeFromHttp(200)).toBe(EXIT.OK);
  });
});
