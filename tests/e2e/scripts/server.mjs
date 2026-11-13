import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const port = Number(process.argv[2]);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('The E2E runner must supply its owned port.');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  absWorkingDir: packageRoot,
  entryPoints: ['harness.tsx'],
  outfile: 'harness.js',
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  nodePaths: [appRoot + 'node_modules'], alias: { '@': appRoot },
  // Next replaces these compile-time flags in the real app; fixture bundles have no secrets or runtime process.
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
});
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>InView editor fixture</title><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>';
const server = http.createServer((request, response) => {
  if (request.url === '/harness.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).contents);
  } else if (request.url === '/harness.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.css'))?.contents ?? '');
  } else if (['/', '/calendar', '/write', '/settings/providers'].includes(new URL(request.url, 'http://localhost').pathname)) {
    response.setHeader('Content-Type', 'text/html'); response.end(html);
  } else { response.writeHead(404); response.end('No fixture endpoint. Browser tests must intercept API calls.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Owned editor fixture ready on 127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
