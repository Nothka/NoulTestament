import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { promises as fs } from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-admin-token';

function adminApiPlugin() {
  return {
    name: 'vite-admin-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url || !req.url.startsWith('/api/admin/')) {
          return next();
        }

        if (req.url === '/api/admin/login' && req.method === 'POST') {
          try {
            const body = await readRequestBody(req);
            const payload = JSON.parse(body);

            if (payload.password !== ADMIN_PASSWORD) {
              res.statusCode = 401;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Parolă invalidă.' }));
              return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ token: ADMIN_TOKEN }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Eroare la autentificare.' }));
          }

          return;
        }

        if (req.url?.startsWith('/api/admin/edited-section') && req.method === 'GET') {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const sectionId = String(url.searchParams.get('sectionId') || '').trim();

            if (!sectionId) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'sectionId lipsă.' }));
              return;
            }

            const outputPath = path.resolve(process.cwd(), 'data', 'edited-sections', `${sectionId}.html`);

            try {
              const content = await fs.readFile(outputPath, 'utf-8');
              res.setHeader('Content-Type', 'text/html');
              res.end(content);
            } catch (fileError) {
              res.statusCode = 404;
              res.end('Not found');
            }
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
          }

          return;
        }

        if (req.url === '/api/admin/save' && req.method === 'POST') {
          try {
            const authHeader = req.headers.authorization;

            if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Autentificare necesară.' }));
              return;
            }

            const body = await readRequestBody(req);
            const payload = JSON.parse(body);
            const sectionId = String(payload.sectionId || '').trim();
            const html = String(payload.html || '');

            if (!sectionId || !html) {
              throw new Error('Payload invalid.');
            }

            const outputDir = path.resolve(process.cwd(), 'data', 'edited-sections');
            await fs.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, `${sectionId}.html`);
            await fs.writeFile(outputPath, html, 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: 'Salvare reușită.' }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
          }

          return;
        }

        next();
      });
    },
  };
}

async function readRequestBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk.toString();
    });

    req.on('end', () => resolve(raw));
    req.on('error', (error) => reject(error));
  });
}

export default defineConfig({
  plugins: [react(), adminApiPlugin()],
});
