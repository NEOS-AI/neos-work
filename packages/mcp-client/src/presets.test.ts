import { describe, expect, it } from 'vitest';
import {
  MCP_PRESETS,
  MCP_PRESET_INSTALL_PATH_MAX,
  buildPresetStdioArgs,
  getMcpPreset,
  listMcpPresets,
  sanitizeMcpInstallPath,
  type McpPreset,
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

  it('getMcpPreset rejects control-char / empty / overlong ids', () => {
    expect(getMcpPreset('')).toBeUndefined();
    expect(getMcpPreset('\ntradingview')).toBeUndefined();
    expect(getMcpPreset('TradingView')).toBeDefined(); // case-insensitive
    expect(getMcpPreset('t'.repeat(101))).toBeUndefined();
    expect(getMcpPreset(null as unknown as string)).toBeUndefined();
  });

  it('sanitizeMcpInstallPath rejects unsafe paths', () => {
    expect(sanitizeMcpInstallPath('')).toBeNull();
    expect(sanitizeMcpInstallPath('  ')).toBeNull();
    expect(sanitizeMcpInstallPath('/ok/path')).toBe('/ok/path');
    expect(sanitizeMcpInstallPath('/ok/../escape')).toBeNull();
    expect(sanitizeMcpInstallPath('C:\\Users\\me\\tv')).toBe('C:\\Users\\me\\tv');
    expect(sanitizeMcpInstallPath(`bad\npath`)).toBeNull();
    expect(sanitizeMcpInstallPath('x'.repeat(2_000))).toBeNull();
    expect(sanitizeMcpInstallPath(123 as unknown)).toBeNull();
    expect(sanitizeMcpInstallPath('a'.repeat(MCP_PRESET_INSTALL_PATH_MAX))).toBe(
      'a'.repeat(MCP_PRESET_INSTALL_PATH_MAX),
    );
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

  it('buildPresetStdioArgs rejects non-stdio, blank command, and empty args', () => {
    const httpPreset: McpPreset = {
      id: 'http-x',
      name: 'HTTP',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'http',
      toolHints: [],
      requirements: [],
    };
    expect(buildPresetStdioArgs(httpPreset, '/ok')).toBeNull();

    const blankCmd: McpPreset = {
      id: 'blank-cmd',
      name: 'Blank',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'stdio',
      command: '   ',
      argsTemplate: ['{{installPath}}/entry.js'],
      toolHints: [],
      requirements: [],
    };
    // whitespace command → fallback "node"
    expect(buildPresetStdioArgs(blankCmd, '/install')).toEqual({
      command: 'node',
      args: ['/install/entry.js'],
    });

    const ctrlCmd: McpPreset = {
      ...blankCmd,
      id: 'ctrl-cmd',
      command: `node${'\n'}x`,
      argsTemplate: ['{{installPath}}/a.js'],
    };
    expect(buildPresetStdioArgs(ctrlCmd, '/install')?.command).toBe('node');

    const noArgs: McpPreset = {
      id: 'no-args',
      name: 'NoArgs',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'stdio',
      command: 'node',
      argsTemplate: [],
      toolHints: [],
      requirements: [],
    };
    expect(buildPresetStdioArgs(noArgs, '/install')).toBeNull();

    const ctrlArg: McpPreset = {
      ...noArgs,
      id: 'ctrl-arg',
      argsTemplate: [`bad${'\0'}arg`, '{{installPath}}/ok.js'],
    };
    expect(buildPresetStdioArgs(ctrlArg, '/install')).toEqual({
      command: 'node',
      args: ['/install/ok.js'],
    });

    // Trailing slash stripped from install path
    const tv = getMcpPreset('tradingview')!;
    expect(buildPresetStdioArgs(tv, '/Users/me/tv/')).toEqual({
      command: 'node',
      args: ['/Users/me/tv/src/server.js'],
    });

    // Overlong command rejected
    const longCmd: McpPreset = {
      id: 'long-cmd',
      name: 'Long',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'stdio',
      command: 'c'.repeat(501),
      argsTemplate: ['{{installPath}}/a.js'],
      toolHints: [],
      requirements: [],
    };
    expect(buildPresetStdioArgs(longCmd, '/install')).toBeNull();

    // Missing argsTemplate → empty → null
    const missingTpl: McpPreset = {
      id: 'no-tpl',
      name: 'NoTpl',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'stdio',
      command: 'node',
      toolHints: [],
      requirements: [],
    };
    expect(buildPresetStdioArgs(missingTpl, '/install')).toBeNull();

    // Overlong expanded arg filtered out; if nothing left → null
    const fatArg: McpPreset = {
      id: 'fat-arg',
      name: 'Fat',
      description: 'd',
      docsUrl: 'https://example.com',
      transport: 'stdio',
      command: 'node',
      argsTemplate: ['{{installPath}}/' + 'a'.repeat(500)],
      toolHints: [],
      requirements: [],
    };
    expect(buildPresetStdioArgs(fatArg, '/install')).toBeNull();
  });
});
