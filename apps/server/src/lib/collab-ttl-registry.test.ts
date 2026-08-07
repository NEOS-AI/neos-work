import { describe, expect, it } from 'vitest';
import { createTtlJsonRegistry, resolveRegistryMode } from './collab-ttl-registry.js';

describe('collab-ttl-registry', () => {
  it('resolveRegistryMode parses env', () => {
    expect(resolveRegistryMode({}, 'NEOS_X')).toBe('auto');
    expect(resolveRegistryMode({ NEOS_X: 'off' }, 'NEOS_X')).toBe('off');
    expect(resolveRegistryMode({ NEOS_X: 'memory' }, 'NEOS_X')).toBe('memory');
    expect(resolveRegistryMode({ NEOS_X: 'redis' }, 'NEOS_X')).toBe('redis');
  });

  it('auto without bus redis is memory', () => {
    const r = createTtlJsonRegistry(
      {
        label: 'test',
        modeEnvKey: 'NEOS_TEST_REG',
        ttlSec: 60,
        itemKey: (a, b) => `${a}:${b}`,
        setKey: (a) => a,
        memberId: (x: { id: string }) => x.id,
        serialize: (x) => JSON.stringify(x),
        parse: (raw) => JSON.parse(raw) as { id: string },
        memoryDetail: 'mem',
      },
      { NEOS_COLLAB_BUS: 'memory' },
    );
    expect(r.kind).toBe('memory');
    expect(r.status().ready).toBe(true);
  });
});
