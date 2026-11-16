# Prototype Board

A quiet, local artboard workspace for HTML UI prototypes. Compare screens side by side, organize the canvas, add notes, and open any screen as a full-size interactive preview.

![Prototype Board showing a small mobile app prototype](docs/screenshot.png)

No framework, package installation, hosted backend, account, or design-tool integration. The complete viewer is bundled and copied by the generator, so the skill never rebuilds the canvas from scratch or spends AI credits recreating its interface. The viewer is plain HTML/CSS/JavaScript; the generator and optional editing server use only Node.js built-ins.

## Kimi Code: one-command installation

```text
/plugins install https://github.com/netizenaki/prototype-board
```

Create or reopen the board in the current project:

```text
/prototype-board:open
```

The board always uses `.prototype-board` in the current working directory. It starts empty, with no sample artboards. Add HTML prototypes to that folder and run the command again. Custom directory arguments are not supported.

You do not need to remember the slash command. Natural requests such as **“open my prototype board,” “make a design-review canvas,”** or **“reopen my artboard”** also trigger the skill through its description.

Run the same command again if you accidentally close the panel. It reuses the workspace's loopback server and reveals the panel with `browser.switch_tab`. Device emulation is disabled so Kimi's device toolbar does not resize or rescale the canvas.

The repository root is both the skill and the Kimi plugin; no separate release bundle is needed.

## Other agents and manual use

Copy the repository into your agent's skill directory. From the project where you want the board, run with Node 20 or newer:

```sh
node <skill-directory>/scripts/build.mjs
```

Start or reuse the loopback server from the same project, then open the printed HTTP URL. Codex opens that URL in its in-app browser. To view the board read-only, open `.prototype-board/index.html` directly.

```sh
node <skill-directory>/scripts/serve.mjs
```

## Workspace files

The `.prototype-board` folder can include an optional `canvas.json` to preserve page names, board titles, dimensions, and positions:

```json
{
  "title": "My product",
  "pages": [{ "id": "flow", "name": "Core flow" }],
  "boards": {
    "welcome.html": {
      "title": "Welcome",
      "x": 0,
      "y": 0,
      "w": 390,
      "h": 844,
      "page": "flow"
    }
  }
}
```

Without `canvas.json`, every root-level `.html` file except generated viewer files is arranged in an automatic grid.

Generation is repeatable and writes only:

- `index.html`
- `prototype-board.css`
- `prototype-board.js`
- `prototype-board-data.js`

Prototype HTML, `canvas.json`, and supporting assets are never modified. Rerun the generator after adding or changing prototypes.

## Navigate and organize

- **View mode** is the safe default. Click **Edit** to enable organization and editing controls; click **Done** to return to View mode.
- Drag or scroll to pan without canvas edges or coordinate limits; **Ctrl + scroll** to zoom.
- In Edit mode, drag an artboard's label to move it. Double-click the label to rename it.
- In Edit mode, click the project name in the compact toolbar to rename the project.
- **Fit** uses the current boards' bounds, but those bounds never limit canvas movement.
- **F** fits the current boards; **0** restores 100% zoom.
- **Ctrl/Cmd + K** focuses search.
- Click a board for an interactive preview; use **← / →** to move between boards and **Esc** to close.
- **?** opens keyboard help. Touch dragging and narrow screens are supported.

The canvas uses lightweight placeholders. Only the selected preview runs live. **Pause animations** replaces it with a placeholder and remembers your choice in the browser. The default follows your system's reduced-motion preference. Resuming opens a fresh preview.

## Notes, deletion, and text edits

Open an artboard's preview to:

- Add a persistent design note.
- Rename the board or remove it from the canvas after confirmation. Deletion never removes its source HTML.
- Choose **Edit text**, click an element in the prototype, edit its text, and confirm the override.
- Choose **Copy for Kimi** to copy the selected element and requested change as a structured AI prompt. Paste it into Kimi to apply the override through the skill.

Edits require the loopback server and are stored separately in `prototype-board-edits.json`. Text overrides are reapplied when prototypes load; source HTML stays unchanged. Direct `file://` viewing remains read-only.

## Security

Only open prototypes you trust. Prototypes run in sandboxed iframes, but their scripts can still make network requests and consume local resources. The viewer does not send board metadata to an external service. The editing server binds to loopback and accepts JSON mutations only.

## Development

```sh
npm test
```

Tests cover metadata parsing, layout preservation, grid fallback, empty workspaces, path validation, safe serialization, repeatable generation, unchanged sources, edit persistence, server recovery, fixed-workspace commands, and plugin metadata. Browser checks should exercise both direct `file://` viewing and the loopback editing workflow.

## License

MIT
