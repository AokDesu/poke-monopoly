import { Hono } from 'hono';

export const app = new Hono();

app.get('/api/ai/status', (c) => c.json({ jevEnabled: true }));
