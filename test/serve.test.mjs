import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, portFor } from '../scripts/serve.mjs';

const example = fileURLToPath(new URL('../example', import.meta.url));
const script = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));
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
  await assert.rejects(run(process.execPath, [script, example], { cwd: parent }), /directory arguments are not supported/);
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
