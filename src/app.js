import http from 'node:http';
import { createEmailService } from './service.js';
import { listTemplates } from './templates.js';

const MAX_BODY_BYTES = 32 * 1024;

function send(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(Object.assign(new Error('Body must be a JSON object'), { status: 400 }));
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function createHandler(service = createEmailService()) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      const method = req.method ?? 'GET';

      if (pathname === '/health' && method === 'GET') {
        return send(res, 200, { status: 'ok', transport: service.transportName, ...service.stats() });
      }

      if (pathname === '/api/templates' && method === 'GET') {
        return send(res, 200, { templates: listTemplates() });
      }

      if (pathname === '/api/emails') {
        if (method === 'GET') {
          return send(res, 200, {
            emails: service.list({
              status: url.searchParams.get('status') ?? undefined,
              q: url.searchParams.get('q') ?? undefined,
            }),
          });
        }
        if (method === 'POST') {
          const message = await service.send(await readJson(req));
          return send(res, 201, { email: message });
        }
        return send(res, 405, { error: 'Method not allowed' });
      }

      const match = pathname.match(/^\/api\/emails\/([^/]+)(\/retry)?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const isRetry = Boolean(match[2]);

        if (isRetry) {
          if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
          try {
            const message = await service.retry(id);
            return send(res, 200, { email: message });
          } catch (error) {
            if (error.status === 404) return send(res, 404, { error: error.message });
            if (error.status === 409) return send(res, 409, { error: error.message });
            throw error;
          }
        }

        if (method === 'GET') {
          const message = service.get(id);
          if (!message) return send(res, 404, { error: 'Message not found' });
          return send(res, 200, { email: message });
        }
        if (method === 'DELETE') {
          if (!service.remove(id)) return send(res, 404, { error: 'Message not found' });
          return send(res, 204, undefined);
        }
        return send(res, 405, { error: 'Method not allowed' });
      }

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, error.status ?? 500, { error: error.message ?? 'Internal server error' });
    }
  };
}

export function createServer(service) {
  return http.createServer(createHandler(service));
}
