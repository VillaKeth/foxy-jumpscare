import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = join(dirname(fileURLToPath(import.meta.url)), 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8' };

createServer(async (req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'plain.html';
  try {
    const body = await readFile(join(PAGES, name));
    const headers = { 'content-type': TYPES[extname(name)] ?? 'text/plain' };
    // The whole point of this page is that its CSP is hostile to injection:
    // a raw injected <video> is blocked outright, an extension-origin iframe
    // is not.
    if (name === 'strict-csp.html') {
      headers['content-security-policy'] =
        "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'";
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8392);
