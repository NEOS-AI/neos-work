/** Browser HMAC-SHA256 hex digest (for webhook test fire, plan Task 13). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  // Control-char secrets/messages rejected (align with server webhook verify)
  if (typeof secret !== 'string' || typeof message !== 'string') {
    throw new Error('secret and message must be strings');
  }
  if (/[\0\r\n]/.test(secret)) {
    throw new Error('secret contains invalid control characters');
  }
  if (/\0/.test(message)) {
    throw new Error('message contains invalid control characters');
  }
  const secretTrimmed = secret.trim();
  if (!secretTrimmed) {
    throw new Error('secret is required');
  }
  if (secretTrimmed.length > 8_192) {
    throw new Error('secret exceeds max length');
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretTrimmed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
