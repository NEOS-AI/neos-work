/**
 * Dev / opt-in runtime asserts for outbound FE/BE wire shapes.
 * Enabled when NODE_ENV !== 'production' OR NEOS_ASSERT_WIRE=1.
 * Never changes the HTTP body — only logs (or throws when NEOS_ASSERT_WIRE=throw).
 */

import {
  parseCollabLockConflict,
  parseProjectFileWriteResponse,
  parseWithSchema,
  collabLockSuccessSchema,
} from '@neos-work/shared';

export function wireAssertEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NEOS_ASSERT_WIRE === '0' || env.NEOS_ASSERT_WIRE === 'false') return false;
  if (env.NEOS_ASSERT_WIRE === '1' || env.NEOS_ASSERT_WIRE === 'true' || env.NEOS_ASSERT_WIRE === 'throw') {
    return true;
  }
  return env.NODE_ENV !== 'production';
}

function wireAssertMode(env: NodeJS.ProcessEnv = process.env): 'log' | 'throw' {
  return env.NEOS_ASSERT_WIRE === 'throw' ? 'throw' : 'log';
}

function report(label: string, error: string, env: NodeJS.ProcessEnv = process.env): void {
  const msg = `[wire-assert] ${label}: ${error}`;
  if (wireAssertMode(env) === 'throw') {
    throw new Error(msg);
  }
  console.warn(msg);
}

/** Assert successful file write envelope before sending. */
export function assertProjectFileWriteResponse(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!wireAssertEnabled(env)) return;
  const r = parseProjectFileWriteResponse(body);
  if (!r.ok) report('project file write response', r.error, env);
}

/** Assert lock acquire/release success envelope. */
export function assertCollabLockSuccessResponse(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!wireAssertEnabled(env)) return;
  const r = parseWithSchema(collabLockSuccessSchema, body);
  if (!r.ok) report('collab lock success response', r.error, env);
}

/** Assert lock conflict (409) envelope with optional holder. */
export function assertCollabLockConflictResponse(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!wireAssertEnabled(env)) return;
  const r = parseCollabLockConflict(body);
  if (!r.ok) report('collab lock conflict response', r.error, env);
}
