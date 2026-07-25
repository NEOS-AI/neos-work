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
    expect(reg.get('echo')?.name).toBe('echo');
    expect(reg.get('  echo  ')?.name).toBe('echo');
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.get('   ')).toBeUndefined();
    expect(reg.getAll()).toHaveLength(1);

    reg.register(makeTool('  pad-name  '));
    expect(reg.get('pad-name')?.name).toBe('pad-name');
    reg.register(makeTool('   '));
    expect(reg.getAll()).toHaveLength(2);
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
    const blank = await reg.execute('   ', {});
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/Tool name is required/i);
  });

  it('rejects control-char / overlong tool names and caps description', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('bad\nname'));
    expect(reg.getAll()).toHaveLength(0);
    // Leading control char must not strip to a valid name
    reg.register(makeTool('\necho'));
    expect(reg.get('echo')).toBeUndefined();
    expect(reg.get('\necho')).toBeUndefined();
    expect(await reg.execute('\necho', {})).toMatchObject({ success: false });
    reg.register(makeTool('n'.repeat(201)));
    expect(reg.getAll()).toHaveLength(0);
    reg.register({
      name: 'ok',
      description: 'd'.repeat(3_000),
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ success: true, output: null }),
    });
    expect(reg.get('ok')?.description.length).toBe(2_000);
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

    reg.register(
      makeTool('throw-string', async () => {
        throw 'raw-string';
      }),
    );
    const nonErr = await reg.execute('throw-string', null as unknown as Record<string, unknown>);
    expect(nonErr.success).toBe(false);
    expect(nonErr.error).toBe('Tool execution failed');
  });

  it('caps registry size and still allows re-register of existing names', async () => {
    const { TOOL_REGISTRY_MAX } = await import('./registry.js');
    const reg = new ToolRegistry();
    for (let i = 0; i < TOOL_REGISTRY_MAX; i++) {
      reg.register(makeTool(`t${i}`));
    }
    expect(reg.getAll()).toHaveLength(TOOL_REGISTRY_MAX);

    // New name beyond cap is dropped
    reg.register(makeTool('overflow'));
    expect(reg.get('overflow')).toBeUndefined();
    expect(reg.getAll()).toHaveLength(TOOL_REGISTRY_MAX);

    // Re-register existing name still updates (does not grow)
    const updated = makeTool('t0', async () => ({ success: true, output: { v: 2 } }));
    reg.register(updated);
    expect(reg.getAll()).toHaveLength(TOOL_REGISTRY_MAX);
    expect((await reg.execute('t0', {})).output).toEqual({ v: 2 });

    // Overlong execute name
    const long = await reg.execute('n'.repeat(201), {});
    expect(long.success).toBe(false);
    expect(long.error).toMatch(/Invalid tool name/i);
  });
});
