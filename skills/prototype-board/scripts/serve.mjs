import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build, readExport, safeHtmlPath } from './build.mjs';
import { EDITS_FILE, readEdits } from './edits.mjs';
import { createThumbnailRenderer } from './thumbnail.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeHash = createHash('sha256');
for (const file of ['serve.mjs', 'build.mjs', 'edits.mjs', 'thumbnail.mjs', '../viewer/bridge.js']) {
  runtimeHash.update(await readFile(path.join(here, file)));
}
const runtime = runtimeHash.digest('hex');
const workspaceId = (root) => createHash('sha256').update(root).digest('hex');
const serverPath = '/__prototype-board/server';
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

async function update(edits, change, root) {
  if (['create-page', 'rename-page', 'delete-page', 'move-to-page'].includes(change.action)) {
    const { pages, boards } = await readExport(root);
    const page = pages.find(({ id }) => id === change.page);
    if (change.action !== 'create-page' && !page) throw new Error('Page does not exist.');
    if (change.action === 'move-to-page') {
      const file = safeHtmlPath(change.file);
      if (!boards.some((board) => board.file === file && !board.deleted)) throw new Error('Board does not exist.');
      edits.boards[file] = { ...edits.boards[file], page: page.id };
      return edits;
    }
    const pageEdits = new Map((edits.pages ?? []).map((item) => [item.id, item]));
    if (change.action === 'create-page') {
      const id = randomUUID();
      pageEdits.set(id, { id, name: text(change.name, 'page name', 200).trim() });
    } else if (change.action === 'rename-page') {
      pageEdits.set(page.id, { id: page.id, name: text(change.name, 'page name', 200).trim() });
    } else {
      const destination = pages.find(({ id }) => id === change.destination && id !== page.id);
      if (!destination) throw new Error('Choose another page before deleting this page.');
      pageEdits.set(page.id, { ...page, deleted: true });
      for (const board of boards) {
        if (board.page === page.id) edits.boards[board.file] = { ...edits.boards[board.file], page: destination.id };
      }
    }
    edits.pages = [...pageEdits.values()];
    return edits;
  }
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
  const thumbnails = createThumbnailRenderer(root, runtime);
  let queue = Promise.resolve();
  let restarting = false;
  const undo = [];
  const redo = [];
  let lastSaved;
  let thumbnailIndex;

  async function thumbnailLayout() {
    const stamps = await Promise.all(['.', 'canvas.json', EDITS_FILE].map(async (file) => {
      const metadata = await stat(path.join(root, file)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return metadata && [metadata.mtimeMs, metadata.size];
    }));
    const key = JSON.stringify(stamps);
    if (thumbnailIndex?.key !== key) {
      const index = readExport(root).then(({ boards, edits }) => ({
        byFile: new Map(boards.map((board) => [board.file, board])),
        files: new Set(boards.map((board) => board.file)),
        text: edits.text,
      }));
      thumbnailIndex = { key, index };
      index.catch(() => {
        if (thumbnailIndex?.index === index) thumbnailIndex = null;
      });
    }
    return thumbnailIndex.index;
  }

  function state(response, edits) {
    response.setHeader('X-Prototype-Board-Undo', String(undo.length > 0));
    response.setHeader('X-Prototype-Board-Redo', String(redo.length > 0));
    response.setHeader('Cache-Control', 'no-store');
    json(response, 200, edits);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (request.method === 'GET' && ['/__prototype-board/thumbnail', '/__prototype-board/thumbnail-frame'].includes(pathname)) {
        const file = safeHtmlPath(url.searchParams.get('file'));
        const { byFile, files, text } = await thumbnailLayout();
        const board = byFile.get(file);
        if (!board || board.deleted) { response.writeHead(404).end(); return; }
        if (pathname.endsWith('-frame')) {
          const src = file.split('/').map(encodeURIComponent).join('/');
          response.writeHead(200, { 'Content-Type': types['.html'] }).end(
            `<!doctype html><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block;overflow:hidden}</style><iframe sandbox="allow-scripts" src="/${src}"></iframe>`,
          );
          return;
        }
        const fileStat = await stat(path.join(root, file));
        const width = Math.max(1, Math.min(8192, Math.round(board.w)));
        const height = Math.max(1, Math.min(8192, Math.round(board.h)));
        const requestedSize = Number(url.searchParams.get('size'));
        const maxSize = url.searchParams.has('full') ? 4096
          : [640, 1280, 2560, 4096].includes(requestedSize) ? requestedSize : 640;
        const key = JSON.stringify([file, fileStat.mtimeMs, width, height, maxSize, text[file]]);
        const captureUrl = `http://127.0.0.1:${server.address().port}/__prototype-board/thumbnail-frame?file=${encodeURIComponent(file)}`;
        if (response.destroyed) return;
        const client = new AbortController();
        response.once('close', () => client.abort());
        const image = await thumbnails.render(
          key, captureUrl, width, height, maxSize, files,
          client.signal, url.searchParams.has('priority'),
        );
        if (client.signal.aborted) return;
        if (!image) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(image);
        return;
      }
      if (pathname === serverPath && request.method === 'GET') {
        response.setHeader('Cache-Control', 'no-store');
        json(response, 200, { workspace: workspaceId(root), runtime });
        return;
      }
      if (pathname === serverPath && request.method === 'POST') {
        // Browser pages cannot request a restart. The launcher runs locally in Node.
        if (request.headers.origin || request.headers['sec-fetch-site'] ||
            request.headers.host !== `127.0.0.1:${server.address()?.port}` ||
            request.headers['x-prototype-board-restart'] !== workspaceId(root)) {
          response.writeHead(403).end();
          return;
        }
        restarting = true;
        await queue.catch(() => {});
        server.close();
        response.writeHead(204, { Connection: 'close' }).end();
        return;
      }
      if (pathname === '/__prototype-board/state' && request.method === 'GET') {
        state(response, await readEdits(root));
        return;
      }
      if (pathname === '/__prototype-board/edit' && request.method === 'POST') {
        const change = await body(request);
        if (restarting) {
          json(response, 503, { error: 'Prototype Board is restarting. Try the edit again.' });
          return;
        }
        const operation = queue.catch(() => {}).then(async () => {
          const before = await readEdits(root);
          if (lastSaved && !isDeepStrictEqual(lastSaved, before)) {
            undo.length = 0;
            redo.length = 0;
            lastSaved = undefined;
          }
          const history = change.action === 'undo' ? undo : change.action === 'redo' ? redo : null;
          if (history && !history.length) return before;
          const edits = history ? history.at(-1) : await update(structuredClone(before), change, root);
          if (isDeepStrictEqual(edits, before)) return before;
          const destination = path.join(root, EDITS_FILE);
          await writeFile(`${destination}.tmp`, `${JSON.stringify(edits, null, 2)}\n`);
          await rename(`${destination}.tmp`, destination);
          thumbnailIndex = null;
          if (history) {
            history.pop();
            (history === undo ? redo : undo).push(before);
          } else {
            undo.push(before);
            if (undo.length > 50) undo.shift();
            redo.length = 0;
          }
          lastSaved = edits;
          return edits;
        });
        queue = operation;
        state(response, await operation);
        return;
      }
      if (pathname === '/__prototype-board/bridge.js') {
        const content = await readFile(path.join(here, '..', 'viewer', 'bridge.js'));
        response.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' }).end(content);
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
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    } catch (error) {
      if (request.method === 'POST') json(response, 400, { error: error.message });
      else response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Not found');
    }
  });
  server.once('close', () => { void thumbnails.close(); });
  return server;
}

export function portFor(directory) {
  const value = path.resolve(directory);
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return 42000 + hash % 10000;
}

async function openServer(directory) {
  await build(directory);
  const port = portFor(directory);
  const origin = `http://127.0.0.1:${port}`;
  const serverUrl = origin + serverPath;
  const workspace = workspaceId(directory);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const server = createServer(directory);
    try {
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      return `${origin}/index.html`;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }

    let status;
    try {
      const response = await fetch(serverUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) status = await response.json().catch(() => null);
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNRESET') {
        await delay(50);
        continue;
      }
      throw error;
    }
    if (status?.workspace !== workspace || typeof status.runtime !== 'string') {
      throw new Error(`Port ${port} is occupied by an older or unrelated server. Stop the previous Prototype Board task if it owns that port, then reopen the board.`);
    }
    if (status.runtime === runtime) return `${origin}/index.html`;

    const restarted = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'x-prototype-board-restart': workspace },
      signal: AbortSignal.timeout(1000),
    }).catch((error) => {
      if (error.cause?.code !== 'ECONNREFUSED' && error.cause?.code !== 'ECONNRESET') throw error;
    });
    if (restarted && !restarted.ok) throw new Error(`The server on port ${port} could not be restarted.`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for the server on port ${port} to restart.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Prototype Board always uses .prototype-board in the current project; directory arguments are not supported.');
    process.exitCode = 1;
  } else {
    try {
      console.log(await openServer(path.resolve('.prototype-board')));
    } catch (error) {
      console.error(`Prototype Board: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
