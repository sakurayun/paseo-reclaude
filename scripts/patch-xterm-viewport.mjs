// Guards @xterm/xterm's Viewport against "Cannot read properties of undefined
// (reading 'dimensions')": RenderService.dimensions dereferences the renderer
// with a non-null assertion, but a refresh callback queued via
// Viewport.queueSync can still fire after the renderer was disposed (e.g. the
// terminal is torn down inside a render callback), crashing the app. Upstream
// is unfixed as of 6.1.0-beta.288, so we rewrite the minified lib bundles to
// skip the sync when RenderService.hasRenderer() is false. The bundles are
// single-line minified files, so patch-package diffs would weigh megabytes —
// hence this literal-replacement codemod instead of a patches/*.patch file.
//
// Idempotent: already-patched files are skipped. Hard-fails when a snippet is
// neither in its original nor patched form, so an @xterm/xterm bump that
// changes the minified output surfaces here instead of silently unpatching.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const XTERM_LIB_DIR = "packages/app/node_modules/@xterm/xterm/lib";

// ESM bundle (lib/xterm.mjs).
const MJS_EDITS = [
  [
    "_sync(e=this._bufferService.buffer.ydisp){if(!(!this._renderService||this._isSyncing)){",
    "_sync(e=this._bufferService.buffer.ydisp){if(!(!this._renderService||!this._renderService.hasRenderer()||this._isSyncing)){",
  ],
  [
    "scrollLines(e){let i=this._scrollableElement.getScrollPosition();",
    "scrollLines(e){if(!this._renderService.hasRenderer())return;let i=this._scrollableElement.getScrollPosition();",
  ],
  [
    "scrollToLine(e,i){i&&(this._latestYDisp=e),this._scrollableElement.setScrollPosition({reuseAnimation:!i,scrollTop:e*this._renderService.dimensions.css.cell.height})}",
    "scrollToLine(e,i){i&&(this._latestYDisp=e),this._renderService.hasRenderer()&&this._scrollableElement.setScrollPosition({reuseAnimation:!i,scrollTop:e*this._renderService.dimensions.css.cell.height})}",
  ],
  [
    "_handleScroll(e){if(!this._renderService||this._isHandlingScroll||this._suppressOnScrollHandler)return;",
    "_handleScroll(e){if(!this._renderService||!this._renderService.hasRenderer()||this._isHandlingScroll||this._suppressOnScrollHandler)return;",
  ],
];

// UMD bundle (lib/xterm.js) — same edits, different minified identifiers.
const JS_EDITS = [
  [
    "_sync(e=this._bufferService.buffer.ydisp){this._renderService&&!this._isSyncing&&(",
    "_sync(e=this._bufferService.buffer.ydisp){this._renderService&&this._renderService.hasRenderer()&&!this._isSyncing&&(",
  ],
  [
    "scrollLines(e){const t=this._scrollableElement.getScrollPosition();",
    "scrollLines(e){if(!this._renderService.hasRenderer())return;const t=this._scrollableElement.getScrollPosition();",
  ],
  [
    "scrollToLine(e,t){t&&(this._latestYDisp=e),this._scrollableElement.setScrollPosition({reuseAnimation:!t,scrollTop:e*this._renderService.dimensions.css.cell.height})}",
    "scrollToLine(e,t){t&&(this._latestYDisp=e),this._renderService.hasRenderer()&&this._scrollableElement.setScrollPosition({reuseAnimation:!t,scrollTop:e*this._renderService.dimensions.css.cell.height})}",
  ],
  [
    "_handleScroll(e){if(!this._renderService)return;if(this._isHandlingScroll||this._suppressOnScrollHandler)return;",
    "_handleScroll(e){if(!this._renderService||!this._renderService.hasRenderer())return;if(this._isHandlingScroll||this._suppressOnScrollHandler)return;",
  ],
];

function patchFile(filePath, edits) {
  let source = readFileSync(filePath, "utf8");
  let applied = 0;
  let alreadyPatched = 0;
  for (const [original, patched] of edits) {
    if (source.includes(patched)) {
      alreadyPatched += 1;
      continue;
    }
    const parts = source.split(original);
    if (parts.length !== 2) {
      throw new Error(
        `${filePath}: expected exactly one occurrence of a Viewport snippet but found ${parts.length - 1}. ` +
          `The @xterm/xterm build output changed — update scripts/patch-xterm-viewport.mjs. ` +
          `Snippet: ${original.slice(0, 100)}...`,
      );
    }
    source = parts.join(patched);
    applied += 1;
  }
  if (applied > 0) {
    writeFileSync(filePath, source);
  }
  console.log(
    `patch-xterm-viewport: ${filePath} — ${applied} applied, ${alreadyPatched} already patched`,
  );
}

// CI often installs a single workspace (e.g. server/relay/website) where the
// app's @xterm/xterm is absent; that's fine, there is nothing to patch.
if (!existsSync(XTERM_LIB_DIR)) {
  process.exit(0);
}

patchFile(join(XTERM_LIB_DIR, "xterm.mjs"), MJS_EDITS);
patchFile(join(XTERM_LIB_DIR, "xterm.js"), JS_EDITS);
