(() => {
  'use strict';

  const data = window.PROTOTYPE_BOARD_DATA;
  const $ = (id) => document.getElementById(id);
  const viewport = $('viewport');
  const world = $('world');
  const preview = $('preview');
  const previewStage = $('preview-stage');
  const previewSheet = $('preview-sheet');
  const previewContent = $('preview-content');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const pauseButtons = document.querySelectorAll('[data-pause-animations]');
  const pauseKey = 'prototype-board:pause-animations';
  const icons = {
    play: '<path fill="currentColor" stroke="none" d="M6 3v14l11-7z"/>',
    pause: '<path d="M7 4v12m6-12v12"/>',
    fullscreen: '<path d="M3 8V3h5m4 0h5v5m0 4v5h-5m-4 0H3v-5"/>',
    undo: '<path d="M7 4 3 8l4 4M3 8h9a4 4 0 0 1 0 8"/>',
    redo: '<path d="m13 4 4 4-4 4m4-4H8a4 4 0 0 0 0 8"/>',
    delete: '<path d="M4 5h12M8 5V3h4v2M6 5l1 12h6l1-12M9 8v6m2-6v6"/>',
  };
  let pauseChoice = null;
  try { pauseChoice = localStorage.getItem(pauseKey); } catch {}
  let previewFrame = null;
  let playingFile = null;
  let canvasTile = null;
  let canvasFrame = null;
  let canvasVisible = false;
  const visibleStills = new Set();
  const thumbnailRequests = new Map();
  let thumbnailFrame;
  const thumbnailObserver = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting && target.isConnected) visibleStills.add(target);
      else visibleStills.delete(target);
    }
    scheduleThumbnails();
  }, { root: viewport });
  const canvasObserver = new IntersectionObserver(([entry]) => {
    if (entry?.target !== canvasTile) return;
    canvasVisible = entry.isIntersecting;
    syncCanvasPreview();
  }, { root: viewport });
  const help = $('help-dialog');
  const padding = 32;
  const canEdit = location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname);
  let editMode = false;
  let edits = data?.edits ?? { title: null, boards: {}, text: {} };
  let boards = [];
  let active = [];
  let pages = [];
  let pageId = '';
  let query = '';
  let scale = 1;
  let pan = { x: 0, y: 0 };
  let bounds = { x: 0, y: 0, width: 1, height: 1 };
  let previewIndex = 0;
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
    if (!editMode) $('page-actions').open = false;
    syncPagePicker();
    for (const id of ['mode-toggle', 'preview-mode']) {
      $(id).textContent = editMode ? 'Done' : 'Edit';
      $(id).setAttribute('aria-pressed', String(editMode));
      $(id).title = !canEdit
        ? 'Ask Codex to open the Prototype Board, or run scripts/serve.mjs from the project and open its HTTP URL.'
        : editMode ? 'Return to view mode' : 'Switch to edit mode';
    }
    $('interaction-hint').textContent = editMode ? 'Edit mode · Drag board labels to organize' : 'View mode · Drag to pan · Ctrl + scroll to zoom';
    for (const id of ['note', 'delete-board', 'project-title']) {
      $(id).disabled = !editMode;
    }
    $('edit-text').disabled = !editMode || !previewFrame;
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

  function syncPagePicker() {
    const picker = $('pages');
    picker.replaceChildren(...pages.map((page) => new Option(page.name, page.id)));
    picker.value = pageId;
    if (editMode) {
      const create = new Option('+ New page…');
      create.dataset.createPage = '';
      picker.append(create);
    }
    $('page-actions').querySelector('[data-action="delete-page"]').disabled = pages.length < 2;
  }

  function refresh(nextEdits) {
    edits = nextEdits;
    const byId = new Map(data.pages.map((page) => [page.id, page]));
    for (const page of edits.pages ?? []) byId.set(page.id, { ...byId.get(page.id), ...page });
    pages = [...byId.values()].filter((page) => !page.deleted);
    if (!pages.length) pages.push({ id: 'all', name: 'All boards' });
    const pageIds = new Set(pages.map((page) => page.id));
    if (!pageIds.has(pageId)) pageId = pages[0].id;
    syncPagePicker();
    boards = data.boards.map((board) => {
      const edited = { ...board, ...edits.boards[board.file] };
      if (!pageIds.has(edited.page)) edited.page = pages[0].id;
      return edited;
    }).filter((board) => !board.deleted);
    updateProjectTitle();
    render();
  }

  async function commit(change) {
    if (!canEdit || (!editMode && change.action !== 'rename-board')) {
      throw new Error('Switch to Edit mode before making changes.');
    }
    const response = await fetch('/__prototype-board/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not save the edit.');
    syncHistory(response);
    edits = result;
    return result;
  }

  function syncHistory(response) {
    for (const action of ['undo', 'redo']) {
      $(action).disabled = response.headers.get(`X-Prototype-Board-${action}`) !== 'true';
    }
  }

  async function applyHistory(action) {
    if (!editMode || $(action).disabled) return;
    try {
      const next = await commit({ action });
      if (previewFrame) {
        previewFrame.remove();
        previewFrame = null;
      }
      refresh(next);
    } catch (error) { report(error); }
  }

  function report(error) {
    toast(error.message);
  }

  function source(file) {
    return file.split('/').map(encodeURIComponent).join('/');
  }

  function thumbnailUrl(file, priority) {
    return `/__prototype-board/thumbnail?file=${encodeURIComponent(file)}${priority ? '&priority=1' : ''}`;
  }

  function makeStill(board, priority = false) {
    const still = document.createElement('div');
    still.className = 'board-still';
    const fallback = document.createElement('span');
    fallback.textContent = 'Preview available with Play';
    still.append(fallback);
    if (canEdit) {
      const image = document.createElement('img');
      image.alt = '';
      image.dataset.file = board.file;
      image.addEventListener('load', () => { image.classList.add('loaded'); }, { once: true });
      if (priority) image.src = thumbnailUrl(board.file, true) + '&full=1';
      still.append(image);
    }
    return still;
  }

  function scheduleThumbnails() {
    cancelAnimationFrame(thumbnailFrame);
    thumbnailFrame = requestAnimationFrame(loadThumbnails);
  }

  function loadThumbnails() {
    const view = viewport.getBoundingClientRect();
    const candidates = new Map();
    if (!preview.open && !world.classList.contains('overview')) {
      for (const image of visibleStills) {
        const rect = image.getBoundingClientRect();
        const overlap = Math.min(rect.right, view.right) - Math.max(rect.left, view.left);
        if (rect.width < 150 || overlap < 32 || rect.bottom <= view.top || rect.top >= view.bottom) continue;
        const distance = Math.abs(rect.top + rect.height / 2 - (view.top + view.height / 2))
          + Math.abs(rect.left + rect.width / 2 - (view.left + view.width / 2));
        candidates.set(image, image.dataset.file === playingFile ? -1 : distance);
      }
    }
    for (const [image, request] of thumbnailRequests) {
      if (!candidates.has(image)) request.abort();
    }
    const next = [...candidates].filter(([image]) => !image.src && !image.dataset.failed && !thumbnailRequests.has(image))
      .sort((a, b) => a[1] - b[1]);
    for (const [image, priority] of next.slice(0, Math.max(0, 2 - thumbnailRequests.size))) {
      const request = new AbortController();
      thumbnailRequests.set(image, request);
      fetch(thumbnailUrl(image.dataset.file, priority < 0), { signal: request.signal }).then(async (response) => {
        if (!response.ok) throw new Error('Thumbnail unavailable.');
        const blob = await response.blob();
        if (request.signal.aborted || !image.isConnected) return;
        const url = URL.createObjectURL(blob);
        const release = () => URL.revokeObjectURL(url);
        image.addEventListener('load', release, { once: true });
        image.addEventListener('error', release, { once: true });
        image.src = url;
      }).catch(() => {
        if (!request.signal.aborted) image.dataset.failed = 'true';
      }).finally(() => {
        thumbnailRequests.delete(image);
        scheduleThumbnails();
      });
    }
  }

  function makeLiveFrame(board) {
    const frame = document.createElement('iframe');
    frame.title = `Interactive preview of ${board.title}`;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    frame.src = source(board.file);
    return frame;
  }

  function watchCanvasTile(tile) {
    canvasObserver.disconnect();
    canvasTile = tile;
    canvasVisible = false;
    syncCanvasPreview();
    if (tile) canvasObserver.observe(tile);
  }

  function syncCanvasPreview() {
    const board = active.find(({ file }) => file === playingFile);
    const live = board && canvasVisible && !preview.open && !animationsPaused();
    if (!live || canvasFrame?.parentElement !== canvasTile) {
      canvasFrame?.remove();
      canvasFrame = null;
    }
    if (live && !canvasFrame) {
      canvasFrame = makeLiveFrame(board);
      canvasTile.append(canvasFrame);
    }
    for (const button of world.querySelectorAll('.board-open')) {
      const selected = button.dataset.file === playingFile && !animationsPaused();
      const label = selected ? 'Pause on canvas' : 'Play on canvas';
      if (button.title !== label) setIcon(button, selected ? 'pause' : 'play', label, `${label} · ${button.dataset.title}`);
    }
    scheduleThumbnails();
  }

  function setPaused(paused) {
    pauseChoice = String(paused);
    try { localStorage.setItem(pauseKey, pauseChoice); } catch {}
    syncMotion();
  }

  function setIcon(button, icon, label, description = label) {
    button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>`;
    button.title = label;
    button.setAttribute('aria-label', description);
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

  function ask({ title, message = '', value, destinations, confirmLabel = 'Save', danger = false }) {
    const dialog = $('action-dialog');
    const input = $('action-value');
    const select = $('action-page');
    $('action-title').textContent = title;
    $('action-message').textContent = message;
    $('action-message').hidden = !message;
    input.hidden = value === undefined;
    input.required = value !== undefined;
    input.value = value ?? '';
    select.hidden = !destinations;
    select.replaceChildren(...(destinations ?? []).map((page) => new Option(page.name, page.id)));
    $('confirm-action').textContent = confirmLabel;
    $('confirm-action').classList.toggle('danger', danger);
    dialog.returnValue = '';
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'confirm' ? (destinations ? select.value : value === undefined ? true : input.value) : null);
      }, { once: true });
      dialog.showModal();
      if (value !== undefined) {
        input.focus();
        input.select();
      }
    });
  }

  async function changePage(action) {
    const page = pages.find(({ id }) => id === pageId);
    if (!editMode || !page || !action) return;
    try {
      if (action === 'delete-page') {
        const destinations = pages.filter(({ id }) => id !== page.id);
        if (!destinations.length) return;
        const destination = await ask({
          title: 'Delete page?',
          message: `Delete “${page.name}” and move its artboards to the page you select.`,
          destinations, confirmLabel: 'Delete page', danger: true,
        });
        if (!destination) return;
        const next = await commit({ action, page: page.id, destination });
        pageId = destination;
        refresh(next);
        return;
      }
      const creating = action === 'create-page';
      const name = await ask({ title: creating ? 'New page' : 'Rename page', value: creating ? '' : page.name });
      if (!name?.trim()) return;
      const next = await commit({ action, page: page.id, name });
      if (creating) pageId = next.pages.at(-1).id;
      refresh(next);
    } catch (error) { report(error); }
  }

  async function moveToPage(board) {
    if (!editMode || !board) return;
    const destinations = pages.filter(({ id }) => id !== board.page);
    if (!destinations.length) return;
    const destination = await ask({ title: 'Move artboard to page', destinations, confirmLabel: 'Move' });
    if (!destination) return;
    try {
      const next = await commit({ action: 'move-to-page', file: board.file, page: destination });
      pageId = destination;
      refresh(next);
      toast('Artboard moved.');
    } catch (error) { report(error); }
  }

  function renameBoard(board, label) {
    const input = document.createElement('input');
    input.className = 'board-name-input';
    input.type = 'text';
    input.value = board.title;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Artboard name');
    let cancelled = false;
    let returnFocus = false;
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelled = event.key === 'Escape';
      returnFocus = true;
      input.blur();
    });
    input.addEventListener('blur', async () => {
      const title = input.value.trim();
      input.replaceWith(label);
      if (returnFocus) label.focus({ preventScroll: true });
      if (cancelled || !title || title === board.title) return;
      try {
        refresh(await commit({ action: 'rename-board', file: board.file, title }));
        if (returnFocus && document.activeElement === document.body) {
          const article = [...world.children].find((item) => item.dataset.id === board.id);
          article?.querySelector('.board-name')?.focus({ preventScroll: true });
        }
        toast('Board renamed.');
      } catch (error) { report(error); }
    }, { once: true });
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  function moveBoard(event, board, label, article) {
    if (!editMode || event.button !== 0 || event.target.closest('button, input')) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, boardX: board.x, boardY: board.y };
    let moved = false;
    event.target.setPointerCapture(event.pointerId);
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
    article.dataset.id = board.id;
    positionBoard(article, board);

    const label = document.createElement('div');
    label.className = 'board-label';
    const title = document.createElement('strong');
    title.className = 'board-name';
    title.textContent = board.title;
    if (board.note) title.textContent += ' · Note';
    title.title = [board.note ?? board.title, canEdit && 'Double-click to rename'].filter(Boolean).join(' · ');
    if (canEdit) {
      title.tabIndex = 0;
      title.addEventListener('dblclick', () => renameBoard(board, title));
      title.addEventListener('keydown', (event) => {
        if (!['Enter', 'F2'].includes(event.key)) return;
        event.preventDefault();
        renameBoard(board, title);
      });
    }
    const size = document.createElement('span');
    size.textContent = `${board.w} × ${board.h}`;
    label.append(title, size);
    label.addEventListener('pointerdown', (event) => moveBoard(event, board, label, article));

    const frame = document.createElement('div');
    frame.className = 'board-frame';
    frame.style.height = `${board.h}px`;
    frame.dataset.file = board.file;
    frame.append(makeStill(board));
    const open = document.createElement('button');
    open.className = 'board-open';
    open.type = 'button';
    open.dataset.file = board.file;
    open.dataset.title = board.title;
    open.addEventListener('click', () => {
      playingFile = playingFile === board.file && !animationsPaused() ? null : board.file;
      watchCanvasTile(playingFile ? frame : null);
      if (playingFile && animationsPaused()) setPaused(false);
    });
    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    setIcon(fullscreen, 'fullscreen', 'Preview full screen', `Preview full screen · ${board.title}`);
    fullscreen.addEventListener('click', () => openPreview(active.indexOf(board)));
    const remove = document.createElement('button');
    remove.className = 'board-delete';
    remove.type = 'button';
    setIcon(remove, 'delete', 'Delete', `Delete ${board.title}`);
    remove.addEventListener('click', () => deleteBoard(board));
    label.append(open, fullscreen, remove);
    article.append(label, frame);
    return article;
  }

  function render() {
    const previewFile = preview.open ? active[previewIndex]?.file : null;
    active = boards.filter((board) => board.page === pageId && `${board.title} ${board.file}`.toLowerCase().includes(query));
    const nextPreview = active.findIndex((board) => board.file === previewFile);
    if (preview.open && nextPreview < 0) preview.close();
    world.replaceChildren();
    thumbnailObserver.disconnect();
    visibleStills.clear();
    watchCanvasTile(null);
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
    for (const image of world.querySelectorAll('.board-still img')) thumbnailObserver.observe(image);
    watchCanvasTile([...world.querySelectorAll('.board-frame')].find((frame) => frame.dataset.file === playingFile));
    if (nextPreview >= 0) openPreview(nextPreview);
    fit();
  }

  function applyTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    world.classList.toggle('overview', scale < 0.18);
    const headerScale = Math.max(0.8, Math.min(1.4, Math.sqrt(scale)));
    world.style.setProperty('--header-unit', `${headerScale / scale}px`);
    $('zoom-value').textContent = `${Math.round(scale * 100)}%`;
    scheduleThumbnails();
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
    previewFrame?.contentWindow?.postMessage({ type: 'prototype-board:select', enabled: false }, '*');
    $('text-editor').hidden = true;
    selected = null;
  }

  function animationsPaused() {
    return pauseChoice === null ? motionPreference.matches : pauseChoice === 'true';
  }

  function syncMotion() {
    const paused = animationsPaused();
    for (const button of pauseButtons) {
      button.setAttribute('aria-pressed', String(paused));
      setIcon(button, paused ? 'play' : 'pause', paused ? 'Play animations' : 'Pause animations');
    }
    syncCanvasPreview();
    if (preview.open) updatePreviewFrame(active[previewIndex]);
  }

  function updatePreviewFrame(board) {
    const nextSource = preview.open && board && !animationsPaused() ? source(board.file) : null;
    $('preview-paused').hidden = !preview.open || !animationsPaused();
    if (!$('preview-paused').hidden) updatePausedStill(board);
    $('edit-text').disabled = !editMode || !nextSource;
    if (previewFrame?.getAttribute('src') === nextSource) return;
    stopTextSelection();
    previewFrame?.remove();
    previewFrame = null;
    if (!nextSource) return;
    previewFrame = makeLiveFrame(board);
    previewFrame.id = 'preview-frame';
    previewContent.append(previewFrame);
  }

  function updatePausedStill(board) {
    if (!board) return;
    const paused = $('preview-paused');
    const key = JSON.stringify([board.file, edits.text[board.file]]);
    if (paused.dataset.capture === key) return;
    paused.replaceChildren(makeStill(board, true));
    paused.dataset.capture = key;
  }

  function fitPreview() {
    const board = active[previewIndex];
    if (!preview.open || !board || !previewStage.clientWidth) return;
    previewSheet.style.setProperty('--preview-scale', String(Math.min(1, previewStage.clientWidth / board.w)));
  }

  function openPreview(index) {
    if (index < 0 || !active[index]) return;
    stopTextSelection();
    previewIndex = index;
    const board = active[index];
    $('preview-title').textContent = board.title;
    $('preview-position').textContent = `${index + 1} of ${active.length} · ${board.w} × ${board.h}${board.note ? ' · Note' : ''}`;
    $('previous').hidden = active.length < 2;
    $('next').hidden = active.length < 2;
    $('move-to-page').disabled = pages.length < 2;
    previewSheet.style.setProperty('--preview-width', `${board.w}px`);
    previewSheet.style.setProperty('--preview-height', `${board.h}px`);
    if (previewContent.dataset.file !== board.file) previewStage.scrollTop = 0;
    previewContent.dataset.file = board.file;
    if (!preview.open) preview.showModal();
    fitPreview();
    syncCanvasPreview();
    updatePreviewFrame(board);
  }

  function movePreview(direction) {
    openPreview((previewIndex + direction + active.length) % active.length);
  }

  async function deleteBoard(board) {
    if (!editMode || !board || !await ask({ title: 'Delete board?', message: `Remove “${board.title}” from this canvas? The source HTML will not be deleted.`, confirmLabel: 'Delete', danger: true })) return;
    try {
      const next = await commit({ action: 'delete', file: board.file });
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
    const path = selected.path;
    const text = $('text-value').value;
    if (!await ask({ title: 'Save text override?', message: 'This change will be visible immediately and whenever the prototype loads. The source HTML will not be changed.', confirmLabel: 'Save text' })) return;
    try {
      await commit({ action: 'text', file: board.file, path, text });
      if (active[previewIndex]?.file === board.file) {
        previewFrame?.contentWindow?.postMessage({ type: 'prototype-board:set-text', path, text }, '*');
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
    if (!previewFrame || event.source !== previewFrame.contentWindow || event.data?.type !== 'prototype-board:selected') return;
    selected = { path: event.data.path, text: event.data.text };
    $('element-path').textContent = selected.path;
    $('text-value').value = selected.text;
    $('text-editor').hidden = false;
    $('text-value').focus();
  });

  for (const id of ['mode-toggle', 'preview-mode']) {
    $(id).disabled = !canEdit;
    $(id).addEventListener('click', () => {
      setMode(!editMode);
      toast(editMode ? 'Edit mode enabled.' : 'View mode enabled.');
    });
  }
  setMode(false);
  for (const action of ['undo', 'redo']) {
    setIcon($(action), action, action === 'undo' ? 'Undo' : 'Redo');
    $(action).addEventListener('click', () => applyHistory(action));
  }
  for (const button of pauseButtons) {
    button.addEventListener('click', () => setPaused(!animationsPaused()));
  }
  motionPreference.addEventListener('change', syncMotion);
  syncMotion();

  $('pages').addEventListener('change', ({ target }) => {
    if (target.selectedOptions[0]?.hasAttribute('data-create-page')) {
      target.value = pageId;
      changePage('create-page');
      return;
    }
    pageId = target.value;
    render();
  });
  const pageMenu = $('page-actions');
  pageMenu.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    pageMenu.open = false;
    pageMenu.querySelector('summary').focus();
    changePage(action);
  });
  document.addEventListener('click', (event) => {
    if (pageMenu.open && !pageMenu.contains(event.target)) pageMenu.open = false;
  });
  $('search').addEventListener('input', (event) => { query = event.target.value.trim().toLowerCase(); render(); });
  $('fit').addEventListener('click', fit);
  $('zoom-value').addEventListener('click', () => zoom(1));
  $('help').addEventListener('click', () => help.showModal());
  $('previous').addEventListener('click', () => movePreview(-1));
  $('next').addEventListener('click', () => movePreview(1));
  $('close-preview').addEventListener('click', () => preview.close());
  $('delete-board').addEventListener('click', () => deleteBoard(active[previewIndex]));
  $('move-to-page').addEventListener('click', () => moveToPage(active[previewIndex]));
  $('note').addEventListener('click', openNote);
  $('save-note').addEventListener('click', saveNote);
  $('cancel-note').addEventListener('click', () => $('note-dialog').close());
  $('cancel-action').addEventListener('click', () => $('action-dialog').close('cancel'));
  $('edit-text').addEventListener('click', () => {
    if (!previewFrame) return;
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
  preview.addEventListener('close', () => {
    if (preview.open) return;
    updatePreviewFrame();
    syncCanvasPreview();
  });
  new ResizeObserver(fitPreview).observe(previewStage);

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
    if (event.target.closest('button, input, .board-name')) { dragged = false; return; }
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
    if (event.key === 'Escape' && pageMenu.open) {
      pageMenu.open = false;
      pageMenu.querySelector('summary').focus();
      return;
    }
    const typing = /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (preview.open) preview.close();
      $('search').focus();
      return;
    }
    if (help.open || $('note-dialog').open || $('action-dialog').open) return;
    if (preview.open && event.key === 'Escape') { preview.close(); return; }
    if (typing) return;
    if (editMode && (event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        applyHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        return;
      }
    }
    if (preview.open && preview.contains(event.target)) {
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

  refresh(edits);
  if (canEdit) {
    fetch('/__prototype-board/state').then((response) => {
      if (!response.ok) return null;
      syncHistory(response);
      return response.json();
    }).then((state) => {
      if (state) refresh(state);
    }).catch(() => {});
  }
})();
