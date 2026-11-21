---
name: prototype-board
description: Create a local artboard canvas for HTML prototypes in the current project. Use for requests mentioning "prototype board", "artboard", "HTML prototypes", "UI screens", "design review", "demo canvas", or "preview designs", including opening, reopening, organizing, renaming, annotating, deleting, or editing a board. Supports browsing, comparing, searching, panning, zooming, moving artboards, notes, and text overrides without changing source designs.
---

# Prototype Board

Create an unbounded local canvas in the current project's `.prototype-board` folder. The complete, tested canvas is bundled in `viewer/` and copied by `scripts/build.mjs`; always reuse it rather than rebuilding or redesigning the canvas from scratch. This keeps behavior consistent and avoids spending model credits on regenerating the viewer. Never constrain the canvas to the boards' bounding box or clamp panning; content bounds are only for the Fit command. Disable text selection on the canvas with `user-select: none` so dragging cannot highlight board labels, but preserve normal selection in inputs and interactive previews. Use plain HTML/CSS/JavaScript and Node built-ins without adding dependencies.

## Generate

1. Resolve this skill's directory. In Kimi Code it is available as `${KIMI_SKILL_DIR}`; otherwise use the directory containing this `SKILL.md`.
2. Always use `.prototype-board` in the current working directory. Do not accept, ask for, or substitute another directory. Create the workspace with no sample artboards when it does not exist.
3. To generate files for direct read-only viewing, run from the current project:

   ```sh
   node <skill-directory>/scripts/build.mjs
   ```

4. For any request to open or reopen the board, run `node <skill-directory>/scripts/serve.mjs` from the current project as a background task. It rebuilds the viewer with the installed skill, starts or updates the workspace's server, and prints the HTTP URL. Reload the tab if it is already open. If an older server cannot be identified, stop the previous board server task only if you can verify it belongs to this project, then rerun the command.

The generator writes only `index.html`, `prototype-board.css`, `prototype-board.js`, and `prototype-board-data.js` inside `.prototype-board`. Add HTML prototypes to that folder and rerun the generator. It also supports an optional `canvas.json` there for page names, board titles, dimensions, and positions.

## Naming artboards

The initial page uses the placeholder name `unnamed`. When creating prototypes from a user's prompt, rename that page to a concise name reflecting the requested app, flow, or grouping. Use an explicit page name from the user when provided. Rename the existing placeholder page instead of leaving it empty and creating another page. Preserve existing descriptive page names unless the user requests a rename.

When creating an artboard, always give it a concise, unique, descriptive name reflecting its flow and state, such as `Checkout · Empty cart` or `Settings · Permission blocked`. Use a descriptive lowercase HTML filename and set the matching `title` in `canvas.json`. Never leave a new board unnamed or use generic names such as `Screen 1`. Users can double-click an artboard's name to rename it inline on HTTP boards. Press Enter or click away to save, or Escape to cancel. Click the project name in the toolbar to rename the project.

## Open or reopen in Codex

1. Run the server command in step 4 above from the current project.
2. Open the HTTP URL in Codex's in-app browser. Reuse and reload an existing tab for that board, or open a visible tab (with the computer-use browser API, use `cua.createBrowserTab("iab", url, { visible: true })`). If the in-app browser is unavailable, open the HTTP URL in the system browser.
3. Verify the board opens in View mode with Edit available.

## Kimi Code panel

To open or reopen the board in Kimi Desktop's built-in browser:

1. Run the server command in step 4 above from the current project.
2. Open the URL with `browser.create_tab`. If a board tab already exists, reload or navigate it to the printed URL.
3. Call `tab.set_device_mode` with `device: { "enabled": false }`. The device toolbar and device emulation must remain off unless the user explicitly requests them; they can alter the viewport and make the canvas appear incorrectly scaled.
4. Call `browser.switch_tab` to reveal the panel. If the user accidentally closes it, `/prototype-board:open` repeats this workflow and reopens it.

Never claim the panel is visible without calling `browser.switch_tab`. Do not enable a device preset for ordinary board viewing.

## Other local agents

Run the server command in step 4 above from the current project. Open or reload the printed HTTP URL using the host's browser controls, or show it to the user. Start in View mode.

## Review and edit

The canvas displays one page at a time. New workspaces start with `unnamed`. Use the page picker to switch pages and search within the selected page. The browser remembers the active page across reloads, falling back to the first available page if it was deleted. Use Play on canvas in an artboard's header to run its preview in place, or Preview full screen to open the larger interactive view. In Edit mode, use the header's Delete button to remove an artboard from the canvas.

Full-screen previews preserve the artboard's original viewport and scale down to fit the available width. Tall previews scroll vertically. Play and Pause use the same display size.

Visible artboards load static previews at every zoom level, including overview. Load a small still first, then upgrade as visible artboards grow with zoom or screen pixel density. Switching pages cancels abandoned thumbnail requests and their active captures. A capture shared by another open viewer continues while that viewer needs it. Keep the original prototype viewport during capture, including artboards taller than 8192 pixels, so stills preserve the layout and aspect ratio. Captured images are bounded to 4096 pixels on the longest edge.

In Edit mode, choose + New page from the page picker. Open the Page options menu beside it to rename or delete the selected page. Use Move to page in the preview to relocate an artboard. When deleting a page, select a destination for its artboards. Keep at least one page.

Undo and Redo in Edit mode apply to saved board edits. The last 50 edits are available while the board server runs, including after a browser reload. The history resets when the server restarts.

Always start in **View mode** to prevent accidental changes. Inline artboard renaming is available in View mode. Use **Edit** to drag artboards, rename the project, add notes, remove artboards, or select preview text to change it. **Done** returns to View mode. Deletion and text overrides require confirmation.

Edits persist in `.prototype-board/prototype-board-edits.json`; source HTML and `canvas.json` remain unchanged. Text overrides appear immediately in the live preview and are reapplied whenever the prototype loads. Direct `file://` viewing disables Edit and explains how to open the HTTP board in its tooltip.

The local server uses installed Chrome, Chromium, or Edge to generate still thumbnails when available. The canvas displays a labeled fallback if a still is unavailable. Only one interactive preview runs at a time. Pausing, closing, or panning an inline preview out of view removes its live iframe. The pause setting follows system reduced motion until the user makes a choice, which the browser remembers.

**Copy for Kimi** copies a structured text-edit request containing the board, file, element selector, current text, and requested replacement or instruction. When the user pastes such a request, apply it as a text override through the running server's `POST /__prototype-board/edit` endpoint with action `text`, fields `file`, `path`, and `text`. If the server is unavailable, update the `text` section of `prototype-board-edits.json` directly and regenerate. Do not claim an AI edit is applied until the override is saved.

Only open prototypes you trust. Prototype scripts run inside sandboxed iframes, but they can still make network requests or consume local resources.
