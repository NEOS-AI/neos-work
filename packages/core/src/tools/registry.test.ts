import { describe, expect, it } from 'vitest';
import type { Tool } from './base.js';
import { ToolRegistry } from './registry.js';

function makeTool(name: string, execute?: Tool['execute']): Tool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute:
      execute ??
      (async () => ({ success: true, output: { name } })),
  };
}

describe('ToolRegistry', () => {
  it('registers, gets, and lists tools', () => {
    const reg = new ToolRegistry();
    const t = makeTool('echo');
    reg.register(t);
    expect(reg.get('echo')).toBe(t);
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.getAll()).toHaveLength(1);
  });

  it('toDefinitions maps tool metadata', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    expect(reg.toDefinitions()).toEqual([
      {
        name: 'a',
        description: 'a tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
  });

  it('execute returns error when tool missing', async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute('nope', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Tool not found/);
  });

  it('execute runs tool and catches thrown errors', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('ok'));
    reg.register(
      makeTool('boom', async () => {
        throw new Error('kaboom');
      }),
    );
    expect((await reg.execute('ok', {})).success).toBe(true);
    const fail = await reg.execute('boom', {});
    expect(fail.success).toBe(false);
    expect(fail.error).toBe('kaboom');
  });
});
