import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PREFIX = '/.netlify/functions/';

/**
 * `npm run dev` is plain Vite, which serves nothing under `/.netlify/functions/`,
 * so the editor's login answered 404 locally. Run the very same handlers Netlify
 * runs in production, with their secrets read from `.env`.
 */
function netlifyFunctions(): Plugin {
  return {
    name: 'netlify-functions-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? '';

        if (!url.startsWith(PREFIX)) {
          return next();
        }

        const name = url.slice(PREFIX.length).split('?')[0];

        // `_session.mjs` is shared code, not an endpoint, and the pattern also
        // keeps a crafted path from reaching outside the functions directory.
        if (!/^[a-z0-9-]+$/u.test(name)) {
          return next();
        }

        const chunks: Buffer[] = [];

        for await (const chunk of request) {
          chunks.push(chunk as Buffer);
        }

        const event = {
          httpMethod: request.method ?? 'GET',
          headers: request.headers,
          body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
          queryStringParameters: Object.fromEntries(
            new URL(url, 'http://localhost').searchParams,
          ),
        };

        try {
          const module = await server.ssrLoadModule(`/netlify/functions/${name}.mjs`);
          const result = await module.handler(event);

          response.statusCode = result.statusCode ?? 200;

          for (const [header, value] of Object.entries(result.headers ?? {})) {
            response.setHeader(header, value as string);
          }

          response.end(result.body ?? '');
        } catch (error) {
          server.config.logger.error(`[netlify-functions] ${name}: ${String(error)}`);
          response.statusCode = 500;
          response.setHeader('content-type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: `Funcția ${name} a eșuat local. Vezi terminalul.` }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The functions read their secrets off `process.env`, exactly as on Netlify.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return { plugins: [react(), netlifyFunctions()] };
});
