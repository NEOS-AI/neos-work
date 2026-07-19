import { describe, expect, it } from 'vitest';
import {
  pickRecentByDate,
  pickRecentDeployments,
  pickRecentRoutines,
  pickRecentWorkflows,
} from './recent-workflows.js';

describe('pickRecentWorkflows', () => {
  const items = [
    { id: '1', name: 'Old', domain: 'general', updatedAt: '2020-01-01T00:00:00.000Z' },
    { id: '2', name: 'New', domain: 'coding', updatedAt: '2024-06-01T00:00:00.000Z' },
    { id: '3', name: 'Mid', domain: 'finance', updatedAt: '2022-01-01T00:00:00.000Z' },
  ];

  it('returns newest first up to limit', () => {
    expect(pickRecentWorkflows(items, 2).map((w) => w.id)).toEqual(['2', '3']);
  });

  it('returns empty for zero limit or empty list', () => {
    expect(pickRecentWorkflows(items, 0)).toEqual([]);
    expect(pickRecentWorkflows([], 5)).toEqual([]);
  });

  it('floors fractional limits and clamps negatives to empty', () => {
    expect(pickRecentWorkflows(items, 2.9).map((w) => w.id)).toEqual(['2', '3']);
    expect(pickRecentWorkflows(items, -3)).toEqual([]);
  });

  it('defaults limit to 5 when omitted', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      name: `W${i}`,
      domain: 'general',
      updatedAt: `202${i}-01-01T00:00:00.000Z`,
    }));
    expect(pickRecentWorkflows(many)).toHaveLength(5);
  });
});

describe('pickRecentByDate / pickRecentRoutines', () => {
  const routines = [
    { id: 'r1', name: 'A', enabled: true, updatedAt: '2021-01-01T00:00:00.000Z' },
    { id: 'r2', name: 'B', enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' },
    { id: 'r3', name: 'C', enabled: true, updatedAt: '2023-01-01T00:00:00.000Z' },
  ];

  it('orders by updatedAt desc', () => {
    expect(pickRecentByDate(routines, 2).map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(pickRecentRoutines(routines, 1).map((r) => r.id)).toEqual(['r2']);
  });
});

describe('pickRecentDeployments', () => {
  const deployments = [
    {
      id: 'd1',
      createdAt: '2021-01-01T00:00:00.000Z',
      status: 'success',
      provider: 'vercel',
      projectName: 'old',
    },
    {
      id: 'd2',
      createdAt: '2025-06-01T00:00:00.000Z',
      status: 'failed',
      provider: 'cloudflare',
      projectName: 'new',
    },
    {
      id: 'd3',
      createdAt: '2024-01-01T00:00:00.000Z',
      status: 'deploying',
      provider: 'vercel',
    },
  ];

  it('orders by createdAt desc up to limit', () => {
    expect(pickRecentDeployments(deployments, 2).map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('returns empty for zero limit or empty list', () => {
    expect(pickRecentDeployments(deployments, 0)).toEqual([]);
    expect(pickRecentDeployments([], 5)).toEqual([]);
  });

  it('sorts invalid createdAt after valid ones', () => {
    const mixed = [
      { id: 'bad', createdAt: 'x', status: 'pending', provider: 'vercel' },
      ...deployments,
    ];
    expect(pickRecentDeployments(mixed, 3).map((d) => d.id)).toEqual(['d2', 'd3', 'd1']);
  });
});
