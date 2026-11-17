import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(import.meta.url);

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

async function capturePng(browser, url, width, height) {
  const directory = await mkdtemp(path.join(tmpdir(), 'prototype-board-still-'));
  const child = spawn(browser, [
    '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${directory}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const signal = AbortSignal.timeout(10000);
  const pending = new Map();
  try {
    let port;
    child.on('error', () => {});
    while (!port && child.exitCode === null) {
      const activePort = await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8').catch(() => '');
      port = activePort.split(/\r?\n/)[0];
      if (!port) await delay(25, undefined, { signal });
    }
    if (!/^\d+$/.test(port)) throw new Error('Thumbnail browser did not start.');
    const [tab] = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal })).json();
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    const interrupt = () => {
      for (const { reject } of pending.values()) reject(new Error('Thumbnail capture interrupted.'));
      pending.clear();
    };
    socket.addEventListener('close', interrupt);
    signal.addEventListener('abort', () => { interrupt(); socket.close(); }, { once: true });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
      socket.addEventListener('close', reject, { once: true });
    });
    let id = 0;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      socket.send(JSON.stringify({ id: ++id, method, params }));
      pending.set(id, { resolve, reject });
    });
    const deviceScaleFactor = Math.min(1, 1920 / Math.max(width, height));
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    await send('Page.enable');
    const loaded = new Promise((resolve, reject) => {
      socket.addEventListener('message', function onLoad({ data }) {
        if (JSON.parse(data).method !== 'Page.loadEventFired') return;
        socket.removeEventListener('message', onLoad);
        resolve();
      });
      signal.addEventListener('abort', reject, { once: true });
    });
    await Promise.all([send('Page.navigate', { url }), loaded]);
    await send('Runtime.evaluate', {
      expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      awaitPromise: true,
    });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  } finally {
    socket?.close();
    child.kill();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

async function capture(browser, url, width, height) {
  if (typeof WebSocket === 'function') return capturePng(browser, url, width, height);
  const { stdout } = await run(process.execPath, [
    '--experimental-websocket', script, browser, url, String(width), String(height),
  ], { timeout: 15000, windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [, , browser, url, width, height] = process.argv;
  process.stdout.write(await capturePng(browser, url, Number(width), Number(height)));
}

export function createThumbnailRenderer() {
  const browser = browserPath();
  const cache = new Map();
  let queue = Promise.resolve();
  return (key, url, width, height) => {
    if (!browser) return Promise.resolve(null);
    if (cache.has(key)) return cache.get(key);
    const image = queue.then(() => capture(browser, url, width, height)).catch(() => {
      cache.delete(key);
      return null;
    });
    cache.set(key, image);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    queue = image;
    return image;
  };
}
