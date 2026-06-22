try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const SSR_PORT = parseInt(process.env.SSR_PORT || '3002', 10);
const CLIENT_DIR = path.join(__dirname, '..', 'dist', 'client');

const MIME = {
  '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json',
};

async function start() {
  const { default: handler } = await import('../dist/server/server.js');

  const server = http.createServer(async (req, res) => {
    // 1. Serve static files from dist/client
    if (!req.url.startsWith('/api/')) {
      const filePath = path.join(CLIENT_DIR, req.url.split('?')[0]);
      if (filePath.startsWith(CLIENT_DIR)) {
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        } catch { /* not a static file, continue to SSR */ }
      }
    }

    // 2. SSR handler for dynamic pages
    try {
      const url = new URL(req.url, 'http://localhost:' + SSR_PORT);
      const headers = { ...req.headers };
      const body = req.method === 'GET' || req.method === 'HEAD' ? null : await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });
      const request = new Request(url, { method: req.method, headers, body });
      const response = await handler.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      const text = await response.text();
      res.end(text);
    } catch (err) {
      console.error('[SSR] Error:', err.message);
      res.writeHead(502);
      res.end('SSR Error: ' + err.message);
    }
  });

  server.listen(SSR_PORT, () => {
    console.log('[SSR Frontend] Running on http://localhost:' + SSR_PORT);
  });
}

start().catch(console.error);
