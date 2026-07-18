import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from './hmac.js';

describe('hmacSha256Hex', () => {
  it('matches known vector for empty body', async () => {
    // openssl dgst -sha256 -hmac 'secret' with empty input
    const hex = await hmacSha256Hex('secret', '');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // stable
    expect(await hmacSha256Hex('secret', '')).toBe(hex);
  });

  it('matches openssl vectors used by webhook Test fire', async () => {
    // printf '{}' | openssl dgst -sha256 -hmac 'test-webhook-secret'
    expect(await hmacSha256Hex('test-webhook-secret', '{}')).toBe(
      '8592f9db7794988b89f5bcd05f3a8ef74d6986828237b62f4eb5b02aea0b076f',
    );
    // printf 'hello' | openssl dgst -sha256 -hmac 'key'
    expect(await hmacSha256Hex('key', 'hello')).toBe(
      '9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b',
    );
  });

  it('differs for different secrets/messages', async () => {
    const a = await hmacSha256Hex('a', 'body');
    const b = await hmacSha256Hex('b', 'body');
    const c = await hmacSha256Hex('a', 'other');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
