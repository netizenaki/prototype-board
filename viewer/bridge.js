(() => {
  const overrides = window.__PROTOTYPE_BOARD_OVERRIDES__ || {};
  let selecting = false;
  let highlighted = null;

  function selectorFor(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement) {
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const parent = current.parentElement;
      const tag = current.tagName.toLowerCase();
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
      current = parent;
    }
    return parts.join(' > ');
  }

  function apply(path, text) {
    const element = document.querySelector(path);
    if (element && element.textContent !== text) element.textContent = text;
  }

  function applyAll() {
    for (const [path, text] of Object.entries(overrides)) apply(path, text);
  }

  function stopSelecting() {
    selecting = false;
    if (highlighted) highlighted.style.outline = '';
    highlighted = null;
    document.body.style.cursor = '';
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    if (event.data?.type === 'prototype-board:select') {
      selecting = event.data.enabled;
      if (!selecting) stopSelecting();
      else document.body.style.cursor = 'crosshair';
    }
    if (event.data?.type === 'prototype-board:set-text') {
      overrides[event.data.path] = event.data.text;
      apply(event.data.path, event.data.text);
    }
  });

  document.addEventListener('pointermove', (event) => {
    if (!selecting) return;
    if (highlighted) highlighted.style.outline = '';
    highlighted = event.target;
    highlighted.style.outline = '2px solid #315ee7';
  }, true);

  document.addEventListener('click', (event) => {
    if (!selecting) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.target;
    stopSelecting();
    parent.postMessage({ type: 'prototype-board:selected', path: selectorFor(element), text: element.textContent }, '*');
  }, true);

  const observer = new MutationObserver(applyAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  applyAll();
})();
