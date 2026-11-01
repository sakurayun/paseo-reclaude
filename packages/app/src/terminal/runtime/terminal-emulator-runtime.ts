import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions, ISearchResultChangeEvent } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IDisposable, type ITheme, type IMarker } from "@xterm/xterm";
import {
  MONO_FALLBACK_LIGATURES,
  MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON,
} from "@/styles/mono-ligatures";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  type TerminalFontZoomDirection,
} from "./terminal-emulator-constants";
import { findTerminalLigatureRanges } from "./terminal-ligature-ranges";
import type { TerminalCharacterWidths } from "../character-widths";
import {
  type TerminalInputModeState,
  TerminalInputModeTracker,
  terminalInputModeStatesEqual,
} from "@getpaseo/protocol/terminal-input-mode";
import {
  type PendingTerminalModifiers,
  hasPendingTerminalModifiers,
  isAppleHandheldPlatform,
  isTerminalModifierDomKey,
  mergeTerminalModifiers,
  normalizeDomTerminalKey,
  normalizeTerminalTransportKey,
  resolveMacTerminalEditingShortcut,
  shouldInterceptDomTerminalKey,
} from "@/utils/terminal-keys";

export {
  DEFAULT_TERMINAL_FONT_SIZE,
  type TerminalFontZoomDirection,
} from "./terminal-emulator-constants";
import {
  buildDeleteSelectionSequence,
  buildMoveCursorToViewportCellSequence,
  createBufferCellLookup,
  createBufferLineLookup,
  isSelectionOnCursorWrappedLine,
  isViewportCellOnCursorWrappedLine,
  resolveCharacterBeforeCursor,
  resolveDeletedSelectionText,
  resolveTerminalViewportCellFromMouse,
  shouldMoveCursorOnClick,
  snapSelectionEndExclusiveToGlyph,
  snapSelectionStartToGlyph,
} from "./terminal-click-edit";
import {
  buildRedoDeleteSequence,
  isEditHistoryBreakingInput,
  resolveEditHistoryChord,
  TerminalEditHistory,
} from "./terminal-edit-history";
import {
  createTerminalLocalFileLinkProvider,
  type TerminalLocalFileLinkSource,
  type TerminalLocalFileLinkTarget,
} from "../local-links/terminal-local-link-provider";
import {
  canvasToPngDataUrl,
  getTerminalImageAtViewportCell,
  openTerminalImageLightbox,
  shouldOpenTerminalImagePreview,
  type TerminalImageLightboxHandle,
} from "./terminal-image-preview";
import {
  KittyNotificationAccumulator,
  buildKittyOsc99ActivationReport,
  buildKittyOsc99CloseReport,
  isKittyOsc99Done,
  parseKittyOsc99,
  parseOsc7,
  parseOsc9,
  parseOsc22,
  type TerminalDesktopNotification,
  type TerminalProgressState,
} from "./terminal-kitty-protocols";
import { isFindShortcut, type FindShortcutPlatform } from "@/pane-find/find-shortcut";
import { isMacUserAgent } from "@/utils/mac-user-agent";

import { imageExtension, readTerminalFile, type TerminalFile } from "../file-paste";

export type TerminalOutputData = Uint8Array;

export interface TerminalFindHandle {
  setWidgetSize(size: { width: number; height: number }): void;
  search(query: string, direction?: "next" | "previous"): void;
  clear(): void;
}

export interface TerminalFindResult {
  resultIndex: number;
  resultCount: number;
  limited: boolean;
  placement: "top" | "bottom";
}

const FIND_HIGHLIGHT_LIMIT = 20_000;

export interface TerminalEmulatorRuntimeMountInput {
  root: HTMLDivElement;
  host: HTMLDivElement;
  scrollback: number;
  theme: ITheme;
  fontFamily?: string;
  fontSize?: number;
  letterSpacing?: number;
  ligaturesEnabled?: boolean;
}

export interface TerminalEmulatorRuntimeCallbacks {
  onFindRequest?: () => void;
  onFindResult?: (result: TerminalFindResult) => void;
  onInput?: (data: string) => Promise<void> | void;
  onResize?: (input: TerminalResizeEvent) => Promise<void> | void;
  onTerminalKey?: (input: {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  }) => Promise<void> | void;
  onPendingModifiersConsumed?: () => Promise<void> | void;
  onOpenExternalUrl?: (url: string) => Promise<void> | void;
  onResolveLocalFileLink?: (
    source: TerminalLocalFileLinkSource,
  ) => Promise<TerminalLocalFileLinkTarget | null> | TerminalLocalFileLinkTarget | null;
  onOpenLocalFileLink?: (
    target: TerminalLocalFileLinkTarget,
    disposition: "main" | "side",
  ) => Promise<void> | void;
  onInputModeChange?: (state: TerminalInputModeState) => Promise<void> | void;
  onFontZoom?: (input: { direction: TerminalFontZoomDirection }) => Promise<void> | void;
  /** WebGL GPU renderer became available or fell back to canvas. */
  onGpuRendererChange?: (input: { enabled: boolean }) => Promise<void> | void;
  /** Kitty/iTerm desktop notification (OSC 99 / OSC 9). */
  onDesktopNotification?: (notification: TerminalDesktopNotification) => Promise<void> | void;
  /** ConEmu/Windows Terminal progress (OSC 9;4). */
  onProgressChange?: (progress: TerminalProgressState) => Promise<void> | void;
  /** OSC 7 working directory report. */
  onCwdReport?: (cwd: string) => Promise<void> | void;
  /** Focus the terminal surface (notification click with a=focus). */
  onRequestFocus?: () => Promise<void> | void;
  /** A paste gesture that can carry a file; resolves to null when it carried none. */
  onFilePaste?: (file: Promise<TerminalFile | null>) => void;
}

export interface TerminalResizeEvent {
  rows: number;
  cols: number;
  shouldClaim: boolean;
  forceClaim?: boolean;
}

export interface TerminalResizeRequest {
  forceRefresh?: boolean;
  shouldClaim?: boolean;
  forceClaim?: boolean;
}

export function createTerminalResizeEvent(input: {
  rows: number;
  cols: number;
  shouldClaim: boolean;
  forceClaim: boolean;
}): TerminalResizeEvent {
  return {
    rows: input.rows,
    cols: input.cols,
    shouldClaim: input.shouldClaim,
    forceClaim: input.shouldClaim && input.forceClaim,
  };
}
// Ctrl+'=' counts as zoom-in ('+' needs Shift on most layouts); Ctrl+Shift+'-'
// ('_') is deliberately NOT zoom-out — that chord is readline's undo (C-_).
function resolveFontZoomDirection(event: KeyboardEvent): TerminalFontZoomDirection | null {
  if (event.code === "NumpadAdd" || event.key === "+" || event.key === "=") {
    return "in";
  }
  if (event.code === "NumpadSubtract" || event.key === "-") {
    return "out";
  }
  if (event.code === "Numpad0" || event.key === "0") {
    return "reset";
  }
  return null;
}

export type TerminalFindResultChangeEvent = ISearchResultChangeEvent;

export interface TerminalFindQueryInput {
  query: string;
}

interface TerminalEmulatorRuntimeDisposables {
  disposeInput: () => void;
  removeClickEditListeners: () => void;
  removeImagePreviewListeners: () => void;
  removeKittyProtocolHandlers: () => void;
  disconnectResizeObserver: () => void;
  removeWheelZoomListener: () => void;
  removeWindowResize: () => void;
  removeWindowFocus: () => void;
  removeDocumentVisibilityChange: () => void;
  removeVisualViewportResize: () => void;
  clearFitTimeouts: () => void;
  removeFontListeners: () => void;
  removeTouchListeners: () => void;
  removeFilePasteListener: () => void;
  restoreDocumentStyles: () => void;
  restoreViewportStyles: () => void;
  disposeFitAddon: () => void;
  disposeWebglAddon: () => void;
  disposeTerminal: () => void;
}

interface TerminalOutputOperation {
  type: "write" | "clear" | "snapshot" | "fit";
  data: TerminalOutputData;
  rows?: number;
  cols?: number;
  suppressInput?: boolean;
  onCommitted?: () => void;
}

declare global {
  interface Window {
    __paseoTerminal?: Terminal;
  }
}

const isAppleHandheld =
  typeof navigator !== "undefined" &&
  isAppleHandheldPlatform({
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { platform?: string }).platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });

const DEFAULT_TOUCH_SCROLL_LINE_HEIGHT_PX = 18;
const FIT_TIMEOUT_DELAYS_MS = [0, 16, 48, 120, 250, 500, 1_000, 2_000];
const OUTPUT_OPERATION_TIMEOUT_MS = 5_000;
const EMPTY_TERMINAL_OUTPUT = new Uint8Array(0);
const RESET_TERMINAL_OUTPUT = new Uint8Array([0x1b, 0x63]);
const terminalOutputEncoder = new TextEncoder();

export function encodeTerminalOutput(text: string): TerminalOutputData {
  return terminalOutputEncoder.encode(text);
}

function prependTerminalOutput(
  prefix: TerminalOutputData,
  data: TerminalOutputData,
): TerminalOutputData {
  const output = new Uint8Array(prefix.length + data.length);
  output.set(prefix, 0);
  output.set(data, prefix.length);
  return output;
}

const TERMINAL_FIND_SEARCH_OPTIONS: ISearchOptions = {
  caseSensitive: false,
  decorations: {
    matchBackground: "#facc15",
    matchOverviewRuler: "#facc15",
    activeMatchBackground: "#38bdf8",
    activeMatchColorOverviewRuler: "#38bdf8",
  },
};

const DEFAULT_TERMINAL_FONT_FAMILY = [
  // Bundled with the app (registered at startup): Nerd Font glyphs + CJK.
  "'Maple Mono NF CN'",
  // Prefer common developer fonts, with Nerd Font variants for prompt/TUI glyphs.
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "MesloLGM Nerd Font",
  "MesloLGM NF",
  "Hack Nerd Font",
  "FiraCode Nerd Font",
  // PUA-only fallback (many Nerd glyphs live here on some systems).
  "Symbols Nerd Font",
  // System fallbacks.
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "'Liberation Mono'",
  "monospace",
].join(", ");

function resolveTerminalFontFamily(fontFamily: string | undefined): string {
  const trimmed = fontFamily?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TERMINAL_FONT_FAMILY;
}

function resolveTerminalFontSize(fontSize: number | undefined): number {
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_TERMINAL_FONT_SIZE;
}

// Extra inter-character spacing (px). 0 keeps the font's native metrics; small
// negatives tighten cramped Windows fonts. Anything non-finite falls back to 0
// so an unset/garbage value never collapses the grid.
function resolveTerminalLetterSpacing(letterSpacing: number | undefined): number {
  return typeof letterSpacing === "number" && Number.isFinite(letterSpacing) ? letterSpacing : 0;
}

function withOverviewRulerBorderHidden(theme: ITheme): ITheme {
  return {
    ...theme,
    overviewRulerBorder: theme.background ?? "transparent",
  };
}

export interface TerminalClipboard {
  /** Whether the async Clipboard API is usable. Browsers omit it outside secure contexts. */
  isAvailable?(): boolean;
  readText(): Promise<string>;
  read(): Promise<readonly Pick<ClipboardItem, "types" | "getType">[]>;
  writeText(text: string): Promise<void>;
}

function getBrowserClipboard(): Clipboard | undefined {
  return typeof navigator !== "undefined" ? navigator.clipboard : undefined;
}

function rejectUnavailableClipboard(): Promise<never> {
  return Promise.reject(new Error("Clipboard API is unavailable"));
}

const browserClipboard: TerminalClipboard = {
  isAvailable: () => !!getBrowserClipboard(),
  readText: () => getBrowserClipboard()?.readText() ?? rejectUnavailableClipboard(),
  read: () => getBrowserClipboard()?.read() ?? rejectUnavailableClipboard(),
  writeText: (text) => getBrowserClipboard()?.writeText(text) ?? rejectUnavailableClipboard(),
};

async function readClipboardImage(clipboard: TerminalClipboard): Promise<TerminalFile | null> {
  for (const item of await clipboard.read()) {
    const mimeType = item.types.find((type) => type.startsWith("image/"));
    if (mimeType) {
      const blob = await item.getType(mimeType);
      return {
        fileName: `clipboard.${imageExtension(mimeType)}`,
        mimeType,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }
  }
  return null;
}

/** The file of a paste that carries no text. xterm would paste it as empty text. */
function findFileOnlyPaste(transfer: DataTransfer | null): File | null {
  if (!transfer || transfer.getData("text/plain").length > 0) {
    return null;
  }
  for (const item of Array.from(transfer.items)) {
    if (item.kind === "file") {
      return item.getAsFile();
    }
  }
  return null;
}

// Grapheme widths match the daemon and native buffers. Legacy hosts keep the
// Unicode 11 table web used before. See docs/terminal-rendering.md.
function applyCharacterWidths(terminal: Terminal, widths: TerminalCharacterWidths): void {
  terminal.unicode.activeVersion = widths === "graphemes" ? "15-graphemes" : "11";
}

export class TerminalEmulatorRuntime {
  constructor(
    private readonly options: FindShortcutPlatform = { isMac: isMacUserAgent() },
    private readonly clipboard: TerminalClipboard = browserClipboard,
  ) {}

  private callbacks: TerminalEmulatorRuntimeCallbacks = {};
  private pendingModifiers: PendingTerminalModifiers = {
    ctrl: false,
    shift: false,
    alt: false,
  };
  private characterWidths: TerminalCharacterWidths = "graphemes";
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  // registerCharacterJoiner id when programming ligatures are active.
  private ligatureJoinerId: number | undefined;
  private ligaturesDesired = true;
  private requestedLetterSpacing = 0;
  // Longest-first sequences for the character joiner (stable for the process).
  private readonly ligatureSequences: readonly string[] = [...MONO_FALLBACK_LIGATURES].sort(
    (a, b) => b.length - a.length,
  );
  // Reload WebGL after enabling ligatures so the texture atlas picks up font-feature-settings.
  private reinitWebglRenderer: (() => void) | null = null;
  private searchAddon: SearchAddon | null = null;
  private findResult = { resultIndex: -1, resultCount: 0 };
  private findQuery = "";
  private findOutputAnchor: IMarker | undefined;
  private findWidgetSize = { width: 0, height: 0 };

  readonly find: TerminalFindHandle = {
    setWidgetSize: (size) => {
      this.findWidgetSize = size;
      this.emitFindResult();
    },
    search: (query, direction) => {
      this.releaseFindOutputAnchor();
      this.findQuery = query;
      if (this.terminal && !this.searchAddon) this.loadSearchAddon(this.terminal);
      const theme = this.terminal?.options.theme;
      const options = {
        regex: false,
        caseSensitive: false,
        incremental: direction === undefined,
        decorations: {
          matchBorder: theme?.yellow ?? "#b58900",
          matchOverviewRuler: theme?.yellow ?? "#b58900",
          activeMatchBorder: theme?.blue ?? "#268bd2",
          activeMatchColorOverviewRuler: theme?.blue ?? "#268bd2",
        },
      };
      if (direction === "next") this.searchAddon?.findNext(query, options);
      else this.searchAddon?.findPrevious(query, options);
    },
    clear: () => {
      this.releaseFindOutputAnchor();
      this.findQuery = "";
      // clearDecorations leaves the addon's pending refresh alive. Disposal
      // cancels its timers and listeners without touching terminal selection.
      this.searchAddon?.dispose();
      this.searchAddon = null;
      this.findResult = { resultIndex: -1, resultCount: 0 };
      this.emitFindResult();
    },
  };

  private replayResize: TerminalResizeRequest | null = null;
  private fitAndEmitResize: ((input?: TerminalResizeRequest) => void) | null = null;
  private lastSize: { rows: number; cols: number } | null = null;
  // Whether any claim-eligible fit has been emitted since mount; the first one
  // must go through even when the size didn't change (see fitAndEmitResize).
  private hasEmittedClaimedResize = false;
  private cleanup: (() => void) | null = null;
  private outputOperations: TerminalOutputOperation[] = [];
  private inFlightOutputOperation: TerminalOutputOperation | null = null;
  private inFlightOutputOperationTimeout: ReturnType<typeof setTimeout> | null = null;
  // Plain writes are submitted to xterm without waiting, so their onCommitted callbacks are
  // pending until xterm commits the write. unmount() disposes xterm before those fire, so we
  // track them here to flush remaining callbacks and avoid stalling upstream backpressure.
  private pendingWriteCommits = new Set<() => void>();
  // True once a plain write has been submitted to xterm that no later barrier has gated
  // yet. A barrier only needs the sentinel-write gate when this is set; at mount or right
  // after another barrier it's false and the barrier applies immediately, saving a parse
  // cycle of latency. Cleared when a barrier starts (it gates every write before it).
  private hasUngatedWrites = false;
  private readonly inputModeDecoder = new TextDecoder();
  private suppressInput = false;
  private readonly inputModeTracker = new TerminalInputModeTracker();
  private lastInputModeState: TerminalInputModeState = this.inputModeTracker.getState();
  private themeBackgroundElements: HTMLElement[] = [];
  // Selection-delete undo/redo (text-field style). Cleared on unrelated user input.
  private readonly editHistory = new TerminalEditHistory();
  // True while we inject synthetic key sequences so onData doesn't wipe history.
  private isInjectingEditSequence = false;
  // Live ImageAddon instance (WebGL path). Used for hit-testing click-to-preview.
  private imageAddon: ImageAddon | null = null;
  private imageLightbox: TerminalImageLightboxHandle | null = null;
  private imagePreviewRoot: HTMLElement | null = null;
  private gpuEnabled = false;
  private webglRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private webglRetryAttempt = 0;
  private readonly kittyNotificationAccumulator = new KittyNotificationAccumulator();
  private reportedCwd: string | null = null;
  private pointerShapeStyleTarget: HTMLElement | null = null;
  private previousPointerShape: string = "";

  private handleVisibilityRestore = (): void => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    this.fitAndEmitResize?.({ forceRefresh: true, shouldClaim: false });
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        this.fitAndEmitResize?.({ forceRefresh: true, shouldClaim: false });
      });
    }
  };

  setCallbacks(input: { callbacks: TerminalEmulatorRuntimeCallbacks }): void {
    this.callbacks = input.callbacks;
  }

  setPendingModifiers(input: { pendingModifiers: PendingTerminalModifiers }): void {
    this.pendingModifiers = input.pendingModifiers;
  }

  setCharacterWidths(input: { widths: TerminalCharacterWidths }): void {
    this.characterWidths = input.widths;
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }
    applyCharacterWidths(terminal, input.widths);
    this.refreshVisibleRows();
  }

  private loadSearchAddon(terminal: Terminal): void {
    const searchAddon = new SearchAddon({ highlightLimit: FIND_HIGHLIGHT_LIMIT });
    terminal.loadAddon(searchAddon);
    this.searchAddon = searchAddon;
    searchAddon.onDidChangeResults((result) => {
      this.findResult = result;
      this.emitFindResult();
    });
  }

  private releaseFindOutputAnchor(): void {
    this.findOutputAnchor?.dispose();
    this.findOutputAnchor = undefined;
  }

  private preserveFindViewport(terminal: Terminal): void {
    if (!this.findQuery || this.findResult.resultCount === 0 || this.findOutputAnchor) return;
    const buffer = terminal.buffer.active;
    this.findOutputAnchor = terminal.registerMarker(
      buffer.viewportY - buffer.baseY - buffer.cursorY,
    );
  }

  attachKeyEventHandler(
    terminal: Pick<
      Terminal,
      | "attachCustomKeyEventHandler"
      | "hasSelection"
      | "getSelection"
      | "paste"
      | "input"
      | "scrollToBottom"
    >,
  ): void {
    // oxlint-disable-next-line complexity -- 保持上游键盘分派与选区编辑快捷键的优先级。
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.isComposing) {
        return true;
      }

      if (this.handleFontZoomChord(event)) return false;
      if (this.terminal) {
        if (
          this.handleEditHistoryChord(event, this.terminal) ||
          this.handleSelectionDeleteKey(event, this.terminal)
        )
          return false;
        if (this.handleSingleBackspaceKey(event, this.terminal)) return true;
      }
      if (this.handleFindShortcut(event)) return false;

      if (
        !this.options.isMac &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        return !this.handleCtrlClipboardShortcut(terminal, event);
      }

      if (this.maybeSendMacEditingShortcut(terminal, event)) {
        return false;
      }

      const normalizedKey = normalizeDomTerminalKey(event.key);
      if (!normalizedKey || isTerminalModifierDomKey(event.key)) {
        return true;
      }

      if (
        !shouldInterceptDomTerminalKey({
          key: normalizedKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          pendingModifiers: this.pendingModifiers,
          enhancedInputActive: this.inputModeTracker.supportsModifiedEnter(),
          isAppleHandheld,
        })
      ) {
        return true;
      }

      const modifiers = mergeTerminalModifiers({
        pendingModifiers: this.pendingModifiers,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      this.callbacks.onTerminalKey?.({
        key: normalizeTerminalTransportKey(normalizedKey),
        ...modifiers,
      });

      if (hasPendingTerminalModifiers(this.pendingModifiers)) {
        this.callbacks.onPendingModifiersConsumed?.();
      }

      event.preventDefault();
      event.stopPropagation();
      return false;
    });
  }

  /** Returns true when a non-Mac Ctrl+C / Ctrl+V clipboard shortcut was handled. */
  private handleCtrlClipboardShortcut(
    terminal: Pick<Terminal, "hasSelection" | "getSelection" | "paste">,
    event: KeyboardEvent,
  ): boolean {
    const key = event.key.toLowerCase();
    // Without the Clipboard API (e.g. plain http on a LAN address), the browser's native
    // copy/paste events still fire and xterm handles them, so leave the default action.
    const clipboardAvailable = this.clipboard.isAvailable?.() ?? true;

    // Ctrl+C: copy selection to clipboard if text is selected, otherwise let xterm send SIGINT
    if (key === "c" && terminal.hasSelection()) {
      if (clipboardAvailable) {
        void this.clipboard.writeText(terminal.getSelection());
      }
      return true;
    }

    // Ctrl+V: paste clipboard text, or the clipboard image when there is no text
    if (key === "v") {
      if (clipboardAvailable) {
        event.preventDefault();
        this.pasteClipboard(terminal);
      }
      return true;
    }

    return false;
  }

  private handleFindShortcut(event: KeyboardEvent): boolean {
    if (!isFindShortcut(event, this.options) || !this.callbacks.onFindRequest) return false;
    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onFindRequest();
    return true;
  }

  private findWidgetCoversSelection(): boolean {
    if (!this.findQuery) return false;
    const terminal = this.terminal;
    const element = terminal?.element;
    const screen = element?.querySelector(".xterm-screen");
    const selection = terminal?.getSelectionPosition();
    if (!terminal || !element || !screen || !selection) return false;
    const root = element.getBoundingClientRect();
    const grid = screen.getBoundingClientRect();
    const cellWidth = grid.width / terminal.cols;
    const cellHeight = grid.height / terminal.rows;
    const firstRow = terminal.buffer.active.viewportY;
    const top = grid.top + (selection.start.y - firstRow) * cellHeight;
    const bottom = grid.top + (selection.end.y - firstRow + 1) * cellHeight;
    // A wrapped selection can occupy the right edge on its intermediate rows.
    const rightCol = selection.start.y === selection.end.y ? selection.end.x : terminal.cols;
    const right = grid.left + rightCol * cellWidth;
    return (
      top < root.top + this.findWidgetSize.height &&
      bottom > root.top &&
      right > root.right - this.findWidgetSize.width
    );
  }

  private emitFindResult(): void {
    const placement = this.findWidgetCoversSelection() ? "bottom" : "top";
    this.callbacks.onFindResult?.({
      ...this.findResult,
      limited: this.findResult.resultCount >= FIND_HIGHLIGHT_LIMIT,
      placement,
    });
  }

  getInputModeState(): TerminalInputModeState {
    return this.inputModeTracker.getState();
  }

  private maybeSendMacEditingShortcut(
    terminal: Pick<Terminal, "input" | "scrollToBottom">,
    event: KeyboardEvent,
  ): boolean {
    if (!this.options.isMac || hasPendingTerminalModifiers(this.pendingModifiers)) {
      return false;
    }
    const editingShortcutData = resolveMacTerminalEditingShortcut(event);
    if (editingShortcutData === null) {
      return false;
    }
    // Routed through terminal.input() so the data takes the same path as typed
    // keys: onData -> callbacks.onInput, selection clearing included.
    terminal.input(editingShortcutData, true);
    terminal.scrollToBottom();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  mount(input: TerminalEmulatorRuntimeMountInput): void {
    this.unmount();

    input.host.innerHTML = "";
    this.lastSize = null;
    this.inputModeTracker.reset();
    this.emitInputModeChange();

    this.ligaturesDesired = input.ligaturesEnabled !== false;
    this.requestedLetterSpacing = resolveTerminalLetterSpacing(input.letterSpacing);
    const openExternalLink = (event: MouseEvent, uri: string) => {
      event.preventDefault();
      void this.callbacks.onOpenExternalUrl?.(uri);
    };
    const terminal = new Terminal({
      allowProposedApi: true,
      altClickMovesCursor: true,
      letterSpacing: this.ligaturesDesired ? 0 : this.requestedLetterSpacing,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: resolveTerminalFontFamily(input.fontFamily),
      fontSize: resolveTerminalFontSize(input.fontSize),
      // OSC 8 hyperlinks; without a handler xterm prompts and calls window.open().
      linkHandler: { activate: openExternalLink },
      lineHeight: 1.0,
      macOptionIsMeta: true,
      minimumContrastRatio: 1,
      rescaleOverlappingGlyphs: true,
      scrollbar: {
        width: 8,
      },
      scrollback: input.scrollback,
      theme: withOverviewRulerBorderHidden(input.theme),
    });
    const fitAddon = new FitAddon();
    let webglAddon: WebglAddon | null = null;
    let imageAddon: ImageAddon | null = null;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.loadAddon(new UnicodeGraphemesAddon());
    applyCharacterWidths(terminal, this.characterWidths);
    terminal.loadAddon(new WebLinksAddon(openExternalLink));
    const localFileLinkProvider = terminal.registerLinkProvider(
      createTerminalLocalFileLinkProvider(terminal, {
        resolveLink: async (source) => {
          const target = await this.callbacks.onResolveLocalFileLink?.(source);
          return target ?? null;
        },
        openLink: (target, disposition) => {
          void this.callbacks.onOpenLocalFileLink?.(target, disposition);
        },
      }),
    );
    this.loadSearchAddon(terminal);
    terminal.onWriteParsed(() => {
      // Even a bottom viewport is an inspected location while searching. A
      // marker follows buffer trimming; output writes remain batched normally.
      const anchor = this.findOutputAnchor;
      if (anchor && !anchor.isDisposed) terminal.scrollToLine(anchor.line);
      // A parser turn may yield with submitted writes still queued. Commit
      // callbacks identify completion; plain writes still submit back-to-back.
      if (this.pendingWriteCommits.size === 0) this.releaseFindOutputAnchor();
    });
    terminal.onScroll(() => {
      if (this.findQuery) this.emitFindResult();
    });
    terminal.loadAddon(new ClipboardAddon());
    terminal.open(input.host);
    if (this.ligaturesDesired) this.enableLigatures(terminal);
    this.themeBackgroundElements = this.collectThemeBackgroundElements(input);
    this.applyThemeBackground(input.theme);

    const disposeImageAddon = (): void => {
      try {
        imageAddon?.dispose();
      } catch {
        // ignore
      }
      imageAddon = null;
      this.imageAddon = null;
    };
    const disposeWebglRenderer = (): void => {
      if (!webglAddon) {
        return;
      }
      try {
        webglAddon.dispose();
      } catch {
        // ignore
      }
      webglAddon = null;
      this.gpuEnabled = false;
      void this.callbacks.onGpuRendererChange?.({ enabled: false });
      // WebGL and DOM renderers can have different cell dimensions.
      this.fitAndEmitResize?.({ forceRefresh: true, shouldClaim: false });
    };

    // Browser xterm is a renderer only; it never replies to terminal protocol queries.
    // Replies live on the daemon (one process boundary from the PTY) so they arrive
    // before the foreground app exits, instead of racing back over the websocket.
    // Re-registered after the image addon loads so our handlers stay last in the
    // LIFO dispatch (the image addon registers its own {final:"c"} for sixel DA1).
    const registerProtocolQuerySuppression = (): void => {
      terminal.parser.registerCsiHandler({ final: "c" }, () => true);
      terminal.parser.registerCsiHandler({ prefix: ">", final: "c" }, () => true);
      terminal.parser.registerCsiHandler({ prefix: "=", final: "c" }, () => true);
      terminal.parser.registerCsiHandler({ prefix: ">", final: "q" }, () => true);
      terminal.parser.registerCsiHandler({ final: "n" }, () => true);
      terminal.parser.registerCsiHandler({ prefix: "?", final: "n" }, () => true);
      terminal.parser.registerCsiHandler({ final: "R" }, () => true);
      terminal.parser.registerCsiHandler({ intermediates: "$", final: "p" }, () => true);
      terminal.parser.registerCsiHandler(
        { prefix: "?", intermediates: "$", final: "p" },
        () => true,
      );
      terminal.parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => true);
      for (const code of [10, 11, 12]) {
        terminal.parser.registerOscHandler(code, (data) => data.trim() === "?");
      }
    };
    registerProtocolQuerySuppression();

    const initWebglRenderer = (): void => {
      try {
        disposeWebglRenderer();
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          disposeWebglRenderer();
        });
        terminal.loadAddon(webglAddon);
        if (!imageAddon) {
          // 图片存储独立于 WebGL；切换字体时保留已解码的终端图片。
          imageAddon = new ImageAddon({
            sixelSupport: true,
            iipSupport: true,
            kittySupport: true,
            enableSizeReports: true,
            showPlaceholder: true,
          });
          terminal.loadAddon(imageAddon);
          this.imageAddon = imageAddon;
          registerProtocolQuerySuppression();
        }
        this.gpuEnabled = true;
        void this.callbacks.onGpuRendererChange?.({ enabled: true });
        this.fitAndEmitResize?.({ forceRefresh: true, shouldClaim: false });
      } catch {
        disposeWebglRenderer();
      }
    };
    this.reinitWebglRenderer = initWebglRenderer;
    let webglAddonRaf: number | null = requestAnimationFrame(() => {
      webglAddonRaf = null;
      initWebglRenderer();
    });

    const restoreDocumentStyles = this.applyDocumentBoundsStyles({
      root: input.root,
    });
    const restoreViewportStyles = this.applyViewportTouchStyles({
      host: input.host,
    });

    this.terminal = terminal;
    this.fitAddon = fitAddon;
    window.__paseoTerminal = terminal;

    const fitAndEmitResize = (resizeInput?: TerminalResizeRequest): void => {
      if (this.deferReplayResize(resizeInput)) return;
      const forceRefresh = resizeInput?.forceRefresh ?? false;
      const shouldClaim = resizeInput?.shouldClaim ?? true;
      const forceClaim = resizeInput?.forceClaim ?? false;
      const currentTerminal = this.terminal;
      const currentFitAddon = this.fitAddon;
      if (!currentTerminal || !currentFitAddon) {
        return;
      }

      if (input.root.offsetWidth === 0 || input.root.offsetHeight === 0) {
        return;
      }

      try {
        currentFitAddon.fit();
      } catch {
        return;
      }

      const nextRows = currentTerminal.rows;
      const nextCols = currentTerminal.cols;
      const previous = this.lastSize;
      if (
        !forceRefresh &&
        !forceClaim &&
        previous &&
        previous.rows === nextRows &&
        previous.cols === nextCols
      ) {
        return;
      }

      this.lastSize = { rows: nextRows, cols: nextCols };
      this.refreshVisibleRows();
      this.callbacks.onResize?.(
        createTerminalResizeEvent({
          rows: nextRows,
          cols: nextCols,
          shouldClaim,
          forceClaim,
        }),
      );
    };
    this.fitAndEmitResize = fitAndEmitResize;

    fitAndEmitResize({ forceRefresh: true, shouldClaim: false });

    const inputDisposable = terminal.onData((data) => {
      if (this.suppressInput) {
        return;
      }
      if (!this.isInjectingEditSequence && isEditHistoryBreakingInput(data))
        this.editHistory.clear();
      this.callbacks.onInput?.(data);
    });

    this.imagePreviewRoot = input.root;
    this.pointerShapeStyleTarget = terminal.screenElement ?? terminal.element ?? input.host;
    this.previousPointerShape = this.pointerShapeStyleTarget.style.cursor;
    const removeClickEditListeners = this.setupClickEditHandlers(terminal);
    const removeImagePreviewListeners = this.setupImagePreviewHandlers(terminal);
    const removeKittyProtocolHandlers = this.setupKittyProtocolHandlers(terminal);
    this.attachKeyEventHandler(terminal);

    // Cmd+V and context-menu paste arrive as DOM paste events. Take file-only
    // pastes before xterm's own listener consumes them as empty text.
    const filePasteHandler = (event: ClipboardEvent): void => {
      const onFilePaste = this.callbacks.onFilePaste;
      const file = findFileOnlyPaste(event.clipboardData);
      if (!onFilePaste || !file) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onFilePaste(readTerminalFile(file));
    };
    input.host.addEventListener("paste", filePasteHandler, true);

    const removeTouchListeners = this.setupTouchScrollHandlers({
      root: input.root,
      host: input.host,
      terminal,
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAndEmitResize({ shouldClaim: false });
    });
    resizeObserver.observe(input.root);
    resizeObserver.observe(input.host);

    // Ctrl+wheel (macOS pinch also arrives as ctrl+wheel) zooms the font.
    // Capture phase so xterm's own wheel scrolling never sees the gesture;
    // the accumulator turns fine-grained trackpad deltas into whole steps.
    const WHEEL_ZOOM_STEP = 40;
    let wheelZoomAccumulator = 0;
    const wheelZoomHandler = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      wheelZoomAccumulator += event.deltaY;
      while (wheelZoomAccumulator <= -WHEEL_ZOOM_STEP) {
        wheelZoomAccumulator += WHEEL_ZOOM_STEP;
        void this.callbacks.onFontZoom?.({ direction: "in" });
      }
      while (wheelZoomAccumulator >= WHEEL_ZOOM_STEP) {
        wheelZoomAccumulator -= WHEEL_ZOOM_STEP;
        void this.callbacks.onFontZoom?.({ direction: "out" });
      }
    };
    input.root.addEventListener("wheel", wheelZoomHandler, { passive: false, capture: true });

    const windowResizeHandler = () => {
      fitAndEmitResize({ shouldClaim: false });
    };
    window.addEventListener("resize", windowResizeHandler);
    const windowFocusHandler = () => {
      this.handleVisibilityRestore();
    };
    window.addEventListener("focus", windowFocusHandler);

    const documentVisibilityChangeHandler = () => {
      this.handleVisibilityRestore();
    };
    document.addEventListener("visibilitychange", documentVisibilityChangeHandler);

    const visualViewport = window.visualViewport;
    const visualViewportResizeHandler = () => {
      fitAndEmitResize({ shouldClaim: false });
    };
    visualViewport?.addEventListener("resize", visualViewportResizeHandler);

    const fitTimeouts = FIT_TIMEOUT_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => {
        fitAndEmitResize({ forceRefresh: true, shouldClaim: false });
      }, delayMs),
    );

    const fontSet = document.fonts;
    const fontReadyHandler = () => {
      this.remeasureFontMetrics();
      fitAndEmitResize({ forceRefresh: true, shouldClaim: false });
    };
    fontSet?.addEventListener?.("loadingdone", fontReadyHandler);
    void fontSet?.ready
      .then(() => {
        fitAndEmitResize({ forceRefresh: true, shouldClaim: false });
        return;
      })
      .catch(() => {
        // no-op
      });

    window.setTimeout(() => {
      fitAndEmitResize({ forceRefresh: true, shouldClaim: false });
    }, 0);

    this.processOutputQueue();

    const disposables: TerminalEmulatorRuntimeDisposables = {
      disposeInput: () => {
        inputDisposable.dispose();
      },
      removeClickEditListeners,
      removeImagePreviewListeners,
      removeKittyProtocolHandlers,
      disconnectResizeObserver: () => {
        resizeObserver.disconnect();
      },
      removeWheelZoomListener: () => {
        input.root.removeEventListener("wheel", wheelZoomHandler, { capture: true });
      },
      removeWindowResize: () => {
        window.removeEventListener("resize", windowResizeHandler);
      },
      removeWindowFocus: () => {
        window.removeEventListener("focus", windowFocusHandler);
      },
      removeDocumentVisibilityChange: () => {
        document.removeEventListener("visibilitychange", documentVisibilityChangeHandler);
      },
      removeVisualViewportResize: () => {
        visualViewport?.removeEventListener("resize", visualViewportResizeHandler);
      },
      clearFitTimeouts: () => {
        for (const handle of fitTimeouts) {
          window.clearTimeout(handle);
        }
      },
      removeFontListeners: () => {
        fontSet?.removeEventListener?.("loadingdone", fontReadyHandler);
      },
      removeTouchListeners,
      removeFilePasteListener: () => {
        input.host.removeEventListener("paste", filePasteHandler, true);
      },
      restoreDocumentStyles,
      restoreViewportStyles,
      disposeFitAddon: () => {
        fitAddon.dispose();
      },
      disposeWebglAddon: () => {
        if (webglAddonRaf !== null) {
          cancelAnimationFrame(webglAddonRaf);
          webglAddonRaf = null;
        }
        disposeWebglRenderer();
        disposeImageAddon();
      },
      disposeTerminal: () => {
        localFileLinkProvider.dispose();
        terminal.dispose();
      },
    };

    this.cleanup = () => {
      this.reinitWebglRenderer = null;
      this.closeImageLightbox();
      this.imagePreviewRoot = null;
      this.kittyNotificationAccumulator.clear();
      this.reportedCwd = null;
      if (this.webglRetryTimer !== null) {
        clearTimeout(this.webglRetryTimer);
        this.webglRetryTimer = null;
      }
      this.webglRetryAttempt = 0;
      if (this.pointerShapeStyleTarget) {
        this.pointerShapeStyleTarget.style.cursor = this.previousPointerShape;
      }
      this.pointerShapeStyleTarget = null;
      this.disableLigatures(terminal);
      disposables.disposeInput();
      disposables.removeClickEditListeners();
      disposables.removeImagePreviewListeners();
      disposables.removeKittyProtocolHandlers();
      disposables.disconnectResizeObserver();
      disposables.removeWheelZoomListener();
      disposables.removeWindowResize();
      disposables.removeWindowFocus();
      disposables.removeDocumentVisibilityChange();
      disposables.removeVisualViewportResize();
      disposables.clearFitTimeouts();
      disposables.removeFontListeners();
      disposables.removeTouchListeners();
      disposables.removeFilePasteListener();
      disposables.disposeFitAddon();
      disposables.disposeWebglAddon();
      disposables.disposeTerminal();
      disposables.restoreDocumentStyles();
      disposables.restoreViewportStyles();
      this.gpuEnabled = false;
    };
  }

  /** Last OSC 7 reported cwd for this surface, if any. */
  getReportedCwd(): string | null {
    return this.reportedCwd;
  }

  isGpuAccelerated(): boolean {
    return this.gpuEnabled;
  }

  write(input: {
    data: TerminalOutputData;
    suppressInput?: boolean;
    onCommitted?: () => void;
  }): void {
    if (input.data.length === 0) {
      input.onCommitted?.();
      return;
    }
    this.outputOperations.push({
      type: "write",
      data: input.data,
      suppressInput: input.suppressInput ?? false,
      ...(input.onCommitted ? { onCommitted: input.onCommitted } : {}),
    });
    this.processOutputQueue();
  }

  clear(input?: { onCommitted?: () => void }): void {
    this.outputOperations.push({
      type: "clear",
      data: EMPTY_TERMINAL_OUTPUT,
      suppressInput: false,
      ...(input?.onCommitted ? { onCommitted: input.onCommitted } : {}),
    });
    this.processOutputQueue();
  }

  paste(text: string): void {
    this.terminal?.paste(text);
  }

  private pasteClipboard(terminal: Pick<Terminal, "paste">): void {
    const text = this.clipboard.readText().catch(() => "");
    const onFilePaste = this.callbacks.onFilePaste;
    // Report the gesture now so it keeps its place among earlier file pastes.
    const file = text.then((value) => {
      if (value) {
        terminal.paste(value);
        return null;
      }
      return onFilePaste ? readClipboardImage(this.clipboard).catch(() => null) : null;
    });
    onFilePaste?.(file);
  }

  replay(event: import("@getpaseo/client").TerminalReplayEvent): void {
    if (event.type === "begin") {
      this.replayResize ??= { shouldClaim: false };
      this.restoreOutput({ data: EMPTY_TERMINAL_OUTPUT, rows: event.rows, cols: event.cols });
    } else if (event.type === "data") {
      this.write({ data: event.data, suppressInput: true });
    } else {
      this.outputOperations.push({ type: "fit", data: EMPTY_TERMINAL_OUTPUT });
      this.processOutputQueue();
    }
  }

  private restoreOutput(input: {
    data: TerminalOutputData;
    rows?: number;
    cols?: number;
    onCommitted?: () => void;
  }): void {
    this.outputOperations.push({
      type: "snapshot",
      data: prependTerminalOutput(RESET_TERMINAL_OUTPUT, input.data),
      rows: input.rows,
      cols: input.cols,
      suppressInput: true,
      ...(input.onCommitted ? { onCommitted: input.onCommitted } : {}),
    });
    this.processOutputQueue();
  }

  private deferReplayResize(input?: TerminalResizeRequest): boolean {
    if (!this.replayResize) return false;
    this.replayResize = {
      forceRefresh: this.replayResize.forceRefresh || input?.forceRefresh,
      shouldClaim: this.replayResize.shouldClaim || (input?.shouldClaim ?? true),
      forceClaim: this.replayResize.forceClaim || input?.forceClaim,
    };
    return true;
  }

  resize(input?: TerminalResizeRequest): void {
    this.fitAndEmitResize?.(input);
  }

  setTheme(input: { theme: ITheme }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      terminal.options.theme = withOverviewRulerBorderHidden(input.theme);
    } catch {
      // ignore
      return;
    }

    this.applyThemeBackground(input.theme);
    this.refreshVisibleRows();
  }

  setScrollback(input: { lines: number }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      terminal.options.scrollback = input.lines;
    } catch {
      // ignore
      return;
    }

    this.refreshVisibleRows();
  }

  setFont(input: { fontFamily?: string; fontSize?: number }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      terminal.options.fontFamily = resolveTerminalFontFamily(input.fontFamily);
      terminal.options.fontSize = resolveTerminalFontSize(input.fontSize);
    } catch {
      // ignore
      return;
    }

    // Font metrics / face change — re-apply font-feature-settings and refresh so
    // WebGL re-rasterizes glyphs with calt/liga for the new face.
    if (this.ligaturesDesired) {
      this.applyLigatureFontFeatures(terminal);
      this.reinitWebglRenderer?.();
    }

    this.fitAndEmitResize?.({ forceRefresh: true, shouldClaim: false });
    this.refreshVisibleRows();
  }

  setLetterSpacing(input: { letterSpacing?: number }): void {
    this.requestedLetterSpacing = resolveTerminalLetterSpacing(input.letterSpacing);
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      // Ligatures require zero letter-spacing for correct join metrics.
      terminal.options.letterSpacing = this.ligaturesDesired ? 0 : this.requestedLetterSpacing;
    } catch {
      // ignore
      return;
    }

    // Cell width changed, so the column count the grid can hold changes too.
    this.fitAndEmitResize?.({ forceRefresh: true });
    this.refreshVisibleRows();
  }

  setLigatures(input: { enabled: boolean }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }
    this.ligaturesDesired = input.enabled;
    if (input.enabled) {
      try {
        terminal.options.letterSpacing = 0;
      } catch {
        // ignore
      }
      this.enableLigatures(terminal);
      // WebGL atlas inherits font-feature-settings from terminal.element — reload
      // after features/joiner are in place (same requirement as LigaturesAddon docs).
      this.reinitWebglRenderer?.();
    } else {
      this.disableLigatures(terminal);
      terminal.options.letterSpacing = this.requestedLetterSpacing;
      this.reinitWebglRenderer?.();
    }
    this.fitAndEmitResize?.({ forceRefresh: true });
    this.refreshVisibleRows();
  }

  private enableLigatures(terminal: Terminal): void {
    this.applyLigatureFontFeatures(terminal);
    if (this.ligatureJoinerId !== undefined) {
      return;
    }
    // allowProposedApi must be true (set at construction) for registerCharacterJoiner.
    try {
      this.ligatureJoinerId = terminal.registerCharacterJoiner((text) =>
        findTerminalLigatureRanges(text, this.ligatureSequences),
      );
    } catch {
      // Proposed API unavailable or terminal not open — leave features CSS only.
      this.ligatureJoinerId = undefined;
    }
  }

  private disableLigatures(terminal: Terminal): void {
    if (this.ligatureJoinerId !== undefined) {
      try {
        terminal.deregisterCharacterJoiner(this.ligatureJoinerId);
      } catch {
        // ignore
      }
      this.ligatureJoinerId = undefined;
    }
    this.clearLigatureFontFeatures(terminal);
  }

  private applyLigatureFontFeatures(terminal: Terminal): void {
    // WebGL TextureAtlas attaches its canvas under this element to inherit
    // font-feature-settings so joined multi-cell glyphs paint with calt/liga.
    if (terminal.element) {
      terminal.element.style.fontFeatureSettings = MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON;
    }
  }

  private clearLigatureFontFeatures(terminal: Terminal): void {
    if (terminal.element) {
      terminal.element.style.fontFeatureSettings = "";
    }
  }

  focus(input?: { forceRefocus?: boolean }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }
    if (input?.forceRefocus) {
      terminal.blur();
    }
    terminal.focus();
  }

  blur(): void {
    this.terminal?.blur();
  }

  findNext(input: TerminalFindQueryInput): boolean {
    return this.searchAddon?.findNext(input.query, TERMINAL_FIND_SEARCH_OPTIONS) ?? false;
  }

  findPrevious(input: TerminalFindQueryInput): boolean {
    return this.searchAddon?.findPrevious(input.query, TERMINAL_FIND_SEARCH_OPTIONS) ?? false;
  }

  clearFindDecorations(): void {
    this.searchAddon?.clearDecorations();
  }

  onFindResultsChanged(listener: (event: TerminalFindResultChangeEvent) => void): () => void {
    const disposable: IDisposable | undefined = this.searchAddon?.onDidChangeResults(listener);
    return () => {
      disposable?.dispose();
    };
  }

  // xterm measures cell width once at open() and only re-measures when fontFamily or
  // fontSize *changes* — a same-value assignment is a no-op in its options service. If a
  // bundled web font (e.g. Maple Mono NF CN) finishes loading after open(), the stale
  // fallback metrics stick and every glyph sits in an oversized cell (reads as huge
  // letter spacing). Nudge fontFamily through a sentinel and back to force a re-measure
  // with the now-loaded font.
  // Ctrl + +/-/0 zooms the terminal font. Shift stays allowed so layouts where
  // '+' is Shift+'=' work; the chord is swallowed before xterm would forward
  // it to the shell. Returns true when the event was consumed.
  private handleFontZoomChord(event: KeyboardEvent): boolean {
    if (!event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }
    const zoomDirection = resolveFontZoomDirection(event);
    if (!zoomDirection) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.callbacks.onFontZoom?.({ direction: zoomDirection });
    return true;
  }

  /**
   * Custom key handler for xterm. Return true to let xterm process the event;
   * false when we fully handled it.
   */
  private handleCustomTerminalKeyEvent(event: KeyboardEvent, terminal: Terminal): boolean {
    if (event.type !== "keydown" || event.isComposing) {
      return true;
    }

    if (this.handleFontZoomChord(event)) {
      return false;
    }

    // Cmd/Ctrl+Z undo and Cmd/Ctrl+Shift+Z (or Ctrl+Y) redo for deletes.
    if (this.handleEditHistoryChord(event, terminal)) {
      return false;
    }

    // Backspace / Delete with an active selection: delete the selected span
    // (text-field style) instead of a single character under the cursor.
    if (this.handleSelectionDeleteKey(event, terminal)) {
      return false;
    }

    // Plain Backspace: remember the character before the cursor for undo, then
    // let xterm deliver the key to the shell as usual.
    if (this.handleSingleBackspaceKey(event, terminal)) {
      return true;
    }

    if (this.handleNonMacClipboardChords(event, terminal)) {
      return false;
    }

    const normalizedKey = normalizeDomTerminalKey(event.key);
    if (!normalizedKey || isTerminalModifierDomKey(event.key)) {
      return true;
    }

    if (
      !shouldInterceptDomTerminalKey({
        key: normalizedKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        pendingModifiers: this.pendingModifiers,
        enhancedInputActive: this.inputModeTracker.supportsModifiedEnter(),
        isAppleHandheld,
      })
    ) {
      return true;
    }

    const modifiers = mergeTerminalModifiers({
      pendingModifiers: this.pendingModifiers,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    this.callbacks.onTerminalKey?.({
      key: normalizeTerminalTransportKey(normalizedKey),
      ...modifiers,
    });

    if (this.pendingModifiers.ctrl || this.pendingModifiers.shift || this.pendingModifiers.alt) {
      this.callbacks.onPendingModifiersConsumed?.();
    }

    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  /** Ctrl+C / Ctrl+V on non-Mac: copy selection or paste. Returns true when consumed. */
  private handleNonMacClipboardChords(event: KeyboardEvent, terminal: Terminal): boolean {
    if (this.options.isMac || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
      return false;
    }
    const key = event.key.toLowerCase();

    // Ctrl+C: copy selection to clipboard if text is selected, otherwise let xterm send SIGINT
    if (key === "c" && terminal.hasSelection()) {
      void navigator.clipboard.writeText(terminal.getSelection());
      return true;
    }

    // Ctrl+V: paste from clipboard into terminal
    if (key === "v") {
      event.preventDefault();
      void navigator.clipboard.readText().then((text) => {
        if (text) {
          // Paste is a new edit — drop selection-delete history.
          this.editHistory.clear();
          terminal.paste(text);
        }
        return;
      });
      return true;
    }

    return false;
  }

  /**
   * Inject a synthetic key sequence into the PTY without clearing edit history
   * (onData would otherwise treat it as a fresh user edit).
   */
  private injectTerminalInput(terminal: Terminal, data: string): void {
    if (!data) {
      return;
    }
    this.isInjectingEditSequence = true;
    try {
      terminal.input(data, true);
    } finally {
      this.isInjectingEditSequence = false;
    }
  }

  /**
   * Cmd/Ctrl+Z undo and Cmd/Ctrl+Shift+Z (Ctrl+Y) redo for selection deletes.
   * When the stack is empty, non-Mac Ctrl+Z is left alone so SIGTSTP still works.
   */
  private handleEditHistoryChord(event: KeyboardEvent, terminal: Terminal): boolean {
    if (this.suppressInput) {
      return false;
    }
    if (terminal.modes.mouseTrackingMode !== "none") {
      return false;
    }

    const chord = resolveEditHistoryChord({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isMac: this.options.isMac,
    });
    if (!chord) {
      return false;
    }

    if (chord === "undo") {
      if (!this.editHistory.canUndo) {
        // Empty stack: on Mac swallow ⌘Z (browser has nothing useful to do);
        // on other platforms let Ctrl+Z reach the shell (job control).
        if (this.options.isMac) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      }
      const text = this.editHistory.undo();
      if (!text) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      terminal.clearSelection();
      // Cursor sits at the former selection after our delete sequence; re-type.
      this.injectTerminalInput(terminal, text);
      return true;
    }

    // redo
    if (!this.editHistory.canRedo) {
      if (this.options.isMac) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return false;
    }
    const text = this.editHistory.redo();
    if (!text) {
      return false;
    }
    const erase = buildRedoDeleteSequence(text);
    if (!erase) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    terminal.clearSelection();
    // After undo the cursor is at the end of the restored text; backspace it away.
    this.injectTerminalInput(terminal, erase);
    return true;
  }

  /**
   * Kitty-compatible OSC handlers: desktop notifications, progress, cwd, pointer.
   * Shared by local and SSH terminals (same byte stream + runtime).
   */
  private setupKittyProtocolHandlers(terminal: Terminal): () => void {
    const disposables: Array<{ dispose: () => void }> = [];

    const injectResponses = (responses: string[] | undefined): void => {
      if (this.suppressInput || !responses || responses.length === 0) {
        return;
      }
      for (const response of responses) {
        void this.callbacks.onInput?.(response);
      }
    };

    const handleNotification = (notification: TerminalDesktopNotification): void => {
      if (!this.suppressInput) void this.callbacks.onDesktopNotification?.(notification);
    };

    disposables.push(
      terminal.parser.registerOscHandler(99, (data) => {
        const result = parseKittyOsc99(data);
        injectResponses(result.responses);
        if (result.closeNotificationId) {
          // Best-effort: no durable OS handle list; still acknowledge close report path.
          return true;
        }
        if (result.notification && !this.suppressInput) {
          const done = isKittyOsc99Done(data);
          const complete = this.kittyNotificationAccumulator.ingest(result.notification, done);
          if (complete) {
            handleNotification(complete);
          }
        }
        return result.handled;
      }),
    );

    disposables.push(
      terminal.parser.registerOscHandler(9, (data) => {
        const result = parseOsc9(data);
        if (result.progress) {
          void this.callbacks.onProgressChange?.(result.progress);
        }
        if (result.notification) {
          handleNotification(result.notification);
        }
        return result.handled;
      }),
    );

    disposables.push(
      terminal.parser.registerOscHandler(7, (data) => {
        const result = parseOsc7(data);
        if (result.cwd) {
          this.reportedCwd = result.cwd;
          void this.callbacks.onCwdReport?.(result.cwd);
        }
        return result.handled;
      }),
    );

    disposables.push(
      terminal.parser.registerOscHandler(22, (data) => {
        const result = parseOsc22(data);
        const target = this.pointerShapeStyleTarget;
        if (target) {
          target.style.cursor = result.pointerShape ?? this.previousPointerShape;
        }
        return result.handled;
      }),
    );

    return () => {
      for (const disposable of disposables) {
        try {
          disposable.dispose();
        } catch {
          // ignore
        }
      }
    };
  }

  /**
   * Report notification activation/close back to the PTY (Kitty OSC 99).
   * Prefer `reportTerminalNotificationActivated` / `Closed` at the OS
   * notification layer (works even when the pane is unmounted). These
   * runtime helpers remain for in-process tests and direct call sites.
   */
  reportDesktopNotificationActivated(id: string, options?: { focus?: boolean }): void {
    void this.callbacks.onInput?.(buildKittyOsc99ActivationReport(id));
    if (options?.focus !== false) {
      void this.callbacks.onRequestFocus?.();
    }
  }

  reportDesktopNotificationClosed(id: string): void {
    void this.callbacks.onInput?.(buildKittyOsc99CloseReport(id));
  }

  /**
   * Plain-click cursor positioning and selection-aware Backspace/Delete.
   * Shared by local and SSH terminals (same emulator runtime).
   */
  private setupClickEditHandlers(terminal: Terminal): () => void {
    let mouseDownTimeStamp = 0;
    let mouseDownButton = -1;

    const onMouseDown = (event: MouseEvent): void => {
      mouseDownTimeStamp = event.timeStamp;
      mouseDownButton = event.button;
    };

    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== mouseDownButton) {
        return;
      }
      // Leave Option/Alt+click to xterm's built-in altClickMovesCursor path so
      // we never double-send arrow sequences.
      if (event.altKey) {
        return;
      }

      const selectionText = terminal.getSelection();
      const elapsedMs = event.timeStamp - mouseDownTimeStamp;
      // Prefer image preview over cursor repositioning when the click lands on
      // a Sixel / IIP / Kitty cell (works in scrollback too).
      if (
        this.tryOpenImagePreviewAtMouseEvent(terminal, event, {
          elapsedMs,
          hasMeaningfulSelection: selectionText.length > 1,
        })
      ) {
        return;
      }
      if (
        !shouldMoveCursorOnClick({
          button: event.button,
          detail: event.detail,
          elapsedMs,
          hasMeaningfulSelection: selectionText.length > 1,
          mouseTrackingMode: terminal.modes.mouseTrackingMode,
          scrolledToBottom: terminal.buffer.active.baseY === terminal.buffer.active.viewportY,
          suppressInput: this.suppressInput,
        })
      ) {
        return;
      }

      this.tryMoveCursorToMouseEvent(terminal, event);
    };

    // Listen on the screen element once open(); fall back to terminal.element.
    // Bubble phase: xterm updates selection during mousedown/mousemove already,
    // so selectionText is accurate by mouseup.
    const target = terminal.screenElement ?? terminal.element;
    if (!target) {
      return () => undefined;
    }

    target.addEventListener("mousedown", onMouseDown);
    target.addEventListener("mouseup", onMouseUp);
    return () => {
      target.removeEventListener("mousedown", onMouseDown);
      target.removeEventListener("mouseup", onMouseUp);
    };
  }

  /**
   * Hover pointer + click affordance for inline terminal images.
   * Click handling itself lives in setupClickEditHandlers so one mouseup path
   * can prefer preview over cursor repositioning.
   */
  private setupImagePreviewHandlers(terminal: Terminal): () => void {
    const target = terminal.screenElement ?? terminal.element;
    if (!target) {
      return () => undefined;
    }

    const previousCursor = target.style.cursor;
    const onMouseMove = (event: MouseEvent): void => {
      if (terminal.modes.mouseTrackingMode !== "none") {
        target.style.cursor = previousCursor;
        return;
      }
      const canvas = this.resolveImageCanvasAtMouseEvent(terminal, event);
      target.style.cursor = canvas ? "zoom-in" : previousCursor;
    };
    const onMouseLeave = (): void => {
      target.style.cursor = previousCursor;
    };

    target.addEventListener("mousemove", onMouseMove);
    target.addEventListener("mouseleave", onMouseLeave);
    return () => {
      target.removeEventListener("mousemove", onMouseMove);
      target.removeEventListener("mouseleave", onMouseLeave);
      target.style.cursor = previousCursor;
    };
  }

  private closeImageLightbox(): void {
    this.imageLightbox?.close();
    this.imageLightbox = null;
  }

  private tryOpenImagePreviewAtMouseEvent(
    terminal: Terminal,
    event: MouseEvent,
    input: { elapsedMs: number; hasMeaningfulSelection: boolean },
  ): boolean {
    const canvas = this.resolveImageCanvasAtMouseEvent(terminal, event);
    if (
      !shouldOpenTerminalImagePreview({
        button: event.button,
        detail: event.detail,
        elapsedMs: input.elapsedMs,
        hasMeaningfulSelection: input.hasMeaningfulSelection,
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        suppressInput: this.suppressInput,
        hasImage: Boolean(canvas),
      })
    ) {
      return false;
    }
    if (!canvas) {
      return false;
    }
    const dataUrl = canvasToPngDataUrl(canvas);
    const root = this.imagePreviewRoot;
    if (!dataUrl || !root) {
      return false;
    }
    this.closeImageLightbox();
    this.imageLightbox = openTerminalImageLightbox({
      root,
      dataUrl,
    });
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  private resolveImageCanvasAtMouseEvent(
    terminal: Terminal,
    event: MouseEvent,
  ): HTMLCanvasElement | undefined {
    const viewportCell = this.resolveViewportCellFromMouseEvent(terminal, event);
    if (!viewportCell) {
      return undefined;
    }
    return getTerminalImageAtViewportCell({
      imageSource: this.imageAddon,
      viewportCol: viewportCell.col,
      viewportRow: viewportCell.row,
      viewportY: terminal.buffer.active.viewportY,
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }

  private resolveViewportCellFromMouseEvent(
    terminal: Terminal,
    event: MouseEvent,
  ): { col: number; row: number } | null {
    const screen = terminal.screenElement ?? terminal.element;
    const dimensions = terminal.dimensions;
    if (!screen || !dimensions) {
      return null;
    }

    const cell = dimensions.css.cell;
    const rect = screen.getBoundingClientRect();
    const style = window.getComputedStyle(screen);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    return resolveTerminalViewportCellFromMouse({
      clientX: event.clientX,
      clientY: event.clientY,
      screenLeft: rect.left,
      screenTop: rect.top,
      cellWidth: cell.width,
      cellHeight: cell.height,
      cols: terminal.cols,
      rows: terminal.rows,
      paddingLeft,
      paddingTop,
    });
  }

  private tryMoveCursorToMouseEvent(terminal: Terminal, event: MouseEvent): void {
    const viewportCell = this.resolveViewportCellFromMouseEvent(terminal, event);
    if (!viewportCell) {
      return;
    }

    const buffer = terminal.buffer.active;
    const getCell = createBufferCellLookup(buffer);
    const isLineWrapped = (absoluteY: number): boolean =>
      buffer.getLine(absoluteY)?.isWrapped === true;

    // Only reposition within the wrapped line group of the current cursor —
    // that is the editable command line for typical shells.
    if (
      !isViewportCellOnCursorWrappedLine({
        targetRow: viewportCell.row,
        cursorRow: buffer.cursorY,
        baseY: buffer.baseY,
        isLineWrapped,
      })
    ) {
      return;
    }

    const sequence = buildMoveCursorToViewportCellSequence({
      targetCol: viewportCell.col,
      targetRow: viewportCell.row,
      cursorCol: buffer.cursorX,
      cursorRow: buffer.cursorY,
      cols: terminal.cols,
      applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
      horizontalOnly: buffer.type === "normal",
      baseY: buffer.baseY,
      getCell,
    });
    if (!sequence) {
      return;
    }

    // Click-to-move is a new edit generation (cursor no longer matches history).
    this.editHistory.clear();
    // wasUserInput true clears any residual selection and marks genuine input.
    this.injectTerminalInput(terminal, sequence);
  }

  /**
   * Record the character plain Backspace will remove so Cmd/Ctrl+Z can restore it.
   * Returns true when this is a plain Backspace we inspected (xterm should still
   * process the key — return true from the custom key handler).
   */
  private handleSingleBackspaceKey(event: KeyboardEvent, terminal: Terminal): boolean {
    if (event.key !== "Backspace") {
      return false;
    }
    // Only plain Backspace — modifiers keep shell bindings (word erase, etc.).
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }
    if (this.suppressInput) {
      return false;
    }
    if (terminal.modes.mouseTrackingMode !== "none") {
      return false;
    }
    // Selection path is handled separately.
    if (terminal.hasSelection()) {
      return false;
    }

    const buffer = terminal.buffer.active;
    if (buffer.baseY !== buffer.viewportY) {
      return false;
    }

    const getCell = createBufferCellLookup(buffer);
    const isLineWrapped = (absoluteY: number): boolean =>
      buffer.getLine(absoluteY)?.isWrapped === true;

    const char = resolveCharacterBeforeCursor({
      cursorCol: buffer.cursorX,
      cursorRow: buffer.cursorY,
      baseY: buffer.baseY,
      cols: terminal.cols,
      getCell,
      isLineWrapped,
    });
    if (char) {
      this.editHistory.pushBackspaceDeleted(char);
    }
    // Let xterm send Backspace to the shell.
    return true;
  }

  private handleSelectionDeleteKey(event: KeyboardEvent, terminal: Terminal): boolean {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return false;
    }
    // Only plain Backspace/Delete — modifiers keep their shell bindings
    // (e.g. Ctrl+Backspace word erase, Alt+Backspace).
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }
    if (this.suppressInput) {
      return false;
    }
    if (terminal.modes.mouseTrackingMode !== "none") {
      // Full-screen apps own the keyboard; don't invent edit sequences.
      return false;
    }
    if (!terminal.hasSelection()) {
      return false;
    }

    const selectionPosition = terminal.getSelectionPosition();
    if (!selectionPosition) {
      return false;
    }

    // Selection text may be empty after xterm trimRight (e.g. spaces-only).
    // Still attempt buffer-based delete using the position range.
    const selectionText = terminal.getSelection() ?? "";

    const buffer = terminal.buffer.active;
    // Only edit when the viewport is pinned to the live cursor line. Otherwise
    // selection y (ydisp-based) and cursor y (ybase-based) can disagree.
    if (buffer.baseY !== buffer.viewportY) {
      return false;
    }

    const getCell = createBufferCellLookup(buffer);
    const getLine = createBufferLineLookup(buffer);
    const isLineWrapped = (absoluteY: number): boolean =>
      buffer.getLine(absoluteY)?.isWrapped === true;

    // getSelectionPosition returns internal 0-based buffer coords (despite the
    // public d.ts saying 1-based — match runtime behavior, not the comment).
    let selectionStart = {
      x: selectionPosition.start.x,
      y: selectionPosition.start.y,
    };
    let selectionEnd = {
      x: selectionPosition.end.x,
      y: selectionPosition.end.y,
    };

    if (
      !isSelectionOnCursorWrappedLine({
        selectionStart,
        selectionEnd,
        cursorAbsY: buffer.baseY + buffer.cursorY,
        isLineWrapped,
      })
    ) {
      return false;
    }

    const sequence = buildDeleteSelectionSequence({
      selectionStart,
      selectionEnd,
      selectionText,
      cursorCol: buffer.cursorX,
      cursorRow: buffer.cursorY,
      baseY: buffer.baseY,
      cols: terminal.cols,
      rows: terminal.rows,
      applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
      horizontalOnly: buffer.type === "normal",
      getCell,
      deleteKey: event.key === "Delete" ? "Delete" : "Backspace",
    });
    if (!sequence) {
      return false;
    }

    // Snap before capturing undo text so the restored string matches what we erase.
    selectionStart = snapSelectionStartToGlyph({ position: selectionStart, getCell });
    selectionEnd = snapSelectionEndExclusiveToGlyph({
      position: selectionEnd,
      cols: terminal.cols,
      getCell,
    });
    const deletedText = resolveDeletedSelectionText({
      selectionText,
      start: selectionStart,
      end: selectionEnd,
      cols: terminal.cols,
      getLine,
    });

    event.preventDefault();
    event.stopPropagation();
    terminal.clearSelection();
    this.editHistory.pushDeleted(deletedText);
    this.injectTerminalInput(terminal, sequence);
    return true;
  }

  private remeasureFontMetrics(): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      const fontFamily = terminal.options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY;
      terminal.options.fontFamily = fontFamily === "monospace" ? "serif" : "monospace";
      terminal.options.fontFamily = fontFamily;
    } catch {
      // ignore
    }

    // Bundled Maple Mono finishes after open — re-stamp calt/liga and rebuild the
    // WebGL atlas so joined sequences rasterize with ligature glyphs, not the
    // fallback mono face measured at first open.
    if (this.ligaturesDesired) {
      this.applyLigatureFontFeatures(terminal);
      this.reinitWebglRenderer?.();
      this.refreshVisibleRows();
    }
  }

  private refreshVisibleRows(): void {
    const terminal = this.terminal;
    if (!terminal || terminal.rows <= 0) {
      return;
    }

    try {
      terminal.refresh(0, terminal.rows - 1);
    } catch {
      // ignore
    }
  }

  private collectThemeBackgroundElements(input: {
    root: HTMLDivElement;
    host: HTMLDivElement;
  }): HTMLElement[] {
    return [
      input.root,
      input.host,
      ...Array.from(
        input.host.querySelectorAll<HTMLElement>(".xterm, .xterm-screen, .xterm-viewport"),
      ),
    ];
  }

  private applyThemeBackground(theme: ITheme): void {
    const background = theme.background ?? "#0b0b0b";
    for (const element of this.themeBackgroundElements) {
      element.style.backgroundColor = background;
    }
  }

  unmount(): void {
    this.editHistory.clear();
    this.isInjectingEditSequence = false;
    this.releaseFindOutputAnchor();
    this.clearInFlightOutputTimeout();
    const inFlightOperation = this.inFlightOutputOperation;
    this.inFlightOutputOperation = null;
    if (inFlightOperation?.onCommitted) {
      inFlightOperation.onCommitted();
    }
    const pendingOperations = this.outputOperations.splice(0, this.outputOperations.length);
    for (const operation of pendingOperations) {
      operation.onCommitted?.();
    }
    for (const commit of Array.from(this.pendingWriteCommits)) {
      commit();
    }
    this.hasUngatedWrites = false;
    this.replayResize = null;

    this.cleanup?.();
    this.cleanup = null;
    if (window.__paseoTerminal === this.terminal) {
      window.__paseoTerminal = undefined;
    }
    this.terminal = null;
    this.searchAddon = null;
    this.findQuery = "";
    this.findResult = { resultIndex: -1, resultCount: 0 };
    this.fitAddon = null;
    // Joiner is deregistered in cleanup via disableLigatures; drop the id ref.
    this.ligatureJoinerId = undefined;
    this.searchAddon = null;
    this.fitAndEmitResize = null;
    this.lastSize = null;
    this.hasEmittedClaimedResize = false;
    this.themeBackgroundElements = [];
    this.suppressInput = false;
    this.inputModeDecoder.decode();
    this.inputModeTracker.reset();
    this.emitInputModeChange();
  }

  // A barrier op mutates terminal geometry or toggles suppressInput and must apply in
  // isolation: clear/snapshot reset/resize the terminal, and any write carrying
  // suppressInput flips input handling around the commit. Plain writes are fast-pathed.
  private isBarrierOperation(operation: TerminalOutputOperation): boolean {
    return operation.type !== "write" || Boolean(operation.suppressInput);
  }

  private processOutputQueue(): void {
    if (this.inFlightOutputOperation) {
      return;
    }

    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    // Fast path: drain contiguous plain writes back-to-back without waiting for each
    // write's completion callback. xterm buffers internally and parses in submission
    // order, so serializing one frame per parse tick only adds latency under burst.
    while (this.outputOperations[0] && !this.isBarrierOperation(this.outputOperations[0])) {
      const writeOperation = this.outputOperations.shift();
      if (!writeOperation) {
        break;
      }
      this.submitWrite(terminal, writeOperation);
    }

    const operation = this.outputOperations.shift();
    if (!operation) {
      return;
    }

    // The next op is a barrier. Before clear()/reset()/resize() touches the terminal, any
    // ungated plain writes still parsing in xterm's buffer must finish — otherwise a
    // synchronous reset could interleave with them. When none are ungated (mount, or right
    // after another barrier) there is nothing to wait for, so apply the barrier at once.
    if (!this.hasUngatedWrites) {
      this.startBarrierOperation(terminal, operation);
      return;
    }
    // Otherwise a zero-length sentinel write commits after every outstanding write, so
    // waiting on its callback gates the barrier behind them. Plain writes never wait.
    let started = false;
    const startBarrier = () => {
      // unmount() clears the in-flight op and disposes the terminal while we wait on the
      // sentinel; bail if either changed so we don't reset/resize a torn-down terminal.
      if (started || this.inFlightOutputOperation !== operation || this.terminal !== terminal) {
        return;
      }
      started = true;
      this.clearInFlightOutputTimeout();
      this.startBarrierOperation(terminal, operation);
    };
    this.inFlightOutputOperation = operation;
    this.inFlightOutputOperationTimeout = setTimeout(startBarrier, OUTPUT_OPERATION_TIMEOUT_MS);
    try {
      terminal.write(EMPTY_TERMINAL_OUTPUT, startBarrier);
    } catch {
      startBarrier();
    }
  }

  private submitWrite(terminal: Terminal, operation: TerminalOutputOperation): void {
    this.preserveFindViewport(terminal);
    // Synchronous per-write tracking must run in frame order; doing it here in the drain
    // loop preserves that ordering even though the writes are submitted without waiting.
    const text = this.inputModeDecoder.decode(operation.data, { stream: true });
    const result = this.inputModeTracker.feed(text);
    if (result.changed) {
      this.emitInputModeChange();
    }
    this.hasUngatedWrites = true;
    const onCommitted = operation.onCommitted;
    const commit = () => {
      if (!this.pendingWriteCommits.delete(commit)) {
        return;
      }
      onCommitted?.();
    };
    this.pendingWriteCommits.add(commit);
    try {
      terminal.write(operation.data, commit);
    } catch {
      commit();
    }
  }

  private startBarrierOperation(terminal: Terminal, operation: TerminalOutputOperation): void {
    this.inFlightOutputOperation = operation;
    // This barrier gates every write submitted before it (the sentinel guaranteed they
    // parsed, or there were none), so the next barrier can skip the sentinel until the
    // next write arrives.
    this.hasUngatedWrites = false;
    const previousSuppressInput = this.suppressInput;
    if (operation.suppressInput) {
      this.suppressInput = Boolean(operation.suppressInput);
    }
    const finalizeOperation = (expectedOperation: TerminalOutputOperation) => {
      if (this.inFlightOutputOperation !== expectedOperation) {
        return;
      }
      this.inFlightOutputOperation = null;
      this.clearInFlightOutputTimeout();
      this.suppressInput = previousSuppressInput;
      expectedOperation.onCommitted?.();
      this.processOutputQueue();
    };

    if (operation.type === "fit") {
      // xterm resize flushes its write buffer synchronously. Leave the parser's
      // commit callback before fitting, or that flush consumes the next write.
      queueMicrotask(() => {
        if (this.inFlightOutputOperation !== operation || this.terminal !== terminal) return;
        const resize = this.replayResize ?? { shouldClaim: false };
        this.replayResize = null;
        this.fitAndEmitResize?.(resize);
        finalizeOperation(operation);
      });
      return;
    }

    if (operation.type === "clear") {
      this.inputModeDecoder.decode();
      this.inputModeTracker.reset();
      this.emitInputModeChange();
      terminal.reset();
      if (!this.replayResize) {
        finalizeOperation(operation);
        return;
      }
      queueMicrotask(() => {
        if (this.inFlightOutputOperation !== operation || this.terminal !== terminal) return;
        const resize = this.replayResize ?? { shouldClaim: false };
        this.replayResize = null;
        this.fitAndEmitResize?.(resize);
        finalizeOperation(operation);
      });
      return;
    }

    if (operation.type === "snapshot") {
      this.replayResize ??= { shouldClaim: false };
      this.inputModeDecoder.decode();
      this.inputModeTracker.reset();
      this.emitInputModeChange();
      try {
        if (
          typeof operation.cols === "number" &&
          typeof operation.rows === "number" &&
          (terminal.cols !== operation.cols || terminal.rows !== operation.rows)
        ) {
          terminal.resize(operation.cols, operation.rows);
        }
      } catch {
        finalizeOperation(operation);
        return;
      }
    }

    const data = operation.data;
    if (operation.type === "write") {
      const text = this.inputModeDecoder.decode(data, { stream: true });
      const result = this.inputModeTracker.feed(text);
      if (result.changed) {
        this.emitInputModeChange();
      }
    }
    this.inFlightOutputOperationTimeout = setTimeout(() => {
      finalizeOperation(operation);
    }, OUTPUT_OPERATION_TIMEOUT_MS);

    try {
      terminal.write(data, () => {
        finalizeOperation(operation);
      });
    } catch {
      finalizeOperation(operation);
    }
  }

  private clearInFlightOutputTimeout(): void {
    if (!this.inFlightOutputOperationTimeout) {
      return;
    }
    clearTimeout(this.inFlightOutputOperationTimeout);
    this.inFlightOutputOperationTimeout = null;
  }

  private emitInputModeChange(): void {
    const state = this.inputModeTracker.getState();
    if (terminalInputModeStatesEqual(state, this.lastInputModeState)) {
      return;
    }
    this.lastInputModeState = state;
    this.callbacks.onInputModeChange?.(state);
  }

  private applyDocumentBoundsStyles(input: { root: HTMLDivElement }): () => void {
    const documentElement = document.documentElement;
    const body = document.body;
    const rootContainer = input.root.parentElement;

    const previousDocumentElementOverflow = documentElement.style.overflow;
    const previousDocumentElementWidth = documentElement.style.width;
    const previousDocumentElementHeight = documentElement.style.height;
    const previousDocumentElementTextSizeAdjust =
      documentElement.style.getPropertyValue("text-size-adjust");
    const previousDocumentElementWebkitTextSizeAdjust = documentElement.style.getPropertyValue(
      "-webkit-text-size-adjust",
    );

    const previousBodyOverflow = body.style.overflow;
    const previousBodyWidth = body.style.width;
    const previousBodyHeight = body.style.height;
    const previousBodyMargin = body.style.margin;
    const previousBodyPadding = body.style.padding;
    const previousBodyTextSizeAdjust = body.style.getPropertyValue("text-size-adjust");
    const previousBodyWebkitTextSizeAdjust = body.style.getPropertyValue(
      "-webkit-text-size-adjust",
    );

    const previousRootOverflow = rootContainer?.style.overflow ?? "";
    const previousRootWidth = rootContainer?.style.width ?? "";
    const previousRootHeight = rootContainer?.style.height ?? "";

    documentElement.style.overflow = "hidden";
    documentElement.style.width = "100%";
    documentElement.style.height = "100%";
    documentElement.style.setProperty("text-size-adjust", "100%");
    documentElement.style.setProperty("-webkit-text-size-adjust", "100%");

    body.style.overflow = "hidden";
    body.style.width = "100%";
    body.style.height = "100%";
    body.style.margin = "0";
    body.style.padding = "0";
    body.style.setProperty("text-size-adjust", "100%");
    body.style.setProperty("-webkit-text-size-adjust", "100%");

    if (rootContainer) {
      rootContainer.style.overflow = "hidden";
      rootContainer.style.width = "100%";
      rootContainer.style.height = "100%";
    }

    return () => {
      documentElement.style.overflow = previousDocumentElementOverflow;
      documentElement.style.width = previousDocumentElementWidth;
      documentElement.style.height = previousDocumentElementHeight;
      documentElement.style.setProperty("text-size-adjust", previousDocumentElementTextSizeAdjust);
      documentElement.style.setProperty(
        "-webkit-text-size-adjust",
        previousDocumentElementWebkitTextSizeAdjust,
      );

      body.style.overflow = previousBodyOverflow;
      body.style.width = previousBodyWidth;
      body.style.height = previousBodyHeight;
      body.style.margin = previousBodyMargin;
      body.style.padding = previousBodyPadding;
      body.style.setProperty("text-size-adjust", previousBodyTextSizeAdjust);
      body.style.setProperty("-webkit-text-size-adjust", previousBodyWebkitTextSizeAdjust);

      if (rootContainer) {
        rootContainer.style.overflow = previousRootOverflow;
        rootContainer.style.width = previousRootWidth;
        rootContainer.style.height = previousRootHeight;
      }
    };
  }

  private applyViewportTouchStyles(input: { host: HTMLDivElement }): () => void {
    const viewportElement = input.host.querySelector<HTMLElement>(".xterm-viewport");

    const previousViewportOverscroll = viewportElement?.style.overscrollBehavior ?? "";
    const previousViewportTouchAction = viewportElement?.style.touchAction ?? "";
    const previousViewportOverflowY = viewportElement?.style.overflowY ?? "";
    const previousViewportOverflowX = viewportElement?.style.overflowX ?? "";
    const previousViewportPointerEvents = viewportElement?.style.pointerEvents ?? "";
    const previousViewportWebkitOverflowScrolling =
      viewportElement?.style.getPropertyValue("-webkit-overflow-scrolling") ?? "";
    if (viewportElement) {
      viewportElement.style.overscrollBehavior = "none";
      viewportElement.style.touchAction = "pan-y";
      viewportElement.style.overflowY = "auto";
      viewportElement.style.overflowX = "hidden";
      viewportElement.style.pointerEvents = "auto";
      viewportElement.style.setProperty("-webkit-overflow-scrolling", "touch");
    }

    return () => {
      if (viewportElement) {
        viewportElement.style.overscrollBehavior = previousViewportOverscroll;
        viewportElement.style.touchAction = previousViewportTouchAction;
        viewportElement.style.overflowY = previousViewportOverflowY;
        viewportElement.style.overflowX = previousViewportOverflowX;
        viewportElement.style.pointerEvents = previousViewportPointerEvents;
        viewportElement.style.setProperty(
          "-webkit-overflow-scrolling",
          previousViewportWebkitOverflowScrolling,
        );
      }
    };
  }

  private setupTouchScrollHandlers(input: {
    root: HTMLDivElement;
    host: HTMLDivElement;
    terminal: Terminal;
  }): () => void {
    let touchScrollRemainderPx = 0;
    const measuredLineHeight =
      input.host.querySelector<HTMLElement>(".xterm-rows > div")?.getBoundingClientRect().height ??
      0;
    const touchScrollLineHeightPx =
      measuredLineHeight > 0 ? measuredLineHeight : DEFAULT_TOUCH_SCROLL_LINE_HEIGHT_PX;

    const activeTouch = {
      identifier: -1,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      mode: null as "vertical" | "horizontal" | null,
    };

    const touchStartHandler = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchScrollRemainderPx = 0;
        activeTouch.identifier = -1;
        activeTouch.mode = null;
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        touchScrollRemainderPx = 0;
        activeTouch.identifier = -1;
        activeTouch.mode = null;
        return;
      }

      activeTouch.identifier = touch.identifier;
      activeTouch.startX = touch.clientX;
      activeTouch.startY = touch.clientY;
      activeTouch.lastX = touch.clientX;
      activeTouch.lastY = touch.clientY;
      activeTouch.mode = null;
      touchScrollRemainderPx = 0;
    };

    const touchMoveHandler = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === activeTouch.identifier,
      );
      if (!touch) {
        return;
      }

      const totalDeltaX = touch.clientX - activeTouch.startX;
      const totalDeltaY = touch.clientY - activeTouch.startY;
      if (activeTouch.mode === null) {
        const absX = Math.abs(totalDeltaX);
        const absY = Math.abs(totalDeltaY);
        if (absX > 8 || absY > 8) {
          activeTouch.mode = absY >= absX ? "vertical" : "horizontal";
        }
      }

      const deltaY = touch.clientY - activeTouch.lastY;
      activeTouch.lastX = touch.clientX;
      activeTouch.lastY = touch.clientY;

      if (activeTouch.mode !== "vertical") {
        return;
      }

      touchScrollRemainderPx += deltaY;
      const lineDelta = Math.trunc(touchScrollRemainderPx / touchScrollLineHeightPx);
      if (lineDelta !== 0) {
        input.terminal.scrollLines(-lineDelta);
        touchScrollRemainderPx -= lineDelta * touchScrollLineHeightPx;
      }

      event.preventDefault();
    };

    const touchEndHandler = (event: TouchEvent) => {
      const activeTouchEnded = Array.from(event.changedTouches).some(
        (touch) => touch.identifier === activeTouch.identifier,
      );
      if (activeTouchEnded || event.touches.length === 0) {
        touchScrollRemainderPx = 0;
        activeTouch.identifier = -1;
        activeTouch.mode = null;
      }
    };

    const touchCancelHandler = () => {
      touchScrollRemainderPx = 0;
      activeTouch.identifier = -1;
      activeTouch.mode = null;
    };

    input.root.addEventListener("touchstart", touchStartHandler, { passive: true });
    input.root.addEventListener("touchmove", touchMoveHandler, { passive: false });
    input.root.addEventListener("touchend", touchEndHandler, { passive: true });
    input.root.addEventListener("touchcancel", touchCancelHandler, { passive: true });

    return () => {
      input.root.removeEventListener("touchstart", touchStartHandler);
      input.root.removeEventListener("touchmove", touchMoveHandler);
      input.root.removeEventListener("touchend", touchEndHandler);
      input.root.removeEventListener("touchcancel", touchCancelHandler);
    };
  }
}
