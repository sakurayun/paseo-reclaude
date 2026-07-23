# Terminal image protocols

Paseo terminals (local workspace shells **and** SSH shells) can render inline
images and open a full-resolution preview on click.

## Supported protocols (in-terminal output)

Client rendering uses `@xterm/addon-image` on the WebGL path
(`packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`):

| Protocol                               | Sequence family     | Notes                                          |
| -------------------------------------- | ------------------- | ---------------------------------------------- |
| **Sixel**                              | DCS `q`             | DA1 advertises feature bit `4` from the daemon |
| **iTerm2 Inline Image Protocol (IIP)** | OSC `1337 ; File=…` | Base64 payloads; `inline=1`                    |
| **Kitty graphics**                     | APC `G`             | Local shells set `TERM_PROGRAM=kitty`          |

Capability advertising:

- **Daemon DA1** (`packages/server/src/terminal/terminal.ts`):
  `CSI ? 62 ; 4 ; 9 ; 22 c` (VT220 + SIXEL + charsets + ANSI color).
- **Local env**: `TERM=xterm-256color`, `TERM_PROGRAM=kitty`.
- **SSH shell env**: also requests `TERM_PROGRAM=kitty` when the remote
  `AcceptEnv` allows it. Image bytes still stream through either way.

Raw PTY/SSH bytes are forwarded to the client unchanged (binary frames). The
headless xterm on the server only builds text snapshots — live image display
depends on the client receiving the original escape sequences while the
session is open.

## Click-to-preview

Clicking a cell that holds an image tile opens a DOM lightbox (zoom-in cursor
on hover, Esc / backdrop / × to close). Implemented in:

- `packages/app/src/terminal/runtime/terminal-image-preview.ts`
- Wired from `TerminalEmulatorRuntime` click handlers (shared by web + native
  webview + SSH panes — same emulator runtime).

Scrollback clicks work (unlike shell cursor repositioning, which only applies
to the current prompt line). Mouse-tracking apps (`mouseTrackingMode !== "none"`)
keep their own mouse events; we do not steal those clicks.

## Limits / gotchas

- **WebGL required.** ImageAddon is loaded with the WebGL renderer. If WebGL
  fails to mount, images will not render (DOM fallback is not implemented).
- **Snapshots lose images.** `subscribe_terminal` restore/snapshot is a cell
  grid of characters/attributes only. Reconnecting clients will not rehydrate
  previously rendered images unless the remote program re-emits them.
- **Rebuild native webview after runtime changes:**
  `npm run build:terminal-webview --workspace @getpaseo/app`
- **Tools:** `img2sixel`, `chafa -f sixel`, kitty `icat`, iTerm `imgcat` (or any
  OSC 1337 emitter) should work against a live Paseo terminal session.
