import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const cacheDirectory = path.join(tmpdir(), 'prototype-board-thumbnails');
const cacheLifetime = 7 * 24 * 60 * 60 * 1000;
const cacheBytes = 128 * 1024 * 1024;
const cacheEntries = 512;
const generatedFiles = new Set(['index.html', 'prototype-board.js', 'prototype-board.css', 'prototype-board-data.js', 'prototype-board-edits.json']);

function browserPath() {
  const candidates = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).flatMap((root) => [
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((file) => existsSync(file));
}

async function startBrowser(browser) {
  const profile = await mkdtemp(path.join(tmpdir(), 'prototype-board-still-'));
  const child = spawn(browser, [
    '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  const signal = AbortSignal.timeout(5000);
  const close = async () => {
    child.kill();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  };
  try {
    let startError;
    child.on('error', (error) => { startError = error; });
    while (child.exitCode === null) {
      if (startError) throw startError;
      const [port, endpoint] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        .catch(() => '')).split(/\r?\n/);
      if (/^\d+$/.test(port) && endpoint?.startsWith('/devtools/browser/')) {
        return { address: 'ws://127.0.0.1:' + port + endpoint, close };
      }
      await delay(25, undefined, { signal });
    }
    throw new Error('Thumbnail browser did not start.');
  } catch (error) {
    await close();
    throw error;
  }
}

async function capturePng(address, url, width, height, maxSize) {
  const socket = new WebSocket(address);
  const signal = AbortSignal.timeout(10000);
  const pending = new Map();
  const interrupt = () => {
    for (const { reject } of pending.values()) reject(new Error('Thumbnail capture interrupted.'));
    pending.clear();
    socket.close();
  };
  signal.addEventListener('abort', interrupt, { once: true });
  socket.addEventListener('close', interrupt, { once: true });
  let context;
  let session;
  let id = 0;
  const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    socket.send(JSON.stringify({ id: ++id, method, params, sessionId }));
    pending.set(id, { resolve, reject });
  });
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
      socket.addEventListener('close', reject, { once: true });
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    ({ browserContextId: context } = await send('Target.createBrowserContext', { disposeOnDetach: true }));
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
    const deviceScaleFactor = Math.min(1, maxSize / Math.max(width, height));
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    await send('Page.enable');
    await send('Page.setLifecycleEventsEnabled', { enabled: true });
    const completedLoads = new Set();
    let navigation;
    const loaded = new Promise((resolve, reject) => {
      socket.addEventListener('message', ({ data }) => {
        const event = JSON.parse(data);
        if (event.method !== 'Page.lifecycleEvent' || event.sessionId !== session || event.params.name !== 'load') return;
        completedLoads.add(event.params.loaderId);
        if (event.params.loaderId === navigation?.loaderId) resolve();
      });
      send('Page.navigate', { url }).then((result) => {
        if (result.errorText) throw new Error(result.errorText);
        navigation = result;
        if (completedLoads.has(result.loaderId)) resolve();
      }).catch(reject);
      signal.addEventListener('abort', reject, { once: true });
      socket.addEventListener('close', reject, { once: true });
    });
    await loaded;
    // shortcut: allow 350 ms for initial rendering, add a readiness signal for slower exports.
    await delay(350, undefined, { signal });
    await send('Runtime.evaluate', {
      expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      awaitPromise: true,
    });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  } finally {
    if (context && socket.readyState === WebSocket.OPEN && !signal.aborted) {
      await send('Target.disposeBrowserContext', { browserContextId: context }, null).catch(() => {});
    }
    signal.removeEventListener('abort', interrupt);
    socket.close();
  }
}

async function capture(address, url, width, height, maxSize) {
  if (typeof WebSocket === 'function') return capturePng(address, url, width, height, maxSize);
  const { stdout } = await run(process.execPath, [
    '--experimental-websocket', script, address, url, String(width), String(height), String(maxSize),
  ], { timeout: 15000, windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [, , address, url, width, height, maxSize] = process.argv;
  process.stdout.write(await capturePng(address, url, Number(width), Number(height), Number(maxSize)));
}

async function assetStamp(root, htmlFiles) {
  const hash = createHash('sha256');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const assets = entries.filter((item) => item.isFile() && !generatedFiles.has(item.name))
    .map((item) => path.join(item.parentPath ?? item.path, item.name))
    .filter((file) => !htmlFiles.has(path.relative(root, file).split(path.sep).join('/')) && !file.endsWith('.tmp'))
    .sort();
  const stamps = await Promise.all(assets.map(async (file) => {
    const info = await stat(file).catch(() => null);
    return [path.relative(root, file), info?.mtimeMs, info?.size];
  }));
  return hash.update(JSON.stringify(stamps)).digest('hex');
}

async function pruneCache() {
  const entries = await readdir(cacheDirectory).catch(() => []);
  const images = (await Promise.all(entries.filter((name) => /^[\da-f]{64}\.png$/.test(name)).map(async (name) => {
    const file = path.join(cacheDirectory, name);
    const info = await stat(file).catch(() => null);
    return info && { file, size: info.size, saved: info.mtimeMs };
  }))).filter(Boolean).sort((a, b) => b.saved - a.saved);
  let size = 0;
  await Promise.all(images.map(({ file, size: bytes, saved }, index) => {
    size += bytes;
    if (index >= cacheEntries || size > cacheBytes || Date.now() - saved > cacheLifetime) {
      return rm(file, { force: true }).catch(() => {});
    }
  }));
}

export function createThumbnailRenderer(root, revision) {
  const executable = browserPath();
  const queued = [];
  const pending = new Map();
  let browser;
  let idleTimer;
  let assetCheck;
  let assetCheckedAt = 0;
  let writes = 0;
  let capturing = false;
  let stopped = false;

  function closeBrowser() {
    clearTimeout(idleTimer);
    const previous = browser;
    browser = null;
    return previous?.close();
  }

  async function pump() {
    if (capturing || !queued.length || stopped) return;
    capturing = true;
    clearTimeout(idleTimer);
    const job = queued.shift();
    try {
      if (job.signals.some((signal) => !signal?.aborted)) {
        browser ??= await startBrowser(executable);
        if (stopped) { await closeBrowser(); return; }
        const image = await capture(browser.address, job.url, job.width, job.height, job.maxSize);
        try {
          await mkdir(cacheDirectory, { recursive: true });
          const temporary = job.file + '.' + randomUUID() + '.tmp';
          try {
            await writeFile(temporary, image);
            await rename(temporary, job.file);
          } finally { await rm(temporary, { force: true }).catch(() => {}); }
          if (writes++ % 16 === 0) await pruneCache();
        } catch {}
        job.resolve(image);
      }
    } catch {
      await closeBrowser();
    } finally {
      job.resolve(null);
      pending.delete(job.file);
      capturing = false;
      if (queued.length && !stopped) pump();
      else if (browser) idleTimer = setTimeout(closeBrowser, 30000).unref();
    }
  }

  async function render(key, url, width, height, maxSize, htmlFiles, signal, priority) {
    if (stopped || signal?.aborted) return null;
    if (!assetCheck || Date.now() - assetCheckedAt > 3000) {
      assetCheckedAt = Date.now();
      assetCheck = assetStamp(root, htmlFiles).catch(() => '');
    }
    const stamp = await assetCheck;
    const hash = createHash('sha256').update(JSON.stringify([root, revision, key, stamp])).digest('hex');
    const file = path.join(cacheDirectory, hash + '.png');
    const saved = await stat(file).catch(() => null);
    if (saved && Date.now() - saved.mtimeMs <= cacheLifetime) {
      const image = await readFile(file).catch(() => null);
      if (image) return image;
    }
    if (!executable || stopped || signal?.aborted) return null;
    const existing = pending.get(file);
    if (existing) {
      existing.signals.push(signal);
      const index = queued.indexOf(existing);
      if (priority && index > 0) queued.unshift(...queued.splice(index, 1));
      return existing.promise;
    }
    for (let index = queued.length - 1; index >= 0; index--) {
      if (queued[index].signals.every((item) => item?.aborted)) {
        const [abandoned] = queued.splice(index, 1);
        pending.delete(abandoned.file);
        abandoned.resolve(null);
      }
    }
    if (queued.length >= (priority ? 8 : 6)) return null;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const job = { file, url, width, height, maxSize, signals: [signal], promise, resolve };
    pending.set(file, job);
    if (priority) queued.unshift(job);
    else queued.push(job);
    pump();
    return promise;
  }

  return {
    render,
    close() {
      stopped = true;
      for (const job of queued.splice(0)) job.resolve(null);
      pending.clear();
      return closeBrowser();
    },
  };
}
