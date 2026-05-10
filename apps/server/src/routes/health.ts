import { Hono } from 'hono';

import type { HealthResponse } from '@neos-work/shared';

const startTime = Date.now();

const health = new Hono();

health.get('/', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    version: '0.2.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
  return c.json(response);
});

export { health };
