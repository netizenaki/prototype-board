import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, readEdits } from './edits.mjs';

const OUTPUT_FILES = ['index.html', 'prototype-board.css', 'prototype-board.js', 'prototype-board-data.js'];
const here = path.dirname(fileURLToPath(import.meta.url));

export function safeHtmlPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    throw new Error(`Invalid board path: ${value}`);
  }
  const normalized = path.posix.normalize(value.replace(/^\.\//, ''));
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || !normalized.endsWith('.html')) {
    throw new Error(`Board path must stay inside the export and point to an HTML file: ${value}`);
  }
  return normalized;
}

function fallbackLayout(files) {
  const gap = 48;
  const width = 1200;
  const height = 800;
  const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
  return {
    title: 'Prototype Board',
    pages: [{ id: 'all', name: 'unnamed' }],
    boards: files.map((file, index) => ({
      id: file,
      file,
      title: path.posix.basename(file, '.html'),
      x: (index % columns) * (width + gap),
      y: Math.floor(index / columns) * (height + gap),
      w: width,
      h: height,
      page: 'all',
    })),
  };
}

async function readLayout(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html') && !OUTPUT_FILES.includes(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  let canvas;
  try {
    canvas = JSON.parse(await readFile(path.join(directory, 'canvas.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read canvas.json: ${error.message}`);
  }

  if (!canvas) return fallbackLayout(files);
  const pages = Array.isArray(canvas.pages) && canvas.pages.length
    ? canvas.pages.map((page, index) => ({ id: String(page.id ?? `page-${index + 1}`), name: String(page.name ?? `Page ${index + 1}`) }))
    : [{ id: 'all', name: 'unnamed' }];
  const pageIds = new Set(pages.map((page) => page.id));
  const boards = Object.entries(canvas.boards ?? {}).map(([file, board]) => {
    const normalized = safeHtmlPath(file);
    for (const key of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(board[key]) || (['w', 'h'].includes(key) && board[key] <= 0)) {
        throw new Error(`Board ${file} has an invalid ${key}.`);
      }
    }
    return {
      id: normalized,
      file: normalized,
      title: String(board.title ?? path.posix.basename(normalized, '.html')),
      x: board.x,
      y: board.y,
      w: board.w,
      h: board.h,
      page: pageIds.has(String(board.page)) ? String(board.page) : pages[0].id,
    };
  });

  return { title: String(canvas.title ?? 'Prototype Board'), pages, boards };
}

export async function readExport(directory) {
  return applyEdits(await readLayout(directory), await readEdits(directory));
}
export function serializeData(data) {
  const json = JSON.stringify(data, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  return `window.PROTOTYPE_BOARD_DATA = ${json};\n`;
}

export async function build(directory) {
  const target = path.resolve(directory);
  await mkdir(target, { recursive: true });
  const layout = await readLayout(target);
  const edits = await readEdits(target);
  const viewer = path.join(here, '..', 'viewer');
  const copies = OUTPUT_FILES.slice(0, 3).map(async (file) => {
    const content = await readFile(path.join(viewer, file), 'utf8');
    await writeFile(path.join(target, file), content);
  });
  await Promise.all(copies);
  await writeFile(path.join(target, OUTPUT_FILES[3]), serializeData({ ...layout, edits }));
  return applyEdits(layout, edits);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Prototype Board always uses .prototype-board in the current project; directory arguments are not supported.');
    process.exitCode = 1;
  } else {
    try {
      const directory = path.resolve('.prototype-board');
      const data = await build(directory);
      console.log(`Prototype Board ready: ${data.boards.length} boards on ${data.pages.length} pages.`);
      console.log(`Open ${path.join(directory, 'index.html')}`);
    } catch (error) {
      console.error(`Prototype Board: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
