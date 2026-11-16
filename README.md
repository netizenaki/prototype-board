# Prototype Board

A quiet, local artboard workspace for HTML UI prototypes. Compare screens side by side, organize the canvas, add notes, and open any screen as a full-size interactive preview.

![Prototype Board showing a small mobile app prototype](docs/screenshot.png)

No framework, package installation, hosted backend, account, or design-tool integration. The complete viewer is bundled and copied by the generator, so the skill never rebuilds the canvas from scratch or spends AI credits recreating its interface. The viewer is plain HTML/CSS/JavaScript; the generator and optional editing server use only Node.js built-ins.

## Install from a custom marketplace

Prototype Board requires Node.js 20 or newer on the machine running the agent.

### Codex in the ChatGPT desktop app

Add the **Prototype Board Tools** marketplace once with the Codex CLI:

```sh
codex plugin marketplace add netizenaki/prototype-board
```

Open **Plugins** in the desktop app, select **Prototype Board Tools**, and install **Prototype Board**. Open your project and ask Codex to **open my Prototype Board**. To refresh the marketplace:

```sh
codex plugin marketplace upgrade prototype-board-tools
```

### Kimi Code

Browse the custom marketplace and select **Prototype Board**:

```text
/plugins marketplace https://raw.githubusercontent.com/netizenaki/prototype-board/main/kimi.marketplace.json
```

You can also install or update directly, then reload the session:

```text
/plugins install https://github.com/netizenaki/prototype-board
/reload
```

Kimi's repository URL selects the latest GitHub release, or the default branch if there are no releases. Create or reopen the board from your project with `/prototype-board:open`.

### Gemini CLI

Install from a terminal with Git available:

```sh
gemini extensions install https://github.com/netizenaki/prototype-board
```

To update, run `gemini extensions update prototype-board`, then start a new Gemini CLI session.

## Install as a local skill

For a local agent that supports Agent Skills, copy the entire [skills/prototype-board](skills/prototype-board) directory into the agent's skills directory. To update, replace it with the same directory from the new release. The folder contains the scripts and viewer the skill needs.

For OpenCode, put it under `~/.config/opencode/skills/prototype-board` for all projects, or `.opencode/skills/prototype-board` for one project.

Codex users who prefer a Git checkout can clone the repository into their personal skills directory:

```sh
git clone https://github.com/netizenaki/prototype-board.git "$HOME/.agents/skills/prototype-board"
```

To update a Git installation:

```sh
git -C "$HOME/.agents/skills/prototype-board" pull --ff-only
```

If you cloned the skill to another location, use that path in the update command. Restart Codex if it still shows the old skill after updating.

The board always uses `.prototype-board` in the current working directory. It starts empty, with no sample artboards. Add HTML prototypes to that folder and run the command again. Custom directory arguments are not supported.

You do not need to remember the slash command. Natural requests such as **“open my prototype board,” “make a design-review canvas,”** or **“reopen my artboard”** also trigger the skill through its description.

Run the same command again if you accidentally close the panel. It reuses the workspace's loopback server and reveals the panel with `browser.switch_tab`. Device emulation is disabled so Kimi's device toolbar does not resize or rescale the canvas.

## Rebuild existing boards after updating

From the original board's project, ask Codex to reopen your board or run `/prototype-board:open` in Kimi Code. This copies the updated viewer into `.prototype-board` and preserves the artboard HTML and saved edits. In version 1.1.0, the toolbar shows **Pause animations**.

## Manual use

From the project where you want the board, run the scripts in the installed skill directory. In a repository checkout, that directory is `skills/prototype-board`.

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

For a release, set the same version in `plugin.json`, `kimi.plugin.json`, `gemini-extension.json`, and `package.json`. Run the tests, push the versioned commit, and publish a GitHub release with a matching tag such as `v1.1.0`. Codex refreshes the marketplace from Git. Kimi and Gemini can pick up published releases.

Tests cover metadata parsing, layout preservation, grid fallback, empty workspaces, path validation, safe serialization, repeatable generation, unchanged sources, edit persistence, server recovery, fixed-workspace commands, and plugin metadata. Browser checks should exercise both direct `file://` viewing and the loopback editing workflow.

## License

MIT
