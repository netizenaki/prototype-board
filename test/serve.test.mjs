import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, portFor } from '../skills/prototype-board/scripts/serve.mjs';
import { build } from '../skills/prototype-board/scripts/build.mjs';

const example = fileURLToPath(new URL('../example', import.meta.url));
const script = fileURLToPath(new URL('../skills/prototype-board/scripts/serve.mjs', import.meta.url));
const run = promisify(execFile);

test('serves checked-in prototypes and missing-file responses over loopback HTTP', async (context) => {
  const server = createServer(example);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const prototype = await fetch(`${origin}/welcome.html`);
  assert.equal(prototype.status, 200);
  assert.match(prototype.headers.get('content-type'), /text\/html/);
  assert.match(await prototype.text(), /Fieldnotes/);
  assert.equal((await fetch(`${origin}/missing.html`)).status, 404);
  const capture = await fetch(`${origin}/__prototype-board/thumbnail-frame?file=welcome.html`);
  assert.equal(capture.status, 200);
  assert.match(await capture.text(), /<iframe sandbox="allow-scripts" src="\/welcome\.html"/);
  assert.equal((await fetch(`${origin}/__prototype-board/thumbnail-frame?file=..%2Fwelcome.html`)).status, 400);
  assert.equal(portFor(example), portFor(example));
});

test('an existing workspace server can be reused when reopening the panel', async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'prototype-board-reopen-'));
  const workspace = path.join(parent, '.prototype-board');
  const server = createServer(workspace);
  const port = portFor(workspace);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { stdout } = await run(process.execPath, [script], { cwd: parent });
  assert.equal(stdout.trim(), `http://127.0.0.1:${port}/index.html`);
  assert.equal((await fetch(stdout.trim())).headers.get('cache-control'), 'no-store');
  await assert.rejects(run(process.execPath, [script, example], { cwd: parent }), /directory arguments are not supported/);
});

test('reopening replaces an older runtime at the same URL and preserves board files', async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'prototype-board-upgrade-'));
  const workspace = path.join(parent, '.prototype-board');
  const installed = path.join(parent, 'updated-skill');
  const source = '<p id="demo">Original</p>';
  const saved = '{"title":"Saved project","boards":{},"text":{"demo.html":{"#demo":"Edited"}}}';
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'demo.html'), source);
  await writeFile(path.join(workspace, 'prototype-board-edits.json'), saved);
  await writeFile(path.join(workspace, 'index.html'), 'Old viewer');
  await cp(path.dirname(path.dirname(script)), installed, { recursive: true });
  const bridge = path.join(installed, 'viewer', 'bridge.js');
  await writeFile(bridge, (await readFile(bridge, 'utf8')) + '\n// New runtime\n');

  const server = createServer(workspace);
  const port = portFor(workspace);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const url = `http://127.0.0.1:${port}`;
  const serverUrl = url + '/__prototype-board/server';
  const old = await (await fetch(serverUrl)).json();
  const rejected = await fetch(serverUrl, {
    method: 'POST',
    headers: { Origin: url, 'x-prototype-board-restart': old.workspace },
  });
  assert.equal(rejected.status, 403);

  const child = spawn(process.execPath, [path.join(installed, 'scripts', 'serve.mjs')], { cwd: parent });
  context.after(() => child.kill());
  const [ready] = await Promise.race([
    once(child.stdout, 'data', { signal: AbortSignal.timeout(8000) }),
    once(child, 'exit').then((code) => { throw new Error(`Upgrade server exited: ${code}`); }),
  ]);
  assert.equal(String(ready).trim(), url + '/index.html');
  assert.notEqual((await (await fetch(serverUrl)).json()).runtime, old.runtime);
  assert.match(await (await fetch(url + '/')).text(), /Prototype Board/);
  assert.match(await (await fetch(url + '/__prototype-board/bridge.js')).text(), /New runtime/);
  assert.equal(await readFile(path.join(workspace, 'demo.html'), 'utf8'), source);
  assert.equal(await readFile(path.join(workspace, 'prototype-board-edits.json'), 'utf8'), saved);
});

test('reopening does not reuse or stop an unidentified server on the board port', async (context) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'prototype-board-legacy-'));
  const server = http.createServer((_, response) => response.writeHead(404).end());
  const port = portFor(path.join(parent, '.prototype-board'));
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  await assert.rejects(run(process.execPath, [script], { cwd: parent }), /older or unrelated server/);
  assert.equal(server.listening, true);
});

test('persists edits and injects text overrides without changing source HTML', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prototype-board-edit-'));
  const source = '<!doctype html><html><body><h1 id="title">Original</h1></body></html>';
  await writeFile(path.join(directory, 'welcome.html'), source);
  const server = createServer(directory);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const edit = async (change) => {
    const response = await fetch(`${origin}/__prototype-board/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  await edit({ action: 'rename-project', title: 'Renamed project' });
  await edit({ action: 'rename-board', file: 'welcome.html', title: 'Renamed board' });
  await edit({ action: 'move', file: 'welcome.html', x: 125, y: -80 });
  await edit({ action: 'note', file: 'welcome.html', note: 'Review this flow' });
  await edit({ action: 'text', file: 'welcome.html', path: '#title', text: 'Changed' });
  const state = await edit({ action: 'delete', file: 'welcome.html', deleted: false });
  assert.equal(state.title, 'Renamed project');
  assert.deepEqual(state.boards['welcome.html'], { title: 'Renamed board', x: 125, y: -80, note: 'Review this flow', deleted: false });
  assert.equal(state.text['welcome.html']['#title'], 'Changed');
  const captureUrl = `${origin}/__prototype-board/thumbnail-frame?file=welcome.html`;
  assert.equal((await fetch(captureUrl)).status, 200);
  await edit({ action: 'delete', file: 'welcome.html' });
  assert.equal((await fetch(captureUrl)).status, 404);
  await edit({ action: 'undo' });
  assert.equal((await fetch(captureUrl)).status, 200);
  const prototype = await fetch(`${origin}/welcome.html`);
  const html = await prototype.text();
  assert.match(html, /__PROTOTYPE_BOARD_OVERRIDES__=\{"#title":"Changed"\}/);
  assert.match(html, /__prototype-board\/bridge\.js/);
  assert.equal(await readFile(path.join(directory, 'welcome.html'), 'utf8'), source);
  assert.equal((await fetch(`${origin}/__prototype-board/state`)).status, 200);
});

test('recovers the write queue after rejecting an invalid edit', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prototype-board-validation-'));
  const server = createServer(directory);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}/__prototype-board/edit`;
  const invalid = await fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unknown' }) });
  assert.equal(invalid.status, 400);
  const valid = await fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename-project', title: 'Still works' }) });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).title, 'Still works');
});

test('creates and renames pages, moves boards, and preserves them when deleting a page', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prototype-board-pages-'));
  const source = '<h1>Original</h1>';
  const canvas = JSON.stringify({
    pages: [{ id: 'main', name: 'Main' }],
    boards: { 'demo.html': { page: 'main', x: 9, y: 15, w: 300, h: 200 } },
  });
  await writeFile(path.join(directory, 'demo.html'), source);
  await writeFile(path.join(directory, 'canvas.json'), canvas);
  const server = createServer(directory);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/__prototype-board/edit`;
  const edit = async (change, status = 200) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
    });
    assert.equal(response.status, status);
    return response.json();
  };

  await edit({ action: 'delete-page', page: 'main' }, 400);
  await edit({ action: 'create-page', name: '  ' }, 400);
  const created = await edit({ action: 'create-page', name: 'Review' });
  const [{ id }] = created.pages;
  await edit({ action: 'rename-page', page: id, name: 'Design review' });
  await edit({ action: 'rename-board', file: 'demo.html', title: 'Artboard A' });
  await edit({ action: 'move-to-page', file: 'demo.html', page: 'missing' }, 400);
  await edit({ action: 'move-to-page', file: 'demo.html', page: id });
  let board = await build(directory);
  assert.deepEqual(board.pages, [{ id: 'main', name: 'Main' }, { id, name: 'Design review' }]);
  assert.deepEqual(board.boards.map(({ title, page, x }) => ({ title, page, x })), [{ title: 'Artboard A', page: id, x: 9 }]);
  await edit({ action: 'delete-page', page: id, destination: 'main' });
  board = await build(directory);
  assert.deepEqual(board.pages, [{ id: 'main', name: 'Main' }]);
  assert.equal(board.boards[0].page, 'main');
  assert.equal(board.boards[0].title, 'Artboard A');
  const restored = await edit({ action: 'undo' });
  assert.equal(restored.boards['demo.html'].page, id);
  assert.equal(restored.pages[0].name, 'Design review');
  assert.equal(restored.pages[0].deleted, undefined);
  const redone = await edit({ action: 'redo' });
  assert.equal(redone.boards['demo.html'].page, 'main');
  assert.equal(redone.pages[0].deleted, true);
  await edit({ action: 'undo' });
  await edit({ action: 'delete', file: 'demo.html' });
  assert.equal((await edit({ action: 'undo' })).boards['demo.html'].deleted, undefined);
  assert.equal((await edit({ action: 'redo' })).boards['demo.html'].deleted, true);
  await edit({ action: 'undo' });
  await edit({ action: 'rename-board', file: 'demo.html', title: 'New name' });
  assert.equal((await edit({ action: 'redo' })).boards['demo.html'].title, 'New name');
  const state = await fetch(url.replace('/edit', '/state'));
  assert.equal(state.headers.get('X-Prototype-Board-Undo'), 'true');
  assert.equal(state.headers.get('X-Prototype-Board-Redo'), 'false');
  await build(directory);
  const generated = await readFile(path.join(directory, 'prototype-board-data.js'), 'utf8');
  const data = JSON.parse(generated.replace(/^window.PROTOTYPE_BOARD_DATA = |;\s*$/g, ''));
  assert.equal(data.boards[0].title, 'demo');
  assert.equal(data.boards[0].page, 'main');
  assert.equal(data.edits.boards['demo.html'].title, 'New name');
  assert.equal(await readFile(path.join(directory, 'demo.html'), 'utf8'), source);
  assert.equal(await readFile(path.join(directory, 'canvas.json'), 'utf8'), canvas);
});
