import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, readExport, safeHtmlPath, serializeData } from '../skills/prototype-board/scripts/build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('../skills/prototype-board/scripts/build.mjs', import.meta.url));
const run = promisify(execFile);

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'prototype-board-'));
  await writeFile(path.join(directory, 'one.dc.html'), '<h1>One</h1>');
  await writeFile(path.join(directory, 'two.dc.html'), '<h1>Two</h1>');
  await writeFile(path.join(directory, 'support.js'), 'console.log("unchanged");');
  return directory;
}

test('preserves pages, positions, dimensions, and filenames from canvas.json', async () => {
  const directory = await fixture();
  const canvas = {
    title: 'Product concepts',
    pages: [{ id: 'main', name: 'Main flow' }],
    boards: {
      'one.dc.html': { title: 'First', x: -120, y: 45, w: 390, h: 844, page: 'main' },
      'two.dc.html': { title: 'Second', x: 350, y: 45, w: 1440, h: 900, page: 'main' },
    },
  };
  await writeFile(path.join(directory, 'canvas.json'), JSON.stringify(canvas));
  const data = await readExport(directory);
  assert.equal(data.title, canvas.title);
  assert.deepEqual(data.pages, canvas.pages);
  assert.deepEqual(data.boards.map(({ x, y, w, h, page }) => ({ x, y, w, h, page })), [
    { x: -120, y: 45, w: 390, h: 844, page: 'main' },
    { x: 350, y: 45, w: 1440, h: 900, page: 'main' },
  ]);
});

test('falls back to a deterministic grid without canvas.json', async () => {
  const directory = await fixture();
  const data = await readExport(directory);
  assert.equal(data.pages.length, 1);
  assert.equal(data.boards.length, 2);
  assert.deepEqual(data.boards.map((board) => board.file), ['one.dc.html', 'two.dc.html']);
  assert.deepEqual(data.boards.map((board) => [board.x, board.y]), [[0, 0], [1248, 0]]);
});

test('creates a new empty canvas without sample artboards', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'prototype-board-empty-'));
  const directory = path.join(parent, '.prototype-board');
  const { stdout } = await run(process.execPath, [script], { cwd: parent });
  assert.match(stdout, /0 boards/);
  const data = await readExport(directory);
  assert.equal(data.boards.length, 0);
  assert.deepEqual(data.pages, [{ id: 'all', name: 'All boards' }]);
  assert.deepEqual((await readdir(directory)).sort(), ['index.html', 'prototype-board-data.js', 'prototype-board.css', 'prototype-board.js'].sort());
  await assert.rejects(run(process.execPath, [script, 'elsewhere'], { cwd: parent }), /directory arguments are not supported/);
});

test('rejects paths outside the export and invalid dimensions', async () => {
  for (const file of ['../secret.html', '/tmp/secret.html', 'C:/secret.html', 'nested\\secret.html', 'not-html.txt']) {
    assert.throws(() => safeHtmlPath(file), /Board path|Invalid board path/);
  }
  assert.equal(safeHtmlPath('./nested/screen.html'), 'nested/screen.html');
  const directory = await fixture();
  await writeFile(path.join(directory, 'canvas.json'), JSON.stringify({ boards: { 'one.dc.html': { x: 0, y: 0, w: 0, h: 10 } } }));
  await assert.rejects(readExport(directory), /invalid w/);
});

test('escapes metadata for safe embedding in a script', () => {
  const output = serializeData({ title: '</script><script>alert(1)</script>', boards: [], pages: [] });
  assert.ok(!output.includes('</script>'));
  assert.ok(output.includes('\\u003c/script>'));
});

test('build writes only four viewer files, leaves sources unchanged, and is repeatable', async () => {
  const directory = await fixture();
  const canvas = {
    title: 'Repeatable',
    pages: [{ id: 'all', name: 'All' }],
    boards: { 'one.dc.html': { title: 'One', x: 10, y: 20, w: 300, h: 400, page: 'all' } },
  };
  await writeFile(path.join(directory, 'canvas.json'), JSON.stringify(canvas));
  const before = Object.fromEntries(await Promise.all(['one.dc.html', 'two.dc.html', 'support.js', 'canvas.json'].map(async (file) => [file, await readFile(path.join(directory, file))])));
  await build(directory);
  const first = await readFile(path.join(directory, 'prototype-board-data.js'), 'utf8');
  await build(directory);
  assert.equal(await readFile(path.join(directory, 'prototype-board-data.js'), 'utf8'), first);
  assert.deepEqual((await readdir(directory)).sort(), [...Object.keys(before), 'index.html', 'prototype-board.css', 'prototype-board.js', 'prototype-board-data.js'].sort());
  for (const [file, content] of Object.entries(before)) assert.deepEqual(await readFile(path.join(directory, file)), content);
  assert.match(first, /"x": 10/);
});

test('skill, package, plugin manifest, and command are valid and complete', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'kimi.plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const skill = await readFile(path.join(root, manifest.skills, 'prototype-board', 'SKILL.md'), 'utf8');
  const command = await readFile(path.join(root, manifest.commands, 'open.md'), 'utf8');
  assert.equal(manifest.name, 'prototype-board');
  assert.equal(manifest.license, 'MIT');
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.match(skill, /^---\nname: prototype-board\ndescription: .+\n---/);
  assert.match(command, /description: .+/);
  assert.doesNotMatch(command, /\$ARGUMENTS|argument-hint/);
  assert.match(command, /Always use `\.prototype-board`/);
  assert.equal(pkg.scripts.example, undefined);
  const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  const kimiMarketplace = JSON.parse(await readFile(path.join(root, 'kimi.marketplace.json'), 'utf8'));
  const gemini = JSON.parse(await readFile(path.join(root, 'gemini-extension.json'), 'utf8'));
  const [entry] = marketplace.plugins;
  assert.equal(path.resolve(root, entry.source.path), path.resolve(root));
  assert.equal(entry.name, plugin.name);
  assert.equal(kimiMarketplace.plugins[0].id, manifest.name);
  assert.equal(kimiMarketplace.plugins[0].source, manifest.homepage);
  assert.equal(plugin.version, manifest.version);
  assert.equal(plugin.version, pkg.version);
  assert.equal(gemini.name, plugin.name);
  assert.equal(gemini.version, plugin.version);
});
