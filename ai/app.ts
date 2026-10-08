import { Hono } from 'hono';

export const app = new Hono();

// Kill switch (spec §9): anything but an unset or `true` value turns Jev off.
app.get('/api/ai/status', (c) =>
  c.json({ jevEnabled: (process.env.JEV_ENABLED ?? 'true') === 'true' }),
);
