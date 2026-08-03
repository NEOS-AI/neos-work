import { Hono } from 'hono';

import { NEOS_VERSION, type HealthResponse } from '@neos-work/shared';

const startTime = Date.now();

const health = new Hono();

health.get('/', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    version: NEOS_VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
  return c.json(response);
});

export { health };
