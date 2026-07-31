/**
 * Recoverable CLI exit codes (PLAN_FOR_V0_5_0 Task 11).
 * Scripts can branch on these without parsing stderr.
 */

export const EXIT = {
  OK: 0,
  /** Unexpected failure */
  INTERNAL: 1,
  /** Bad usage / unknown command */
  USAGE: 2,
  /** Daemon unreachable or health not ok */
  DAEMON_DOWN: 10,
  /** Missing/invalid auth token (401) */
  UNAUTHORIZED: 11,
  /** Resource not found (404) */
  NOT_FOUND: 12,
  /** Capability / permission denied (403) */
  CAPABILITY_DENIED: 13,
  /** Input validation failed (400) */
  VALIDATION: 14,
  /** Network / transport error */
  NETWORK: 15,
  /** GenUI / HITL waiting (reserved) */
  GENUI_WAITING: 16,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCodeFromHttp(status: number): ExitCode {
  if (status === 401) return EXIT.UNAUTHORIZED;
  if (status === 403) return EXIT.CAPABILITY_DENIED;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status >= 400 && status < 500) return EXIT.VALIDATION;
  if (status >= 500) return EXIT.INTERNAL;
  return EXIT.OK;
}
