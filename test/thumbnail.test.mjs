import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';

test('thumbnail queue shares a browser, limits concurrency and recovers after a failed capture', async () => {
  const source = await readFile(new URL('../skills/prototype-board/scripts/thumbnail.mjs', import.meta.url), 'utf8');
  let active = 0;
  let maximum = 0;
  let starts = 0;
  let closes = 0;
  let failNext = false;
  let cancelled = 0;
  const context = vm.createContext({
    path, createHash, Date, setTimeout, clearTimeout, AbortController,
    cacheDirectory: 'cache', cacheLifetime: 1000,
    browserPath: () => 'browser', assetStamp: async () => '',
    stat: async () => { throw new Error('Uncached'); },
    mkdir: async () => { throw new Error('No disk cache in this test'); },
    startBrowser: async () => {
      starts++;
      await delay(5);
      return { address: 'browser', close: async () => { assert.equal(active, 0); closes++; } };
    },
    capture: async (_address, _url, _width, _height, _size, signal) => {
      active++;
      maximum = Math.max(maximum, active);
      const failed = failNext;
      failNext = false;
      try { await delay(10, undefined, { signal }); }
      catch (error) { cancelled++; throw error; }
      finally { active--; }
      if (failed) throw new Error('Capture failed');
      return Buffer.from('png');
    },
  });
  vm.runInContext(source.slice(source.indexOf('export function createThumbnailRenderer')).replace('export function', 'function'), context);
  const renderer = context.createThumbnailRenderer('root', 'revision');
  const render = (key, signal) => renderer.render(key, 'url', 390, 844, 640, new Set(), signal, false);
  try {
    const images = await Promise.all(Array.from({ length: 6 }, (_, index) => render(String(index))));
    assert.ok(images.every(Buffer.isBuffer));
    assert.equal(maximum, 2);
    assert.equal(starts, 1);
    failNext = true;
    const recovered = await Promise.all(['fail', 'continue', 'retry'].map((key) => render(key)));
    assert.equal(recovered.filter((image) => image === null).length, 1);
    assert.equal(starts, 2);
    assert.equal(closes, 1);
    const first = new AbortController();
    const second = new AbortController();
    const shared = [render('shared', first.signal), render('shared', second.signal)];
    await delay(2);
    first.abort();
    assert.ok((await Promise.all(shared)).every(Buffer.isBuffer));
    assert.equal(cancelled, 0);
    const oldPage = [new AbortController(), new AbortController()];
    const abandoned = oldPage.map((client, index) => render(`old-${index}`, client.signal));
    await delay(2);
    for (const client of oldPage) client.abort();
    const newPage = render('new-page');
    assert.deepEqual(await Promise.all(abandoned), [null, null]);
    assert.ok(Buffer.isBuffer(await newPage));
    assert.equal(cancelled, 2);
    assert.equal(starts, 2);
    assert.equal(closes, 1);
  } finally { await renderer.close(); }
  assert.equal(closes, 2);
});
