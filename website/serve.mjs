import { resolve, sep } from 'node:path';

const root = resolve('public');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4178,
  async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
  },
});
console.log(`Local: ${server.url}`);
