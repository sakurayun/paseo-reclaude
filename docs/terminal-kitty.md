# Kitty protocols, GPU, and Kittens

Paseo’s terminal is **xterm.js + WebGL**, driven by a daemon PTY (or SSH shell)
byte stream. It is **not** the Kitty binary. That means:

- Escape-code protocols that travel over a TTY stream can be implemented.
- Anything that needs Kitty’s process model, remote-control socket, or Python
  kitten runtime **cannot** be ported 1:1.

Local workspace terminals and SSH terminals share the **same** emulator runtime
(`TerminalEmulatorRuntime`), so GPU rendering and protocol handlers apply to
both.

## GPU acceleration

| Path                 | Renderer                                     |
| -------------------- | -------------------------------------------- |
| Web / Electron       | `@xterm/addon-webgl` (`customGlyphs: true`)  |
| Native (iOS/Android) | Same WebGL stack inside the terminal WebView |

Behavior:

- Images (Sixel / IIP / Kitty graphics) only mount on the WebGL path.
- Context loss triggers dispose + exponential retry (up to 6 attempts).
- `onGpuRendererChange({ enabled })` reports GPU availability to the pane.

There is no separate “SSH GPU mode”: SSH bytes are rendered by the same client
WebGL surface as local shells.

## Kitty protocol support matrix

| Protocol                                       | Status            | Notes                                                                                                                                                                  |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Graphics** (APC `G`)                         | Supported         | Via `@xterm/addon-image` (`kittySupport: true`). Direct transmission (`t=d`) only; no file/shm mediums. Animations limited by addon.                                   |
| **Keyboard progressive enhancement** (CSI `u`) | Supported         | Mode push/pop/query + modified key encoding (`packages/protocol` input mode + key input).                                                                              |
| **Desktop notifications** OSC `99`             | Supported         | Client parses/chunk-accumulates; shows OS notification on web/desktop. Query `p=?` answered. Click → `a=report` inject + optional focus; dismiss → `c=1` close report. |
| **Legacy notifications** OSC `9`               | Supported         | Single-line text notifications.                                                                                                                                        |
| **Progress** OSC `9;4`                         | Supported         | ConEmu-style progress bar overlaid on the terminal pane.                                                                                                               |
| **Working directory** OSC `7`                  | Supported         | Updates file-link resolution root (`file://` / `kitty-shell-cwd://` / plain paths).                                                                                    |
| **Pointer shape** OSC `22`                     | Supported         | CSS cursor whitelist.                                                                                                                                                  |
| **Clipboard** OSC `52`                         | Supported         | `@xterm/addon-clipboard` + system clipboard bridge.                                                                                                                    |
| **Hyperlinks** OSC `8`                         | Supported         | xterm core + web-links / local-file providers.                                                                                                                         |
| **Styled underlines / undercurl**              | Supported         | xterm proposed API + WebGL.                                                                                                                                            |
| **Synchronized output** CSI `?2026`            | Supported         | xterm core.                                                                                                                                                            |
| **Sixel / iTerm2 IIP**                         | Supported         | Same image addon (not Kitty-specific).                                                                                                                                 |
| **Text sizing** OSC `66`                       | Not supported     | Needs multi-cell font layout engine Kitty has natively.                                                                                                                |
| **Multiple cursors**                           | Not supported     | Deep buffer/cursor model changes.                                                                                                                                      |
| **File transfer** DCS `@kitty-file`            | Not supported     | Full rsync-style transfer kitten; use SSH uploads / file explorer instead.                                                                                             |
| **Drag-and-drop protocol**                     | Partial           | OS drag-drop of paths works; Kitty’s TTY DnD protocol is not implemented.                                                                                              |
| **Remote control** DCS `@kitty-cmd`            | Not supported     | Kitty-only IPC control plane.                                                                                                                                          |
| **Kittens extension system**                   | **Not supported** | See below.                                                                                                                                                             |

Env advertising (local + best-effort SSH `AcceptEnv`):

- `TERM=xterm-256color` (compat)
- `TERM_PROGRAM=kitty`
- `COLORTERM=truecolor`
- DA1: `CSI ? 62;4;9;22 c` (includes SIXEL)

## Why Kittens cannot be “added”

[Kittens](https://sw.kovidgoyal.net/kitty/kittens/custom/) are **Python (or
native) plugins that run inside the Kitty process** and talk over Kitty’s
remote-control protocol (`kitten`, `@`, Unix sockets, window/tab chrome APIs,
font metrics, overlays, etc.).

Paseo is a remote-capable client:

1. The PTY lives in the daemon (or on an SSH host).
2. The UI is React + xterm.js (WebGL), often on another machine.
3. There is no Kitty binary embedding, no `@` remote control bus, and no place
   to load arbitrary kitten Python modules with window-manager privileges.

Implementing a real Kittens host would mean **rewriting Kitty**, not extending
Paseo’s terminal. What we do instead:

- Implement the **TTY escape protocols** kittens and CLI tools emit (graphics,
  notifications, progress, cwd, keyboard).
- Provide Paseo-native UX for adjacent jobs (SSH upload sidebar, file explorer,
  terminal file links, OS notifications).

If you need a specific kitten’s _effect_ (e.g. `kitten icat`, `kitten notify`),
run the CLI inside the Paseo terminal: those tools speak the protocols above.

## Implementation map

| Concern                   | Location                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| GPU + image addon         | `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`             |
| OSC 99/9/7/22 parsers     | `packages/app/src/terminal/runtime/terminal-kitty-protocols.ts`              |
| OSC 99 click/close inject | `packages/app/src/terminal/runtime/terminal-desktop-notification-actions.ts` |
| Click-to-preview images   | `packages/app/src/terminal/runtime/terminal-image-preview.ts`                |
| Progress bar UI           | `packages/app/src/components/terminal-pane.tsx`                              |
| OS notification bridge    | `packages/app/src/utils/os-notifications.ts` + desktop `notifications.ts`    |
| Keyboard mode tracking    | `packages/protocol/src/terminal-input-mode.ts`                               |
| Key encoding              | `packages/protocol/src/terminal-key-input.ts`                                |
| Local env                 | `packages/server/src/terminal/terminal.ts` (`buildTerminalEnvironment`)      |
| SSH env hints             | `packages/server/src/ssh/ssh-connect-service.ts`                             |

After changing runtime code used by native:

```bash
npm run build:terminal-webview --workspace @getpaseo/app
```

## Quick manual checks

```bash
# Kitty graphics (needs live session + WebGL)
kitty +kitten icat ./photo.png

# Desktop notification (web/desktop client)
printf '\033]99;;Hello from Paseo\007'

# Notification with click report + focus + close report
printf '\033]99;i=job:a=report,focus:c=1:p=title;Build done\007'
printf '\033]99;i=job:p=body;All green\007'
# Click → PTY receives OSC 99 activation: ESC ] 99 ; i=job ST
# Dismiss → PTY receives OSC 99 close:     ESC ] 99 ; i=job:p=close ST

# Progress bar
printf '\033]9;4;1;40\007'   # 40%
printf '\033]9;4;0\007'      # hide

# CWD report (affects path link resolution)
printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"
```
