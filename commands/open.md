---
description: Generate and open the project's local prototype artboard
---

Use the `prototype-board` skill to generate and open the board. Always use `.prototype-board` in the current working directory. Create it if needed and open an empty canvas with no sample artboards. This folder is the user's workspace for future HTML prototypes; do not populate it with the bundled example. Do not accept or ask for another directory.

This command is also the way to reopen the board after its browser panel is closed. Start or reuse the workspace's loopback server and open its printed HTTP URL using the skill's instructions for the current host. In Kimi, show the panel with `browser.switch_tab` and disable device emulation with `tab.set_device_mode`. Preserve existing prototype source files and saved edits.
