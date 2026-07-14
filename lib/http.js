const MAX_BODY_BYTES = 64 * 1024;

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new HttpError(413, 'Payload too large.'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new HttpError(400, 'Request body must be a JSON object.'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Failed to read request body.')));
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export function notFound(res) {
  sendError(res, 404, 'Not found.');
}

export function methodNotAllowed(res) {
  sendError(res, 405, 'Method not allowed.');
}

export function extractAuthToken(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return null;
}

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  // Strip control characters, collapse runs of whitespace, and clamp length.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
}
