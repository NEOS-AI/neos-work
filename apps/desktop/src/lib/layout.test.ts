import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { autoLayout } from './layout.js';

function n(id: string, x = 0, y = 0): Node {
  return { id, position: { x, y }, data: {}, type: 'default' };
}

describe('autoLayout', () => {
  it('assigns positions to a linear chain (TB)', () => {
    const nodes = [n('a'), n('b'), n('c')];
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const laid = autoLayout(nodes, edges, 'TB');
    expect(laid).toHaveLength(3);
    const byId = Object.fromEntries(laid.map((node) => [node.id, node]));
    // Top-to-bottom: y should increase along the chain
    expect(byId.a!.position.y).toBeLessThan(byId.b!.position.y);
    expect(byId.b!.position.y).toBeLessThan(byId.c!.position.y);
  });

  it('assigns left-to-right positions (LR)', () => {
    const nodes = [n('a'), n('b')];
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const laid = autoLayout(nodes, edges, 'LR');
    const byId = Object.fromEntries(laid.map((node) => [node.id, node]));
    expect(byId.a!.position.x).toBeLessThan(byId.b!.position.x);
  });

  it('preserves node ids and data', () => {
    const nodes: Node[] = [
      { id: 'n1', position: { x: 10, y: 20 }, data: { label: 'Hello' }, type: 'default' },
    ];
    const laid = autoLayout(nodes, []);
    expect(laid[0]!.id).toBe('n1');
    expect(laid[0]!.data).toEqual({ label: 'Hello' });
    expect(typeof laid[0]!.position.x).toBe('number');
    expect(typeof laid[0]!.position.y).toBe('number');
  });

  it('handles empty input', () => {
    expect(autoLayout([], [])).toEqual([]);
  });
});

describe('autoLayout fan-out', () => {
  it('places parallel branches with different y for TB', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
      { id: 'b', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
      { id: 'c', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
      { id: 'd', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'd' },
      { id: 'e4', source: 'c', target: 'd' },
    ];
    const laid = autoLayout(nodes, edges, 'TB');
    const byId = Object.fromEntries(laid.map((n) => [n.id, n]));
    expect(byId.a!.position.y).toBeLessThan(byId.b!.position.y);
    expect(byId.a!.position.y).toBeLessThan(byId.c!.position.y);
    // branches should not share exact same coordinates
    expect(byId.b!.position.x !== byId.c!.position.x || byId.b!.position.y !== byId.c!.position.y).toBe(true);
  });
});

describe('autoLayout LR', () => {
  it('places chain left-to-right for LR direction', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
      { id: 'b', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
      { id: 'c', position: { x: 0, y: 0 }, data: {}, type: 'default' as const },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const laid = autoLayout(nodes, edges, 'LR');
    const byId = Object.fromEntries(laid.map((n) => [n.id, n]));
    expect(byId.a!.position.x).toBeLessThan(byId.b!.position.x);
    expect(byId.b!.position.x).toBeLessThan(byId.c!.position.x);
  });
});
