import http from 'node:http';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeHtmlPath } from './build.mjs';
import { EDITS_FILE, emptyEdits, readEdits } from './edits.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const types = {
  '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Expected JSON.');
  let value = '';
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 256000) throw new Error('Request is too large.');
  }
  return JSON.parse(value);
}

function text(value, name, maximum = 100000, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) throw new Error(`Invalid ${name}.`);
  return value;
}

function update(edits, change) {
  if (change.action === 'rename-project') edits.title = text(change.title, 'title', 200);
  else {
    const file = safeHtmlPath(change.file);
    if (change.action === 'move') {
      if (!Number.isFinite(change.x) || !Number.isFinite(change.y)) throw new Error('Invalid position.');
      edits.boards[file] = { ...edits.boards[file], x: change.x, y: change.y };
    } else if (change.action === 'rename-board') edits.boards[file] = { ...edits.boards[file], title: text(change.title, 'title', 200) };
    else if (change.action === 'note') edits.boards[file] = { ...edits.boards[file], note: text(change.note, 'note', 20000, true) };
    else if (change.action === 'delete') edits.boards[file] = { ...edits.boards[file], deleted: change.deleted !== false };
    else if (change.action === 'text') {
      edits.text[file] = { ...edits.text[file], [text(change.path, 'element path', 2000)]: text(change.text, 'text', 100000, true) };
    } else throw new Error('Unknown edit action.');
  }
  return edits;
}

export function createServer(directory) {
  const root = path.resolve(directory);
  let queue = Promise.resolve();
  return http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/__prototype-board/state' && request.method === 'GET') {
        json(response, 200, await readEdits(root));
        return;
      }
      if (pathname === '/__prototype-board/edit' && request.method === 'POST') {
        const change = await body(request);
        const operation = queue.catch(() => {}).then(async () => {
          const edits = update(await readEdits(root), change);
          const destination = path.join(root, EDITS_FILE);
          await writeFile(`${destination}.tmp`, `${JSON.stringify(edits, null, 2)}\n`);
          await rename(`${destination}.tmp`, destination);
          return edits;
        });
        queue = operation;
        json(response, 200, await operation);
        return;
      }
      if (pathname === '/__prototype-board/bridge.js') {
        const content = await readFile(path.join(here, '..', 'viewer', 'bridge.js'));
        response.writeHead(200, { 'Content-Type': types['.js'] }).end(content);
        return;
      }

      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      let content = await readFile(file);
      if (path.extname(file) === '.html' && file !== path.join(root, 'index.html')) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        const overrides = (await readEdits(root)).text[relative] ?? {};
        const serialized = JSON.stringify(overrides).replaceAll('<', '\\u003c');
        const bridge = `<script>window.__PROTOTYPE_BOARD_OVERRIDES__=${serialized};</script><script src="/__prototype-board/bridge.js"></script>`;
        const html = content.toString('utf8');
        content = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}</body>`) : `${html}${bridge}`;
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
      response.end(content);
    } catch (error) {
      if (request.method === 'POST') json(response, 400, { error: error.message });
      else response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Not found');
    }
  });
}

export function portFor(directory) {
  const value = path.resolve(directory);
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return 42000 + hash % 10000;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Prototype Board always uses .prototype-board in the current project; directory arguments are not supported.');
    process.exitCode = 1;
  } else {
    const directory = path.resolve('.prototype-board');
    const port = portFor(directory);
    const url = `http://127.0.0.1:${port}/index.html`;
    const server = createServer(directory);
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(url);
        return;
      }
      console.error(`Prototype Board: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(url));
  }
}
