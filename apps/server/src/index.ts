import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { health } from './routes/health.js';
import { session, workspace, models } from './routes/session.js';
import { settings } from './routes/settings.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:1420', 'http://localhost:5173', 'tauri://localhost'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-anthropic-key', 'x-google-key'],
  }),
);

// Routes
app.route('/api/health', health);
app.route('/api/workspace', workspace);
app.route('/api/models', models);
app.route('/api/session', session);
app.route('/api/settings', settings);

// Root
app.get('/', (c) => {
  return c.json({
    name: 'NEOS Work Engine',
    version: '0.1.0',
  });
});

// Start server
const port = parseInt(process.env.PORT ?? '57286', 10);

console.log(`NEOS Work Engine starting on http://127.0.0.1:${port}`);

serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port,
});

export { app };
