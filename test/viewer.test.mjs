import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('visible stills upgrade with zoom and pixel density without refetching sharper images', async () => {
  const source = await readFile(new URL('../skills/prototype-board/viewer/prototype-board.js', import.meta.url), 'utf8');
  let width = 20;
  let left = 0;
  const image = {
    dataset: { file: 'phone.html' }, isConnected: true,
    getBoundingClientRect: () => ({ left, right: left + width, top: 0, bottom: width * 2, width, height: width * 2 }),
    addEventListener() {},
  };
  const requests = [];
  const context = vm.createContext({
    window: { devicePixelRatio: 1 },
    viewport: { getBoundingClientRect: () => ({ left: 0, right: 1200, top: 0, bottom: 900, width: 1200, height: 900 }) },
    preview: { open: false }, world: { classList: { contains: () => true } },
    visibleStills: new Set([image]), thumbnailRequests: new Map(), playingFile: null,
    AbortController, URL, scheduleThumbnails() {},
    fetch: async (url) => { requests.push(url); return { ok: true, blob: async () => new Blob(['still']) }; },
  });
  const functions = source.slice(source.indexOf('  function thumbnailUrl('), source.indexOf('  function makeLiveFrame('));
  vm.runInContext(functions, context);
  context.scheduleThumbnails = () => {};
  const load = async () => {
    vm.runInContext('loadThumbnails()', context);
    await new Promise(setImmediate);
  };
  await load();
  assert.match(requests[0], /size=640$/);
  width = 300;
  await load();
  assert.equal(requests.length, 1);
  const previous = image.src;
  width = 600;
  vm.runInContext('loadThumbnails()', context);
  assert.equal(image.src, previous);
  await new Promise(setImmediate);
  assert.match(requests[1], /size=1280$/);
  context.window.devicePixelRatio = 2;
  await load();
  assert.match(requests[2], /size=2560$/);
  width = 300;
  await load();
  assert.equal(requests.length, 3);
  context.window.devicePixelRatio = 10;
  await load();
  assert.match(requests[3], /size=4096$/);
  delete image.dataset.size;
  left = -width;
  await load();
  assert.equal(requests.length, 4);
  left = 0;
  context.preview.open = true;
  await load();
  assert.equal(requests.length, 4);
  context.preview.open = false;
  await load();
  assert.match(requests[4], /size=640$/);
  await load();
  assert.match(requests[5], /size=4096$/);
});
