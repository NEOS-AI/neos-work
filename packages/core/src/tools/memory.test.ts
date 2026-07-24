import { describe, expect, it, vi } from 'vitest';
import {
  createForgetTool,
  createMemoryTools,
  createRecallTool,
  createRememberTool,
  type MemoryCallbacks,
} from './memory.js';

function mockCallbacks(overrides: Partial<MemoryCallbacks> = {}): MemoryCallbacks {
  return {
    save: vi.fn(async () => undefined),
    search: vi.fn(async () => [{ key: 'k', content: 'c' }]),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('memory tools', () => {
  it('createMemoryTools returns remember, recall, forget', () => {
    const tools = createMemoryTools(mockCallbacks());
    expect(tools.map((t) => t.name)).toEqual(['remember', 'recall', 'forget']);
  });

  it('remember validates key and content length', async () => {
    const cb = mockCallbacks();
    const tool = createRememberTool(cb);
    const emptyKey = await tool.execute({ key: '', content: 'x' });
    expect(emptyKey.success).toBe(false);
    expect(emptyKey.error).toMatch(/Key must be between 1 and 200/i);

    const longKey = await tool.execute({ key: 'a'.repeat(201), content: 'x' });
    expect(longKey.success).toBe(false);
    expect(longKey.error).toMatch(/Key must be between 1 and 200/i);

    const emptyContent = await tool.execute({ key: 'k', content: '' });
    expect(emptyContent.success).toBe(false);
    expect(emptyContent.error).toMatch(/Content must be between 1 and 10,000/i);

    const longContent = await tool.execute({ key: 'k', content: 'c'.repeat(10_001) });
    expect(longContent.success).toBe(false);
    expect(longContent.error).toMatch(/Content must be between 1 and 10,000/i);

    expect(cb.save).not.toHaveBeenCalled();
  });

  it('remember saves and returns key', async () => {
    const cb = mockCallbacks();
    const tool = createRememberTool(cb);
    const result = await tool.execute({ key: 'pref', content: 'dark', tags: ['ui'] });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ saved: 'pref' });
    expect(cb.save).toHaveBeenCalledWith('pref', 'dark', ['ui']);

    const padded = await tool.execute({
      key: '  pref2  ',
      content: '  value  ',
      tags: ['  a  ', '  ', 'b'],
    });
    expect(padded.success).toBe(true);
    expect(cb.save).toHaveBeenCalledWith('pref2', 'value', ['a', 'b']);
  });

  it('remember maps callback errors', async () => {
    const tool = createRememberTool(
      mockCallbacks({ save: async () => { throw new Error('db down'); } }),
    );
    const result = await tool.execute({ key: 'k', content: 'v' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('db down');
  });

  it('recall searches with default limit', async () => {
    const cb = mockCallbacks();
    const tool = createRecallTool(cb);
    const result = await tool.execute({ query: 'theme' });
    expect(result.success).toBe(true);
    expect(cb.search).toHaveBeenCalledWith('theme', undefined, 5);
    expect(result.output).toEqual({ memories: [{ key: 'k', content: 'c' }] });
  });

  it('recall forwards tags and custom limit', async () => {
    const cb = mockCallbacks();
    const tool = createRecallTool(cb);
    const result = await tool.execute({ query: 'q', tags: ['a', 'b'], limit: 12 });
    expect(result.success).toBe(true);
    expect(cb.search).toHaveBeenCalledWith('q', ['a', 'b'], 12);

    const blank = await tool.execute({ query: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/query is required/i);

    await tool.execute({ query: '  q  ', tags: ['  t  ', ''], limit: 999 });
    expect(cb.search).toHaveBeenCalledWith('q', ['t'], 100);
  });

  it('recall maps callback errors', async () => {
    const tool = createRecallTool(
      mockCallbacks({ search: async () => { throw new Error('search fail'); } }),
    );
    const result = await tool.execute({ query: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('search fail');
  });

  it('forget removes by key', async () => {
    const cb = mockCallbacks();
    const tool = createForgetTool(cb);
    const result = await tool.execute({ key: 'old' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ removed: 'old' });
    expect(cb.remove).toHaveBeenCalledWith('old');

    const blank = await tool.execute({ key: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/key is required/i);
    expect(cb.remove).toHaveBeenCalledTimes(1);

    await tool.execute({ key: '  padded  ' });
    expect(cb.remove).toHaveBeenCalledWith('padded');
  });

  it('forget maps callback errors', async () => {
    const tool = createForgetTool(
      mockCallbacks({ remove: async () => { throw new Error('remove fail'); } }),
    );
    const result = await tool.execute({ key: 'old' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('remove fail');
  });

  it('coerces non-string key/content and clamps string/NaN recall limits', async () => {
    const cb = mockCallbacks();
    const remember = createRememberTool(cb);
    const saved = await remember.execute({
      key: 42 as unknown as string,
      content: true as unknown as string,
      tags: 'not-an-array' as unknown as string[],
    });
    expect(saved.success).toBe(true);
    expect(cb.save).toHaveBeenCalledWith('42', 'true', undefined);

    const recall = createRecallTool(cb);
    await recall.execute({ query: 'q', limit: '3' as unknown as number });
    expect(cb.search).toHaveBeenCalledWith('q', undefined, 3);

    await recall.execute({ query: 'q', limit: Number.NaN });
    expect(cb.search).toHaveBeenCalledWith('q', undefined, 5);

    await recall.execute({ query: 'q', limit: 0 });
    expect(cb.search).toHaveBeenCalledWith('q', undefined, 1);
  });
});
