/**
 * Typed ports MVP (PLAN_FOR_V0_4_0 Task 9 / Q5).
 *
 * Best-effort contracts — not a full schema engine.
 * - Default: soft warnings (node.warning / editor yellow badge)
 * - settings.strictPorts === '1': hard-fail at runtime
 */

import type { PortDef, WorkflowNode } from '@neos-work/shared';

export type PortCheckSeverity = 'warning' | 'error';

export interface PortIssue {
  severity: PortCheckSeverity;
  nodeId: string;
  edgeId?: string;
  message: string;
  code: string;
}

export interface ResolvePortsOptions {
  /** Domain worker outputSchema when node is an agent with workerId */
  workerOutputSchema?: Record<string, unknown> | null;
  /** Block metadata for block nodes */
  block?: {
    paramDefs?: Array<{ key: string; type?: string; label?: string }>;
    outputDescription?: string;
  } | null;
}

const PORT_KEY_MAX = 100;
const PORTS_MAX = 50;

function safeKey(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().slice(0, PORT_KEY_MAX);
}

/** Parse PortDef[] from free-form config (hygiene + caps). */
export function parsePortDefs(raw: unknown): PortDef[] {
  if (!Array.isArray(raw)) return [];
  const out: PortDef[] = [];
  for (const item of raw.slice(0, PORTS_MAX)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const key = safeKey((item as PortDef).key);
    if (!key) continue;
    const def: PortDef = { key };
    const label = (item as PortDef).label;
    if (typeof label === 'string' && !/[\0\r\n]/.test(label)) {
      def.label = label.trim().slice(0, 200) || undefined;
    }
    if ((item as PortDef).required === true) def.required = true;
    const schema = (item as PortDef).schema;
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      def.schema = schema as Record<string, unknown>;
    }
    out.push(def);
  }
  return out;
}

/** Map JSON-schema-ish object → PortDef list (properties + required). */
export function portsFromOutputSchema(
  schema: Record<string, unknown> | null | undefined,
): PortDef[] {
  if (!schema || typeof schema !== 'object') return [];
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  const props = schema.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.map((r) => String(r ?? '')).filter(Boolean)
        : [],
    );
    const ports: PortDef[] = [];
    for (const [key, val] of Object.entries(props as Record<string, unknown>)) {
      const k = safeKey(key);
      if (!k) continue;
      const propSchema =
        val && typeof val === 'object' && !Array.isArray(val)
          ? (val as Record<string, unknown>)
          : undefined;
      ports.push({
        key: k,
        required: required.has(k),
        schema: propSchema,
      });
      if (ports.length >= PORTS_MAX) break;
    }
    return ports;
  }
  // Whole-value schema (e.g. { type: 'object', required: [...] })
  if (type) {
    return [{ key: 'result', schema: { type }, required: false }];
  }
  return [];
}

/** Infer ports for a workflow node (config override wins). */
export function resolveNodeOutputPorts(
  node: Pick<WorkflowNode, 'type' | 'config'>,
  opts: ResolvePortsOptions = {},
): PortDef[] {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const explicit = parsePortDefs(cfg.outputPorts);
  if (explicit.length > 0) return explicit;

  if (
    node.type === 'agent'
    || node.type === 'agent_finance'
    || node.type === 'agent_coding'
  ) {
    return portsFromOutputSchema(opts.workerOutputSchema ?? undefined);
  }

  if (node.type === 'block' && opts.block) {
    // Block outputs are free-form; use a single opaque port with description
    if (opts.block.outputDescription) {
      return [
        {
          key: 'result',
          label: 'Block output',
          schema: { type: 'object', description: opts.block.outputDescription },
        },
      ];
    }
  }

  return [];
}

export function resolveNodeInputPorts(
  node: Pick<WorkflowNode, 'type' | 'config'>,
  opts: ResolvePortsOptions = {},
): PortDef[] {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const explicit = parsePortDefs(cfg.inputPorts);
  if (explicit.length > 0) return explicit;

  if (node.type === 'block' && opts.block?.paramDefs) {
    const ports: PortDef[] = [];
    for (const p of opts.block.paramDefs) {
      const key = safeKey(p.key);
      if (!key) continue;
      const schemaType =
        p.type === 'number' || p.type === 'boolean' || p.type === 'string'
          ? p.type
          : 'string';
      ports.push({
        key,
        label: typeof p.label === 'string' ? p.label : key,
        schema: { type: schemaType },
        required: false,
      });
      if (ports.length >= PORTS_MAX) break;
    }
    return ports;
  }

  return [];
}

function schemaType(schema?: Record<string, unknown>): string | undefined {
  if (!schema) return undefined;
  const t = schema.type;
  return typeof t === 'string' && t.trim() ? t.trim().toLowerCase() : undefined;
}

/** Best-effort type compatibility (any / missing → ok). */
export function typesCompatible(
  sourceType: string | undefined,
  targetType: string | undefined,
): boolean {
  if (!sourceType || !targetType) return true;
  if (sourceType === 'any' || targetType === 'any') return true;
  if (sourceType === targetType) return true;
  // number/integer interchange
  if (
    (sourceType === 'number' || sourceType === 'integer')
    && (targetType === 'number' || targetType === 'integer')
  ) {
    return true;
  }
  return false;
}

/**
 * Edge-level port mismatch (source output vs target input).
 * Uses first declared port of each side when multiple exist.
 */
export function checkEdgePortMismatch(
  sourcePorts: PortDef[],
  targetPorts: PortDef[],
): string | null {
  if (sourcePorts.length === 0 || targetPorts.length === 0) return null;
  // Prefer matching keys; else compare primary ports
  for (const tp of targetPorts) {
    const sp =
      sourcePorts.find((s) => s.key === tp.key) ?? sourcePorts[0];
    if (!sp) continue;
    const st = schemaType(sp.schema);
    const tt = schemaType(tp.schema);
    if (!typesCompatible(st, tt)) {
      return `Port type mismatch: source "${sp.key}" (${st}) → target "${tp.key}" (${tt})`;
    }
  }
  return null;
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Runtime check of node inputs / produced output against declared ports.
 * @param strict when true, issues are severity error (caller hard-fails)
 */
export function validateNodePorts(opts: {
  nodeId: string;
  inputPorts: PortDef[];
  outputPorts: PortDef[];
  /** Merged upstream outputs keyed by source node id */
  inputs: Record<string, unknown>;
  /** Produced output after execute (optional; skip if not yet run) */
  output?: unknown;
  hasIncomingEdges: boolean;
  strict: boolean;
}): PortIssue[] {
  const severity: PortCheckSeverity = opts.strict ? 'error' : 'warning';
  const issues: PortIssue[] = [];
  const nodeId = opts.nodeId;

  const required = opts.inputPorts.filter((p) => p.required);
  if (required.length > 0 && opts.hasIncomingEdges && Object.keys(opts.inputs).length === 0) {
    for (const p of required) {
      issues.push({
        severity,
        nodeId,
        code: 'port.required_missing',
        message: `Required input port "${p.key}" has no upstream data`,
      });
    }
  }

  // Required keys on aggregated object outputs (best-effort)
  if (required.length > 0 && Object.keys(opts.inputs).length > 0) {
    const values = Object.values(opts.inputs);
    for (const p of required) {
      const found = values.some((v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return p.key in (v as Record<string, unknown>);
        }
        // Non-object upstream still counts as "data present" for free-form graphs
        return true;
      });
      if (!found) {
        issues.push({
          severity,
          nodeId,
          code: 'port.required_missing',
          message: `Required input port "${p.key}" not found in upstream outputs`,
        });
      }
    }
  }

  if (opts.output !== undefined && opts.outputPorts.length > 0) {
    const primary = opts.outputPorts[0]!;
    // Agents often return JSON-as-text; coerce for object/array port checks
    let checkedOutput: unknown = opts.output;
    if (typeof checkedOutput === 'string') {
      const trimmed = checkedOutput.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          checkedOutput = JSON.parse(trimmed) as unknown;
        } catch {
          // keep string
        }
      }
    }
    const expected = schemaType(primary.schema);
    if (expected && expected !== 'any') {
      const actual = valueType(checkedOutput);
      // object schema: free-form agent text (non-JSON string) is not a hard mismatch
      if (expected === 'object' && actual !== 'object') {
        if (actual !== 'string') {
          issues.push({
            severity,
            nodeId,
            code: 'port.output_type',
            message: `Output type mismatch: expected object, got ${actual}`,
          });
        }
      } else if (expected === 'string' && actual !== 'string') {
        issues.push({
          severity,
          nodeId,
          code: 'port.output_type',
          message: `Output type mismatch: expected string, got ${actual}`,
        });
      } else if (
        expected === 'number'
        && actual !== 'number'
        && !(expected === 'number' && actual === 'string' && Number.isFinite(Number(checkedOutput)))
      ) {
        issues.push({
          severity,
          nodeId,
          code: 'port.output_type',
          message: `Output type mismatch: expected number, got ${actual}`,
        });
      } else if (expected === 'array' && actual !== 'array') {
        issues.push({
          severity,
          nodeId,
          code: 'port.output_type',
          message: `Output type mismatch: expected array, got ${actual}`,
        });
      }
    }

    // JSON-schema required keys on object output (incl. JSON-parsed agent text)
    const schema = primary.schema;
    if (
      schema
      && Array.isArray(schema.required)
      && checkedOutput
      && typeof checkedOutput === 'object'
      && !Array.isArray(checkedOutput)
    ) {
      const obj = checkedOutput as Record<string, unknown>;
      for (const req of schema.required) {
        const k = String(req ?? '');
        if (k && !(k in obj)) {
          issues.push({
            severity,
            nodeId,
            code: 'port.output_required',
            message: `Output missing required field "${k}"`,
          });
        }
      }
    }
  }

  return issues;
}

export function isStrictPortsEnabled(settings: Record<string, string> | undefined): boolean {
  const raw = settings?.['strictPorts'] ?? settings?.['STRICT_PORTS'] ?? '';
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
