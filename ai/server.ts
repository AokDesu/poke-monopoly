import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app.ts';
import { HTTP_SERVER_OPTIONS } from './security.ts';
import { loopbackHost } from './speech/guard.ts';

// `npm start` also serves the built web app; in dev, Vite serves it and proxies /api here.
app.use('/*', loopbackHost);
app.use('/*', serveStatic({ root: './web/dist' }));

const port = 8787;
serve({ fetch: app.fetch, port, hostname: '127.0.0.1', serverOptions: HTTP_SERVER_OPTIONS }, () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});
