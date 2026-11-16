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
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyEdits();
    throw new Error(`Could not read ${EDITS_FILE}: ${error.message}`);
  }
}

export function applyEdits(data, edits) {
  return {
    ...data,
    title: edits.title ?? data.title,
    boards: data.boards.map((board) => ({ ...board, ...edits.boards[board.file] })),
    edits,
  };
}
