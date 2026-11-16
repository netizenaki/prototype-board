---
description: Generate and open the project's local prototype artboard
---

Use the `prototype-board` skill to generate and open the board. Always use `.prototype-board` in the current working directory. Create it if needed and open an empty canvas with no sample artboards. This folder is the user's workspace for future HTML prototypes; do not populate it with the bundled example. Do not accept or ask for another directory.

This command is also the way to reopen the board after its browser panel is closed. Reuse the existing local server when its stable port is already active. Always show the panel with `browser.switch_tab`, and disable device emulation with `tab.set_device_mode` so the device toolbar is off. Preserve every prototype source file.
