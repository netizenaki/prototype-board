# Prototype Board

A local canvas for reviewing HTML prototypes side by side. Pan, zoom, and open any artboard for an interactive preview. Add notes and text overrides while keeping the source HTML intact.

![Prototype Board with mobile artboards arranged on a canvas](docs/screenshot.png)

[⬇️ Install](#-install) · [🎨 Use the board](#-use-the-board) · [🏷️ Releases](https://github.com/netizenaki/prototype-board/releases)

## 📦 Install

Requires **Node.js 20+**. Expand the instructions for your agent.

<details>
<summary><strong>Codex · Custom marketplace</strong></summary>

```sh
codex plugin marketplace add netizenaki/prototype-board
```

In the ChatGPT desktop app, open **Plugins → Prototype Board Tools → Prototype Board** and install it.

**Update:** Run `codex plugin marketplace upgrade prototype-board-tools`. If you installed from a Git clone, run `git pull --ff-only` in that clone.

</details>

<details>
<summary><strong>Kimi Code · Custom marketplace</strong></summary>

```text
/plugins marketplace https://raw.githubusercontent.com/netizenaki/prototype-board/main/kimi.marketplace.json
```

Select **Prototype Board**, then run `/reload`. To install or update directly:

```text
/plugins install https://github.com/netizenaki/prototype-board
/reload
```

</details>

<details>
<summary><strong>Gemini CLI · Extension</strong></summary>

```sh
gemini extensions install https://github.com/netizenaki/prototype-board
```

**Update:** Run `gemini extensions update prototype-board`, then start a new session.

</details>

<details>
<summary><strong>OpenCode and other Agent Skills hosts · Local skill</strong></summary>

Copy the entire [`skills/prototype-board`](skills/prototype-board) folder into your agent's skills directory. For OpenCode, use `~/.config/opencode/skills/` for all projects or `.opencode/skills/` for one project.

**Update:** Replace the installed skill folder with the copy from the latest [release](https://github.com/netizenaki/prototype-board/releases/latest).

</details>

## 🎨 Use the board

1. From your project, ask your agent to **“Open my Prototype Board.”** In Kimi Code, you can also run `/prototype-board:open`.
2. Add trusted HTML prototypes to the project's `.prototype-board/` folder and ask the agent to reopen the board.
3. Click an artboard to preview it. Use **Edit** to move or rename boards, add notes, or save text overrides. Use **Pause animations** to stop the live preview.

After updating the skill, reopen the board from its project to rebuild the viewer. Saved edits and source HTML are preserved.

<details>
<summary><strong>Shortcuts and layout</strong></summary>

| Action | Shortcut |
| --- | --- |
| Pan | Drag empty canvas or scroll |
| Zoom | Ctrl + scroll |
| Fit all boards | F |
| Search | Ctrl / Cmd + K |
| Switch or close previews | ← / → or Esc |

Boards are arranged in a grid by default. For custom page names, artboard dimensions, and positions, see [`example/canvas.json`](example/canvas.json).

</details>

<details>
<summary><strong>Run without an agent</strong></summary>

From the project you want to open, run both commands. Replace `/path/to/prototype-board-skill` with the path to the installed skill folder. In this repository, the skill folder is `skills/prototype-board`.

```sh
node "/path/to/prototype-board-skill/scripts/build.mjs"
node "/path/to/prototype-board-skill/scripts/serve.mjs"
```

Open the printed HTTP URL for editing. For read-only viewing, open `.prototype-board/index.html` directly.

</details>

<details>
<summary><strong>Development and releases</strong></summary>

Run `npm test`. To publish a release, match the versions in `plugin.json`, `kimi.plugin.json`, `gemini-extension.json`, and `package.json`, then publish the tested commit with a matching GitHub tag such as `v1.1.0`.

</details>

[MIT License](LICENSE)
