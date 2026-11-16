(() => {
  'use strict';

  const data = window.PROTOTYPE_BOARD_DATA;
  const $ = (id) => document.getElementById(id);
  const viewport = $('viewport');
  const world = $('world');
  const preview = $('preview');
  const previewFrame = $('preview-frame');
  const help = $('help-dialog');
  const padding = 32;
  const canEdit = ['localhost', '127.0.0.1'].includes(location.hostname);
  let editMode = false;
  let edits = data?.edits ?? { title: null, boards: {}, text: {} };
  let boards = [];
  let active = [];
  let pageId = '';
  let query = '';
  let scale = 1;
  let pan = { x: 0, y: 0 };
  let bounds = { x: 0, y: 0, width: 1, height: 1 };
  let previewIndex = 0;
  let frameUpdate = 0;
  let drag = null;
  let dragged = false;
  let selected = null;
  let toastTimer = 0;

  function fail(message) {
    $('empty').hidden = false;
    $('empty').querySelector('strong').textContent = 'Could not open this board';
    $('empty').querySelector('p').textContent = message;
    $('count').textContent = '0 boards';
  }

  if (!data || !Array.isArray(data.boards) || !Array.isArray(data.pages)) {
    fail('Run the generator in a valid prototype export directory.');
    return;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    (preview.open ? preview : document.body).append($('toast'));
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }

  function setMode(enabled) {
    editMode = enabled && canEdit;
    document.body.classList.toggle('edit-mode', editMode);
    for (const id of ['mode-toggle', 'preview-mode']) {
      $(id).textContent = editMode ? 'Done' : 'Edit';
      $(id).setAttribute('aria-pressed', String(editMode));
      $(id).title = editMode ? 'Return to view mode' : 'Switch to edit mode';
    }
    $('interaction-hint').textContent = editMode ? 'Edit mode · Drag board labels to organize' : 'View mode · Drag to pan · Ctrl + scroll to zoom';
    for (const id of ['edit-text', 'note', 'rename-board', 'delete-board', 'project-title']) {
      $(id).disabled = !editMode;
    }
    if (!editMode) {
      stopTextSelection();
      if ($('note-dialog').open) $('note-dialog').close();
    }
  }

  function updateProjectTitle() {
    const title = edits.title ?? data.title;
    document.title = `${title} · Prototype Board`;
    $('project-title').textContent = title;
  }

  function refresh(nextEdits) {
    edits = nextEdits;
    boards = data.boards.map((board) => ({ ...board, ...edits.boards[board.file] })).filter((board) => !board.deleted);
    updateProjectTitle();
    render();
    if (preview.open && active.length) openPreview(Math.min(previewIndex, active.length - 1));
  }

  async function commit(change) {
    if (!canEdit || !editMode) throw new Error('Switch to Edit mode before making changes.');
    const response = await fetch('/__prototype-board/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not save the edit.');
    edits = result;
    return result;
  }

  function report(error) {
    toast(error.message);
  }

  function source(file) {
    return file.split('/').map(encodeURIComponent).join('/');
  }

  function calculateBounds() {
    if (!active.length) return;
    const minX = Math.min(...active.map((board) => board.x));
    const minY = Math.min(...active.map((board) => board.y));
    const maxX = Math.max(...active.map((board) => board.x + board.w));
    const maxY = Math.max(...active.map((board) => board.y + board.h));
    bounds = { x: minX, y: minY, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
  }

  function positionBoard(article, board) {
    article.style.left = `${board.x - bounds.x + padding}px`;
    article.style.top = `${board.y - bounds.y + padding}px`;
  }

  function positionBoards() {
    for (const article of world.children) {
      const board = active.find((item) => item.id === article.dataset.id);
      if (board) positionBoard(article, board);
    }
  }

  function ask({ title, message = '', value, confirmLabel = 'Save', danger = false }) {
    const dialog = $('action-dialog');
    const input = $('action-value');
    $('action-title').textContent = title;
    $('action-message').textContent = message;
    $('action-message').hidden = !message;
    input.hidden = value === undefined;
    input.required = value !== undefined;
    input.value = value ?? '';
    $('confirm-action').textContent = confirmLabel;
    $('confirm-action').classList.toggle('danger', danger);
    dialog.returnValue = '';
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'confirm' ? (value === undefined ? true : input.value) : null);
      }, { once: true });
      dialog.showModal();
      if (value !== undefined) {
        input.focus();
        input.select();
      }
    });
  }

  async function renameBoard(board) {
    if (!editMode || !board) return;
    const title = await ask({ title: 'Rename board', value: board.title });
    if (title === null || !title.trim() || title === board.title) return;
    try {
      const next = await commit({ action: 'rename-board', file: board.file, title: title.trim() });
      refresh(next);
      toast('Board renamed.');
    } catch (error) { report(error); }
  }

  function moveBoard(event, board, label, article) {
    if (!editMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, boardX: board.x, boardY: board.y };
    let moved = false;
    label.setPointerCapture(event.pointerId);
    label.classList.add('moving');
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      board.x = start.boardX + dx / scale;
      board.y = start.boardY + dy / scale;
      positionBoard(article, board);
    };
    const onEnd = async () => {
      label.removeEventListener('pointermove', onMove);
      label.removeEventListener('pointerup', onEnd);
      label.removeEventListener('pointercancel', onEnd);
      label.classList.remove('moving');
      if (!moved) return;
      calculateBounds();
      positionBoards();
      applyTransform();
      try {
        await commit({ action: 'move', file: board.file, x: board.x, y: board.y });
        toast('Position saved.');
      } catch (error) {
        board.x = start.boardX;
        board.y = start.boardY;
        calculateBounds();
        positionBoards();
        applyTransform();
        report(error);
      }
    };
    label.addEventListener('pointermove', onMove);
    label.addEventListener('pointerup', onEnd);
    label.addEventListener('pointercancel', onEnd);
  }

  function makeBoard(board) {
    const article = document.createElement('article');
    article.className = 'board';
    article.style.width = `${board.w}px`;
    article.style.height = `${board.h + 34}px`;
    article.dataset.id = board.id;
    positionBoard(article, board);

    const label = document.createElement('div');
    label.className = 'board-label';
    label.title = editMode ? 'Drag to move · Double-click to rename' : 'View mode · Switch to Edit to organize';
    const title = document.createElement('strong');
    title.textContent = board.title;
    if (board.note) title.textContent += ' · Note';
    title.title = board.note ?? board.title;
    title.addEventListener('dblclick', () => renameBoard(board));
    const size = document.createElement('span');
    size.textContent = `${board.w} × ${board.h}`;
    label.append(title, size);
    label.addEventListener('pointerdown', (event) => moveBoard(event, board, label, article));

    const frame = document.createElement('div');
    frame.className = 'board-frame';
    const iframe = document.createElement('iframe');
    iframe.title = board.title;
    iframe.loading = 'lazy';
    iframe.tabIndex = -1;
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    iframe.dataset.src = source(board.file);
    const open = document.createElement('button');
    open.className = 'board-open';
    open.type = 'button';
    open.setAttribute('aria-label', `Preview ${board.title}`);
    open.addEventListener('click', () => openPreview(active.indexOf(board)));
    frame.append(iframe, open);
    article.append(label, frame);
    return article;
  }

  function render() {
    active = boards.filter((board) => board.page === pageId && `${board.title} ${board.file}`.toLowerCase().includes(query));
    world.replaceChildren();
    $('empty').hidden = active.length > 0;
    $('count').textContent = `${active.length} ${active.length === 1 ? 'board' : 'boards'}`;
    if (!active.length) {
      const emptyCanvas = boards.length === 0;
      $('empty').querySelector('strong').textContent = emptyCanvas ? 'Empty canvas' : 'No boards found';
      $('empty').querySelector('p').textContent = emptyCanvas ? 'Add HTML prototypes to this folder, then regenerate.' : 'Try another search or page.';
      return;
    }
    calculateBounds();
    const fragment = document.createDocumentFragment();
    for (const board of active) fragment.append(makeBoard(board));
    world.append(fragment);
    fit();
  }

  function updateFrames() {
    frameUpdate = 0;
    const rect = viewport.getBoundingClientRect();
    for (const article of world.children) {
      const board = active.find((item) => item.id === article.dataset.id);
      if (!board) continue;
      const x = pan.x + (board.x - bounds.x + padding) * scale;
      const y = pan.y + (board.y - bounds.y + padding + 34) * scale;
      const near = x + board.w * scale > -400 && y + board.h * scale > -400 && x < rect.width + 400 && y < rect.height + 400;
      const iframe = article.querySelector('iframe');
      if (near && !iframe.src) iframe.src = iframe.dataset.src;
    }
  }

  function scheduleFrames() {
    if (!frameUpdate) frameUpdate = requestAnimationFrame(updateFrames);
  }

  function applyTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    $('zoom-value').textContent = `${Math.round(scale * 100)}%`;
    scheduleFrames();
  }

  function fit() {
    if (!active.length) return;
    const room = 40;
    scale = Math.min((viewport.clientWidth - room) / bounds.width, (viewport.clientHeight - room) / bounds.height, 1);
    scale = Math.max(scale, 0.02);
    pan = { x: (viewport.clientWidth - bounds.width * scale) / 2, y: (viewport.clientHeight - bounds.height * scale) / 2 };
    applyTransform();
  }

  function zoom(next, center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    const previous = scale;
    scale = Math.max(0.02, Math.min(3, next));
    const ratio = scale / previous;
    pan = { x: center.x - (center.x - pan.x) * ratio, y: center.y - (center.y - pan.y) * ratio };
    applyTransform();
  }

  function stopTextSelection() {
    previewFrame.contentWindow?.postMessage({ type: 'prototype-board:select', enabled: false }, '*');
    $('text-editor').hidden = true;
    selected = null;
  }

  function openPreview(index) {
    if (index < 0 || !active[index]) return;
    stopTextSelection();
    previewIndex = index;
    const board = active[index];
    $('preview-title').textContent = board.title;
    $('preview-position').textContent = `${index + 1} of ${active.length} · ${board.w} × ${board.h}${board.note ? ' · Note' : ''}`;
    const nextSource = source(board.file);
    if (previewFrame.getAttribute('src') !== nextSource) previewFrame.src = nextSource;
    $('previous').disabled = active.length < 2;
    $('next').disabled = active.length < 2;
    if (!preview.open) preview.showModal();
  }

  function movePreview(direction) {
    openPreview((previewIndex + direction + active.length) % active.length);
  }

  async function deletePreviewBoard() {
    const board = active[previewIndex];
    if (!board || !await ask({ title: 'Delete board?', message: `Remove “${board.title}” from this canvas? The source HTML will not be deleted.`, confirmLabel: 'Delete', danger: true })) return;
    try {
      const next = await commit({ action: 'delete', file: board.file });
      preview.close();
      refresh(next);
      toast('Board removed. Source HTML preserved.');
    } catch (error) { report(error); }
  }

  function openNote() {
    const board = active[previewIndex];
    if (!board) return;
    $('note-board-title').textContent = board.title;
    $('note-value').value = board.note ?? '';
    $('note-dialog').showModal();
  }

  async function saveNote() {
    const board = active[previewIndex];
    if (!board) return;
    try {
      const next = await commit({ action: 'note', file: board.file, note: $('note-value').value });
      $('note-dialog').close();
      refresh(next);
      toast('Note saved.');
    } catch (error) { report(error); }
  }

  async function saveText() {
    const board = active[previewIndex];
    if (!board || !selected) return;
    if (!await ask({ title: 'Save text override?', message: 'This change will be visible immediately and whenever the prototype loads. The source HTML will not be changed.', confirmLabel: 'Save text' })) return;
    try {
      const next = await commit({ action: 'text', file: board.file, path: selected.path, text: $('text-value').value });
      edits = next;
      for (const iframe of document.querySelectorAll('iframe')) {
        iframe.contentWindow?.postMessage({ type: 'prototype-board:set-text', path: selected.path, text: $('text-value').value }, '*');
      }
      stopTextSelection();
      toast('Text override saved. Source HTML preserved.');
    } catch (error) { report(error); }
  }

  async function copyForAi() {
    const board = active[previewIndex];
    if (!board || !selected) return;
    const request = [
      'Prototype Board text edit:',
      `Board: ${board.title}`,
      `File: ${board.file}`,
      `Element: ${selected.path}`,
      `Current text: ${selected.text}`,
      `Requested replacement or instruction: ${$('text-value').value}`,
      'Apply this as a Prototype Board text override, preserving the source HTML.',
    ].join('\n');
    const textarea = document.createElement('textarea');
    textarea.value = request;
    preview.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) await navigator.clipboard.writeText(request);
    toast('Copied. Paste this request into Kimi.');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== previewFrame.contentWindow || event.data?.type !== 'prototype-board:selected') return;
    selected = { path: event.data.path, text: event.data.text };
    $('element-path').textContent = selected.path;
    $('text-value').value = selected.text;
    $('text-editor').hidden = false;
    $('text-value').focus();
  });

  for (const page of data.pages) {
    const option = document.createElement('option');
    option.value = page.id;
    option.textContent = page.name;
    $('pages').append(option);
  }
  pageId = data.pages[0]?.id ?? '';
  boards = data.boards.filter((board) => !board.deleted);
  updateProjectTitle();

  for (const id of ['mode-toggle', 'preview-mode']) {
    $(id).disabled = !canEdit;
    if (!canEdit) $(id).title = 'Open through the Prototype Board skill to edit';
    $(id).addEventListener('click', () => {
      setMode(!editMode);
      toast(editMode ? 'Edit mode enabled.' : 'View mode enabled.');
    });
  }
  setMode(false);

  $('pages').addEventListener('change', (event) => { pageId = event.target.value; render(); });
  $('search').addEventListener('input', (event) => { query = event.target.value.trim().toLowerCase(); render(); });
  $('fit').addEventListener('click', fit);
  $('zoom-value').addEventListener('click', () => zoom(1));
  $('help').addEventListener('click', () => help.showModal());
  $('previous').addEventListener('click', () => movePreview(-1));
  $('next').addEventListener('click', () => movePreview(1));
  $('close-preview').addEventListener('click', () => preview.close());
  $('delete-board').addEventListener('click', deletePreviewBoard);
  $('rename-board').addEventListener('click', () => renameBoard(active[previewIndex]));
  $('note').addEventListener('click', openNote);
  $('save-note').addEventListener('click', saveNote);
  $('cancel-note').addEventListener('click', () => $('note-dialog').close());
  $('cancel-action').addEventListener('click', () => $('action-dialog').close('cancel'));
  $('edit-text').addEventListener('click', () => {
    if (previewFrame.getAttribute('src') === 'about:blank') return;
    toast('Click a text element in the preview.');
    previewFrame.contentWindow?.postMessage({ type: 'prototype-board:select', enabled: true }, '*');
  });
  $('save-text').addEventListener('click', saveText);
  $('copy-for-ai').addEventListener('click', copyForAi);
  $('cancel-text').addEventListener('click', stopTextSelection);
  $('project-title').addEventListener('click', async () => {
    const title = await ask({ title: 'Rename project', value: edits.title ?? data.title });
    if (title === null || !title.trim()) return;
    try {
      const next = await commit({ action: 'rename-project', title: title.trim() });
      refresh(next);
      toast('Project renamed.');
    } catch (error) { report(error); }
  });
  preview.addEventListener('close', () => { stopTextSelection(); previewFrame.src = 'about:blank'; });

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      zoom(scale * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else {
      pan = { x: pan.x - event.deltaX, y: pan.y - event.deltaY };
      applyTransform();
    }
  }, { passive: false });

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    dragged = false;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    if (dragged) {
      pan = { x: drag.panX + dx, y: drag.panY + dy };
      applyTransform();
    }
  });
  viewport.addEventListener('pointerup', () => { drag = null; viewport.classList.remove('dragging'); });
  viewport.addEventListener('pointercancel', () => { drag = null; viewport.classList.remove('dragging'); });
  viewport.addEventListener('click', (event) => {
    if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; }
  }, true);

  document.addEventListener('keydown', (event) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(event.target.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (preview.open) preview.close();
      $('search').focus();
      return;
    }
    if (typing || help.open || $('note-dialog').open) return;
    if (preview.open) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); movePreview(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); movePreview(1); }
      return;
    }
    if (event.key === '?') help.showModal();
    if (event.key.toLowerCase() === 'f') fit();
    if (event.key === '0') zoom(1);
    if (event.key === '+' || event.key === '=') zoom(scale * 1.2);
    if (event.key === '-') zoom(scale / 1.2);
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const distance = event.shiftKey ? 200 : 60;
      if (event.key === 'ArrowLeft') pan.x += distance;
      if (event.key === 'ArrowRight') pan.x -= distance;
      if (event.key === 'ArrowUp') pan.y += distance;
      if (event.key === 'ArrowDown') pan.y -= distance;
      applyTransform();
    }
  });

  window.addEventListener('resize', scheduleFrames);
  render();
  if (canEdit) {
    fetch('/__prototype-board/state').then((response) => response.ok ? response.json() : null).then((state) => {
      if (state) refresh(state);
    }).catch(() => {});
  }
})();
