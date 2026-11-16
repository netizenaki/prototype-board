---
name: prototype-board
description: Create a local artboard canvas for HTML prototypes in the current project. Use for requests mentioning "prototype board", "artboard", "HTML prototypes", "UI screens", "design review", "demo canvas", or "preview designs", including opening, reopening, organizing, renaming, annotating, deleting, or editing a board. Supports browsing, comparing, searching, panning, zooming, moving artboards, notes, and text overrides without changing source designs.
---

# Prototype Board

Create an unbounded local canvas in the current project's `.prototype-board` folder. The complete, tested canvas is bundled in `viewer/` and copied by `scripts/build.mjs`; always reuse it rather than rebuilding or redesigning the canvas from scratch. This keeps behavior consistent and avoids spending model credits on regenerating the viewer. Never constrain the canvas to the boards' bounding box or clamp panning; content bounds are only for the Fit command. Disable text selection on the canvas with `user-select: none` so dragging cannot highlight board labels, but preserve normal selection in inputs and interactive previews. Use plain HTML/CSS/JavaScript and Node built-ins without adding dependencies.

## Generate

1. Resolve this skill's directory. In Kimi Code it is available as `${KIMI_SKILL_DIR}`; otherwise use the directory containing this `SKILL.md`.
2. Always use `.prototype-board` in the current working directory. Do not accept, ask for, or substitute another directory. Create the workspace with no sample artboards when it does not exist.
3. Run from the current project:

   ```sh
   node <skill-directory>/scripts/build.mjs
   ```

4. Open `.prototype-board/index.html` directly for read-only viewing, or use the loopback server below for editing.

The generator writes only `index.html`, `prototype-board.css`, `prototype-board.js`, and `prototype-board-data.js` inside `.prototype-board`. Add HTML prototypes to that folder and rerun the generator. It also supports an optional `canvas.json` there for page names, board titles, dimensions, and positions.

## Naming artboards

When creating an artboard, always give it a concise, unique, descriptive name reflecting its flow and state, such as `Checkout · Empty cart` or `Settings · Permission blocked`. Use a descriptive lowercase HTML filename and set the matching `title` in `canvas.json`. Never leave a new board unnamed or use generic names such as `Screen 1`. Users can rename boards by double-clicking their labels or using Rename in the preview. Click the project name in the toolbar to rename the project.

## Kimi Code panel

To open or reopen the board in Kimi Desktop's built-in browser:

1. Run `node <skill-directory>/scripts/serve.mjs` from the current project as a background task. It prints an `http://127.0.0.1` URL with a stable port for `.prototype-board`. If the command exits because the port is already in use, reuse the printed URL.
2. Open the URL with `browser.create_tab`. If a board tab already exists, activate or navigate it instead of creating duplicates.
3. Call `tab.set_device_mode` with `device: { "enabled": false }`. The device toolbar and device emulation must remain off unless the user explicitly requests them; they can alter the viewport and make the canvas appear incorrectly scaled.
4. Call `browser.switch_tab` to reveal the panel. If the user accidentally closes it, `/prototype-board:open` repeats this workflow and reopens it.

Never claim the panel is visible without calling `browser.switch_tab`. Do not enable a device preset for ordinary board viewing.

## Review and edit

Use the page picker and search to narrow the boards. Click a board for its full-size interactive preview. Check requested flows and viewport sizes; do not judge a design only from scaled thumbnails.

Always start in **View mode** to prevent accidental changes. Only enable editing after the user clicks **Edit** in the toolbar. In Edit mode, users can drag board labels to move them, rename boards and the project, add notes, remove boards without deleting source HTML, and select text in the preview to change it. **Done** returns to View mode. Renames use a confirmation prompt, deletion requires confirmation, and text overrides require confirmation before saving. Never move or modify boards in View mode.

Edits persist in `.prototype-board/prototype-board-edits.json`; source HTML and `canvas.json` remain unchanged. Text overrides appear immediately in previews and thumbnails and are reapplied whenever the prototype loads. Direct `file://` viewing is read-only.

**Copy for Kimi** copies a structured text-edit request containing the board, file, element selector, current text, and requested replacement or instruction. When the user pastes such a request, apply it as a text override through the running server's `POST /__prototype-board/edit` endpoint with action `text`, fields `file`, `path`, and `text`. If the server is unavailable, update the `text` section of `prototype-board-edits.json` directly and regenerate. Do not claim an AI edit is applied until the override is saved.

Only open prototypes you trust. Prototype scripts run inside sandboxed iframes, but they can still make network requests or consume local resources.
