import { describe, expect, it } from 'vitest';
import type { Tool } from './base.js';
import { scrubErrorMessage } from './base.js';
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

    // Invalid inputSchema falls back to empty object schema; null-byte description scrubbed
    reg.register({
      name: 'schema_fallback',
      description: `desc${'\0'}x`,
      inputSchema: ['not', 'an', 'object'] as never,
      execute: async () => ({ success: true, output: 1 }),
    });
    const t = reg.get('schema_fallback');
    expect(t?.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(t?.description).toBe('desc x');
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

  it('scrubs control chars from thrown and returned tool errors', async () => {
    expect(scrubErrorMessage(`boom${'\n'}now${'\0'}!`)).toBe('boom now!');
    expect(scrubErrorMessage('\0\n')).toBe('');

    const reg = new ToolRegistry();
    reg.register(
      makeTool('throw-ctrl', async () => {
        throw new Error(`disk${'\n'}full${'\0'}!`);
      }),
    );
    reg.register(
      makeTool('return-ctrl', async () => ({
        success: false,
        output: null,
        error: `bad${'\0'}err\nline`,
      })),
    );
    const thrown = await reg.execute('throw-ctrl', {});
    expect(thrown.success).toBe(false);
    expect(thrown.error).toBe('disk full!');
    expect(thrown.error).not.toContain('\0');

    const returned = await reg.execute('return-ctrl', {});
    expect(returned.success).toBe(false);
    expect(returned.error).toBe('baderr line');
    expect(returned.error).not.toContain('\0');

    // Control-only failure error → generic fallback
    reg.register(
      makeTool('return-empty-err', async () => ({
        success: false,
        output: null,
        error: `\0\n`,
      })),
    );
    const emptyFail = await reg.execute('return-empty-err', {});
    expect(emptyFail.success).toBe(false);
    expect(emptyFail.error).toBe('Tool execution failed');

    // Success with empty/control-only error must not invent a failure message
    reg.register(
      makeTool('ok-empty-err', async () => ({
        success: true,
        output: { ok: 1 },
        error: `\0\n`,
      })),
    );
    const okEmpty = await reg.execute('ok-empty-err', {});
    expect(okEmpty.success).toBe(true);
    expect(okEmpty.output).toEqual({ ok: 1 });
    expect(okEmpty.error).toBeUndefined();
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
