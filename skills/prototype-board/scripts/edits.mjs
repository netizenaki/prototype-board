import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const EDITS_FILE = 'prototype-board-edits.json';

export function emptyEdits() {
  return { title: null, boards: {}, text: {} };
}

export async function readEdits(directory) {
  try {
    const value = JSON.parse(await readFile(path.join(directory, EDITS_FILE), 'utf8'));
    return {
      title: typeof value.title === 'string' ? value.title : null,
      boards: value.boards && typeof value.boards === 'object' ? value.boards : {},
      text: value.text && typeof value.text === 'object' ? value.text : {},
      ...(Array.isArray(value.pages) && { pages: value.pages }),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyEdits();
    throw new Error(`Could not read ${EDITS_FILE}: ${error.message}`);
  }
}

export function applyEdits(data, edits) {
  const byId = new Map(data.pages.map((page) => [page.id, page]));
  for (const page of edits.pages ?? []) byId.set(page.id, { ...byId.get(page.id), ...page });
  const pages = [...byId.values()].filter((page) => !page.deleted);
  if (!pages.length) pages.push({ id: 'all', name: 'unnamed' });
  for (const page of pages) {
    if (page.id === 'all' && page.name === 'All boards') page.name = 'unnamed';
  }
  const pageIds = new Set(pages.map((page) => page.id));
  return {
    ...data,
    title: edits.title ?? data.title,
    pages,
    boards: data.boards.map((board) => {
      const edited = { ...board, ...edits.boards[board.file] };
      if (!pageIds.has(edited.page)) edited.page = pages[0].id;
      return edited;
    }),
    edits,
  };
}
