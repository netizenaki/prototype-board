# Prototype Board

A local canvas for reviewing HTML prototypes side by side. Pan, zoom, and open any artboard for an interactive preview. Add notes and text overrides while keeping the source HTML intact.

![Prototype Board with mobile artboards arranged on a canvas](docs/screenshot.png)

[⬇️ Install](#-install) · [🎨 Use the board](#-use-the-board) · [🏷️ Releases](https://github.com/netizenaki/prototype-board/releases)

## 📦 Install

Requires **Node.js 20+**. Expand the instructions for your agent.

<details>
<summary><strong>Codex · Custom marketplace</strong></summary>

Register the marketplace from a terminal:

```sh
codex plugin marketplace add netizenaki/prototype-board
```

- **ChatGPT desktop app:** Open **Plugins → Prototype Board Tools → Prototype Board** and select **Install**. If the marketplace is missing, restart the app.
- **Codex CLI:** Run `codex plugin add prototype-board@prototype-board-tools`.

**Update:** Run `codex plugin marketplace upgrade prototype-board-tools`. If you installed from a Git clone, run `git pull --ff-only` in that clone.

</details>

<details>
<summary><strong>Kimi Code · Custom marketplace</strong></summary>

1. Open the custom marketplace:

   ```text
   /plugins marketplace https://raw.githubusercontent.com/netizenaki/prototype-board/main/kimi.marketplace.json
   ```

2. Select **Prototype Board** and press **Enter** to install it.
3. Run `/reload` to load the plugin in your session.

For a direct install or update, run:

```text
/plugins install https://github.com/netizenaki/prototype-board
/reload
```

Open or reopen a board from its project with `/prototype-board:open`.

</details>

<details>
<summary><strong>Gemini CLI · Extension</strong></summary>

Install from your terminal:

```sh
gemini extensions install https://github.com/netizenaki/prototype-board
```

Start a new Gemini CLI session to load the extension.

**Update:** Run `gemini extensions update prototype-board`, then start a new session.

</details>

<details>
<summary><strong>OpenCode and other Agent Skills hosts · Local skill</strong></summary>

1. Copy the entire [`skills/prototype-board`](skills/prototype-board) folder into your agent's skills directory. For OpenCode, use `~/.config/opencode/skills/` for all projects or `.opencode/skills/` for one project.
2. Open your project in the agent and ask it to open Prototype Board.

**Update:** Replace the installed skill folder with the copy from the latest [release](https://github.com/netizenaki/prototype-board/releases/latest).

</details>

## 🎨 Use the board

1. From your project, ask your agent to **“Open my Prototype Board.”**
2. Add trusted HTML prototypes to the project's `.prototype-board/` folder and ask the agent to reopen the board.
3. Use **Play on canvas** or **Preview full screen** in an artboard's header. Double-click its name to rename it inline. Inactive or paused artboards show a still if Chrome, Chromium, or Edge is installed. Use **Edit** to organize artboards, add notes, or save text overrides.
4. In **Edit** mode, choose **+ New page** from the page picker. Use **⋯** beside it to rename or delete the selected page, and **Move to page** in the preview to relocate an artboard.

Use **Undo** and **Redo** in Edit mode. The running board server keeps the last 50 edits. Saved changes survive a server restart.

After updating the skill, ask your agent to reopen the board from its project. This refreshes the viewer and updates the local server at the same URL. Saved edits and source HTML are preserved. If the server predates automatic updates and is still running, stop it once and reopen the board.

<details>
<summary><strong>Shortcuts and layout</strong></summary>

| Action | Shortcut |
| --- | --- |
| Pan | Drag empty canvas or scroll |
| Zoom | Ctrl + scroll |
| Fit all boards | F |
| Search | Ctrl / Cmd + K |
| Undo / redo in Edit mode | Ctrl / Cmd + Z, or Ctrl / Cmd + Shift + Z |
| Switch or close previews | ← / → or Esc |

Boards are arranged in a grid by default. For custom page names, artboard dimensions, and positions, see [`example/canvas.json`](example/canvas.json).

</details>

<details>
<summary><strong>Run without an agent</strong></summary>

From the project you want to open, run the server command. Replace `/path/to/prototype-board-skill` with the path to the installed skill folder. In this repository, the skill folder is `skills/prototype-board`.

```sh
node "/path/to/prototype-board-skill/scripts/serve.mjs"
```

Open the printed HTTP URL for editing. To generate a read-only copy, run `scripts/build.mjs` from the installed skill and open `.prototype-board/index.html` directly.

</details>

[MIT License](LICENSE)
