import { describe, expect, it } from 'vitest';
import {
  MCP_PRESETS,
  buildPresetStdioArgs,
  getMcpPreset,
  listMcpPresets,
  sanitizeMcpInstallPath,
} from './presets.js';

describe('MCP presets', () => {
  it('includes tradingview finance preset with tool hints', () => {
    expect(MCP_PRESETS.some((p) => p.id === 'tradingview')).toBe(true);
    const tv = getMcpPreset('tradingview');
    expect(tv?.domain).toBe('finance');
    expect(tv?.transport).toBe('stdio');
    expect(tv?.command).toBe('node');
    expect(tv?.toolHints).toEqual(expect.arrayContaining(['tv_health_check', 'quote_get']));
    expect(tv?.entryRelativePath).toBe('src/server.js');
  });

  it('listMcpPresets returns copies', () => {
    const a = listMcpPresets();
    const b = listMcpPresets();
    expect(a).toHaveLength(b.length);
    a[0]!.toolHints.push('mutated');
    expect(b[0]!.toolHints).not.toContain('mutated');
  });

  it('getMcpPreset rejects control-char / empty ids', () => {
    expect(getMcpPreset('')).toBeUndefined();
    expect(getMcpPreset('\ntradingview')).toBeUndefined();
    expect(getMcpPreset('TradingView')).toBeDefined(); // case-insensitive
  });

  it('sanitizeMcpInstallPath rejects unsafe paths', () => {
    expect(sanitizeMcpInstallPath('')).toBeNull();
    expect(sanitizeMcpInstallPath('  ')).toBeNull();
    expect(sanitizeMcpInstallPath('/ok/path')).toBe('/ok/path');
    expect(sanitizeMcpInstallPath('/ok/../escape')).toBeNull();
    expect(sanitizeMcpInstallPath('C:\\Users\\me\\tv')).toBe('C:\\Users\\me\\tv');
    expect(sanitizeMcpInstallPath(`bad\npath`)).toBeNull();
    expect(sanitizeMcpInstallPath('x'.repeat(2_000))).toBeNull();
  });

  it('buildPresetStdioArgs expands installPath', () => {
    const tv = getMcpPreset('tradingview')!;
    const built = buildPresetStdioArgs(tv, '/Users/me/tradingview-mcp');
    expect(built).toEqual({
      command: 'node',
      args: ['/Users/me/tradingview-mcp/src/server.js'],
    });
    expect(buildPresetStdioArgs(tv, '/path/with/../dotdot')).toBeNull();
  });
});
