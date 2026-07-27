import { describe, expect, it } from 'vitest';
import {
  checkEdgePortMismatch,
  isStrictPortsEnabled,
  parsePortDefs,
  portsFromOutputSchema,
  resolveNodeInputPorts,
  resolveNodeOutputPorts,
  typesCompatible,
  validateNodePorts,
} from './ports.js';

describe('parsePortDefs / portsFromOutputSchema', () => {
  it('parses and caps port defs', () => {
    expect(parsePortDefs(null)).toEqual([]);
    expect(
      parsePortDefs([
        { key: '  out  ', label: 'Out', required: true, schema: { type: 'string' } },
        { key: 'bad\nid' },
        { key: '' },
        null,
        'skip',
        { key: 'x'.repeat(120) },
      ]),
    ).toEqual([
      { key: 'out', label: 'Out', required: true, schema: { type: 'string' } },
      { key: 'x'.repeat(100) },
    ]);
  });

  it('maps outputSchema properties to ports', () => {
    const ports = portsFromOutputSchema({
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
        confidence: { type: 'number' },
      },
    });
    expect(ports).toEqual([
      { key: 'summary', required: true, schema: { type: 'string' } },
      { key: 'confidence', required: false, schema: { type: 'number' } },
    ]);
  });

  it('falls back to whole-value result port when no properties', () => {
    expect(portsFromOutputSchema({ type: 'string' })).toEqual([
      { key: 'result', schema: { type: 'string' }, required: false },
    ]);
    expect(portsFromOutputSchema({})).toEqual([]);
    expect(portsFromOutputSchema(null)).toEqual([]);
  });

  it('caps portsFromOutputSchema at 50 properties', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) properties[`k${i}`] = { type: 'string' };
    const ports = portsFromOutputSchema({ type: 'object', properties });
    expect(ports).toHaveLength(50);
  });

  it('skips control-char property keys in outputSchema', () => {
    const ports = portsFromOutputSchema({
      type: 'object',
      properties: {
        ok: { type: 'string' },
        [`bad${'\n'}k`]: { type: 'number' },
      },
    });
    expect(ports.map((p) => p.key)).toEqual(['ok']);
  });
});

describe('resolveNodePorts', () => {
  it('prefers explicit config ports', () => {
    const out = resolveNodeOutputPorts(
      {
        type: 'agent',
        config: { outputPorts: [{ key: 'x', schema: { type: 'string' } }] },
      },
      { workerOutputSchema: { type: 'object', properties: { a: { type: 'number' } } } },
    );
    expect(out).toEqual([{ key: 'x', schema: { type: 'string' } }]);
  });

  it('infers agent ports from worker outputSchema', () => {
    const out = resolveNodeOutputPorts(
      { type: 'agent', config: { workerId: 'finance_analyst' } },
      {
        workerOutputSchema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    );
    expect(out[0]?.key).toBe('summary');
    expect(out[0]?.required).toBe(true);
  });

  it('infers block input ports from paramDefs', () => {
    const ports = resolveNodeInputPorts(
      { type: 'block', config: { blockId: 'price_lookup' } },
      { block: { paramDefs: [{ key: 'symbol', type: 'string', label: 'Symbol' }] } },
    );
    expect(ports).toEqual([
      { key: 'symbol', label: 'Symbol', schema: { type: 'string' }, required: false },
    ]);
  });

  it('uses block outputDescription as opaque result port', () => {
    const out = resolveNodeOutputPorts(
      { type: 'block', config: { blockId: 'x' } },
      { block: { outputDescription: 'Price quote object' } },
    );
    expect(out).toEqual([
      {
        key: 'result',
        label: 'Block output',
        schema: { type: 'object', description: 'Price quote object' },
      },
    ]);
  });

  it('prefers explicit inputPorts over paramDefs', () => {
    const ports = resolveNodeInputPorts(
      {
        type: 'block',
        config: {
          inputPorts: [{ key: 'q', schema: { type: 'string' }, required: true }],
        },
      },
      { block: { paramDefs: [{ key: 'symbol', type: 'string' }] } },
    );
    expect(ports).toEqual([{ key: 'q', schema: { type: 'string' }, required: true }]);
  });
});

describe('typesCompatible / edge mismatch', () => {
  it('treats missing/any as compatible', () => {
    expect(typesCompatible(undefined, 'string')).toBe(true);
    expect(typesCompatible('string', 'any')).toBe(true);
    expect(typesCompatible('string', 'number')).toBe(false);
    expect(typesCompatible('integer', 'number')).toBe(true);
  });

  it('detects edge port type mismatch', () => {
    const msg = checkEdgePortMismatch(
      [{ key: 'result', schema: { type: 'string' } }],
      [{ key: 'in', schema: { type: 'number' } }],
    );
    expect(msg).toMatch(/mismatch/i);
    expect(
      checkEdgePortMismatch(
        [{ key: 'result', schema: { type: 'object' } }],
        [{ key: 'in', schema: { type: 'object' } }],
      ),
    ).toBeNull();
  });
});

describe('validateNodePorts', () => {
  it('warns on missing required inputs when upstream empty', () => {
    const issues = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [{ key: 'data', required: true, schema: { type: 'object' } }],
      outputPorts: [],
      inputs: {},
      hasIncomingEdges: true,
      strict: false,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.code).toBe('port.required_missing');
  });

  it('strict mode marks issues as error', () => {
    const issues = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [{ key: 'data', required: true }],
      outputPorts: [],
      inputs: {},
      hasIncomingEdges: true,
      strict: true,
    });
    expect(issues[0]!.severity).toBe('error');
  });

  it('checks output type and required fields', () => {
    // Non-JSON free-form agent text vs object schema is not a type error (agents stream text)
    const plainText = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [],
      outputPorts: [{ key: 'result', schema: { type: 'object' } }],
      inputs: {},
      hasIncomingEdges: false,
      output: 'plain string',
      strict: false,
    });
    expect(plainText.some((i) => i.code === 'port.output_type')).toBe(false);

    // Non-string wrong types still warn
    const typeIssues = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [],
      outputPorts: [{ key: 'result', schema: { type: 'object' } }],
      inputs: {},
      hasIncomingEdges: false,
      output: 42,
      strict: false,
    });
    expect(typeIssues.some((i) => i.code === 'port.output_type')).toBe(true);

    // JSON-as-text is coerced for required-field checks
    const jsonText = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [],
      outputPorts: [
        { key: 'result', schema: { type: 'object', required: ['summary'] } },
      ],
      inputs: {},
      hasIncomingEdges: false,
      output: '{"other":1}',
      strict: true,
    });
    expect(jsonText.some((i) => i.code === 'port.output_required')).toBe(true);

    const reqIssues = validateNodePorts({
      nodeId: 'n1',
      inputPorts: [],
      outputPorts: [
        { key: 'result', schema: { type: 'object', required: ['summary'] } },
      ],
      inputs: {},
      hasIncomingEdges: false,
      output: { other: 1 },
      strict: true,
    });
    expect(reqIssues.some((i) => i.code === 'port.output_required')).toBe(true);
    expect(reqIssues[0]!.severity).toBe('error');
  });

  it('checks string/number/array output types and required keys in upstream objects', () => {
    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'string' } }],
        inputs: {},
        hasIncomingEdges: false,
        output: 42,
        strict: false,
      }).some((i) => i.code === 'port.output_type'),
    ).toBe(true);

    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'number' } }],
        inputs: {},
        hasIncomingEdges: false,
        output: 'x',
        strict: false,
      }).some((i) => i.code === 'port.output_type'),
    ).toBe(true);

    // Numeric string is accepted for number ports
    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'number' } }],
        inputs: {},
        hasIncomingEdges: false,
        output: '3.14',
        strict: false,
      }),
    ).toEqual([]);

    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'array' } }],
        inputs: {},
        hasIncomingEdges: false,
        output: {},
        strict: false,
      }).some((i) => i.code === 'port.output_type'),
    ).toBe(true);

    // Free-form agent text for object schema is soft (no type error)
    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'object' } }],
        inputs: {},
        hasIncomingEdges: false,
        output: 'just a prose answer',
        strict: false,
      }),
    ).toEqual([]);

    // JSON-as-text object is parsed for required-field checks
    const jsonText = validateNodePorts({
      nodeId: 'n',
      inputPorts: [],
      outputPorts: [{ key: 'r', schema: { type: 'object', required: ['summary'] } }],
      inputs: {},
      hasIncomingEdges: false,
      output: '{"summary":"ok"}',
      strict: false,
    });
    expect(jsonText).toEqual([]);

    const jsonMissing = validateNodePorts({
      nodeId: 'n',
      inputPorts: [],
      outputPorts: [{ key: 'r', schema: { type: 'object', required: ['summary'] } }],
      inputs: {},
      hasIncomingEdges: false,
      output: '{"other":1}',
      strict: true,
    });
    expect(jsonMissing.some((i) => i.code === 'port.output_required')).toBe(true);

    // Invalid JSON object-looking string stays string (catch path)
    expect(
      validateNodePorts({
        nodeId: 'n',
        inputPorts: [],
        outputPorts: [{ key: 'r', schema: { type: 'object', required: ['x'] } }],
        inputs: {},
        hasIncomingEdges: false,
        output: '{not-json}',
        strict: false,
      }),
    ).toEqual([]);

    // Required key missing in object upstream outputs
    const miss = validateNodePorts({
      nodeId: 'n',
      inputPorts: [{ key: 'price', required: true }],
      outputPorts: [],
      inputs: { up: { other: 1 } },
      hasIncomingEdges: true,
      strict: false,
    });
    expect(miss.some((i) => i.code === 'port.required_missing')).toBe(true);

    // Non-object upstream still satisfies free-form required
    const ok = validateNodePorts({
      nodeId: 'n',
      inputPorts: [{ key: 'price', required: true }],
      outputPorts: [],
      inputs: { up: 'scalar' },
      hasIncomingEdges: true,
      strict: false,
    });
    expect(ok).toEqual([]);
  });

  it('caps block paramDefs at 50 input ports', () => {
    const paramDefs = Array.from({ length: 60 }, (_, i) => ({
      key: `p${i}`,
      type: i % 2 === 0 ? 'number' : 'boolean',
      label: `P${i}`,
    }));
    const ports = resolveNodeInputPorts(
      { type: 'block', config: {} },
      { block: { paramDefs } },
    );
    expect(ports).toHaveLength(50);
    expect(ports[0]?.schema?.type).toBe('number');
    expect(ports[1]?.schema?.type).toBe('boolean');
  });
});

describe('isStrictPortsEnabled', () => {
  it('accepts 1/true/yes/on', () => {
    expect(isStrictPortsEnabled({ strictPorts: '1' })).toBe(true);
    expect(isStrictPortsEnabled({ STRICT_PORTS: 'true' })).toBe(true);
    expect(isStrictPortsEnabled({ strictPorts: '0' })).toBe(false);
    expect(isStrictPortsEnabled({})).toBe(false);
  });
});
