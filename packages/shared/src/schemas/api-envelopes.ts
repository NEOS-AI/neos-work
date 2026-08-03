/**
 * Zod schemas for FE/BE wire contracts (write + collab envelopes).
 * Use for runtime parse/validate; TypeScript types stay in types/*.
 *
 * Live file IO uses `hash`; revision records use `contentHash` (not mixed).
 */

import { z } from 'zod';

// ── Envelope ───────────────────────────────────────────────

export function apiEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    ok: z.boolean(),
    data: data.optional(),
    error: z.string().optional(),
  });
}

/** Loose envelope when data shape is unknown. */
export const apiEnvelopeUnknownSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

// ── Live file write / read ─────────────────────────────────

/** PUT /api/projects/:id/files/* success `data`. */
export const projectFileWriteResultSchema = z.object({
  path: z.string().min(1),
  /** Content tip hash (NOT revision contentHash). */
  hash: z.string().min(1),
  bytes: z.number().nonnegative(),
  created: z.boolean(),
});

export const projectFileWriteResponseSchema = apiEnvelopeSchema(
  projectFileWriteResultSchema,
);

/** GET file success data. */
export const projectFileContentSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  hash: z.string().min(1),
});

export const projectFileContentResponseSchema = apiEnvelopeSchema(
  projectFileContentSchema,
);

/** File SSE data payload (event name is separate). */
export const projectFileEventPayloadSchema = z.object({
  projectId: z.string().optional(),
  path: z.string().optional(),
  source: z.string().optional(),
  hash: z.string().optional(),
  ts: z.string().optional(),
});

// ── Collab presence / locks / selection ────────────────────

export const presencePeerSchema = z.object({
  sessionId: z.string().min(1),
  displayName: z.string(),
  joinedAt: z.string().optional(),
  colorHint: z.number().optional(),
  lastSeen: z.string().optional(),
});

export const fileLockSchema = z.object({
  path: z.string().min(1),
  sessionId: z.string().min(1),
  displayName: z.string(),
  acquiredAt: z.string().optional(),
});

export const peerSelectionSchema = z.object({
  sessionId: z.string().min(1),
  displayName: z.string().optional(),
  colorHint: z.number().optional(),
  path: z.string().nullable(),
  selector: z.string().nullable(),
  layerId: z.string().nullable().optional(),
  selectors: z.array(z.string()).optional(),
  layerIds: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

/** Lock conflict 409 body: ok false + data.holder. */
export const lockHolderSchema = z.object({
  sessionId: z.string().min(1),
  displayName: z.string(),
  path: z.string().optional(),
  acquiredAt: z.string().optional(),
  colorHint: z.number().optional(),
});

export const collabLockConflictSchema = z.object({
  ok: z.literal(false),
  error: z.string().optional(),
  data: z
    .object({
      holder: lockHolderSchema.optional(),
    })
    .optional(),
});

export const collabLockSuccessSchema = apiEnvelopeSchema(
  z.object({
    lock: fileLockSchema.optional(),
    released: z.boolean().optional(),
    path: z.string().optional(),
    holder: lockHolderSchema.optional(),
  }),
);

export const collabPeersSnapshotSchema = apiEnvelopeSchema(
  z.object({
    peers: z.array(presencePeerSchema),
  }),
);

export const collabLocksSnapshotSchema = apiEnvelopeSchema(
  z.object({
    locks: z.array(fileLockSchema),
    hardEnforce: z.boolean().optional(),
  }),
);

export const collabSelectionsSnapshotSchema = apiEnvelopeSchema(
  z.object({
    selections: z.array(peerSelectionSchema),
  }),
);

export const collabSelectionPublishBodySchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().nullable().optional(),
  selector: z.string().nullable().optional(),
  layerId: z.string().nullable().optional(),
  selectors: z.array(z.string()).nullable().optional(),
  layerIds: z.array(z.string()).nullable().optional(),
});

export const collabLockBodySchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  action: z.enum(['acquire', 'release']),
});

// ── Parse helpers ──────────────────────────────────────────

export type ParseOk<T> = { ok: true; data: T };
export type ParseErr = { ok: false; error: string; issues?: z.ZodIssue[] };

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ParseOk<T> | ParseErr {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const msg = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, error: msg || 'schema validation failed', issues: r.error.issues };
}

/** Assert write response uses `hash` (guards contentHash regressions). */
export function parseProjectFileWriteResponse(input: unknown) {
  const parsed = parseWithSchema(projectFileWriteResponseSchema, input);
  if (!parsed.ok) return parsed;
  // Defense: reject contentHash-only masquerading as write success data
  const rawData =
    input && typeof input === 'object' && 'data' in input
      ? (input as { data?: unknown }).data
      : undefined;
  if (
    rawData
    && typeof rawData === 'object'
    && rawData !== null
    && 'contentHash' in rawData
    && !('hash' in rawData)
  ) {
    return {
      ok: false as const,
      error: 'write response must use hash, not contentHash alone',
    };
  }
  return parsed;
}

export function parseCollabLockConflict(input: unknown) {
  return parseWithSchema(collabLockConflictSchema, input);
}

// ── Lightweight OpenAPI fragment (JSON Schema 2020-ish) ────

/** Document-only fragment for OpenAPI components.schemas (no runtime OpenAPI server). */
export const openApiWireFragments = {
  ProjectFileWriteResult: {
    type: 'object',
    required: ['path', 'hash', 'bytes', 'created'],
    properties: {
      path: { type: 'string', description: 'Project-relative path' },
      hash: {
        type: 'string',
        description: 'Live content tip hash (not revision contentHash)',
      },
      bytes: { type: 'number' },
      created: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  ApiEnvelopeProjectFileWriteResult: {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      data: { $ref: '#/components/schemas/ProjectFileWriteResult' },
      error: { type: 'string' },
    },
  },
  LockHolder: {
    type: 'object',
    required: ['sessionId', 'displayName'],
    properties: {
      sessionId: { type: 'string' },
      displayName: { type: 'string' },
      path: { type: 'string' },
      acquiredAt: { type: 'string' },
    },
  },
  CollabLockConflict: {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean', enum: [false] },
      error: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          holder: { $ref: '#/components/schemas/LockHolder' },
        },
      },
    },
  },
  PeerSelection: {
    type: 'object',
    required: ['sessionId', 'path', 'selector'],
    properties: {
      sessionId: { type: 'string' },
      displayName: { type: 'string' },
      colorHint: { type: 'number' },
      path: { type: ['string', 'null'] },
      selector: { type: ['string', 'null'] },
      layerId: { type: ['string', 'null'] },
      selectors: { type: 'array', items: { type: 'string' } },
      layerIds: { type: 'array', items: { type: 'string' } },
      updatedAt: { type: 'string' },
    },
  },
} as const;
