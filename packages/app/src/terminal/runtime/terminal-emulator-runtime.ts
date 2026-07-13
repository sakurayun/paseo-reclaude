import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions, ISearchResultChangeEvent } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { LigaturesAddon } from "@xterm/addon-ligatures/lib/addon-ligatures.mjs";
import { Terminal, type IDisposable, type ITheme } from "@xterm/xterm";
import type { TerminalState } from "@getpaseo/protocol/messages";
import {
  type TerminalInputModeState,
  TerminalInputModeTracker,
  terminalInputModeStatesEqual,
} from "@getpaseo/protocol/terminal-input-mode";
import {
  type PendingTerminalModifiers,
  isAppleHandheldPlatform,
  isTerminalModifierDomKey,
  mergeTerminalModifiers,
  normalizeDomTerminalKey,
  normalizeTerminalTransportKey,
  shouldInterceptDomTerminalKey,
} from "@/utils/terminal-keys";
import { renderTerminalSnapshotToAnsi } from "./terminal-snapshot";
import {
  createTerminalLocalFileLinkProvider,
  type TerminalLocalFileLinkSource,
  type TerminalLocalFileLinkTarget,
} from "../local-links/terminal-local-link-provider";

export type TerminalOutputData = Uint8Array;

export interface TerminalEmulatorRuntimeMountInput {
  root: HTMLDivElement;
  host: HTMLDivElement;
  initialSnapshot: TerminalState | null;
  scrollback: number;
  theme: ITheme;
  fontFamily?: string;
  fontSize?: number;
  letterSpacing?: number;
  ligaturesEnabled?: boolean;
}

export interface TerminalEmulatorRuntimeCallbacks {
  onInput?: (data: string) => Promise<void> | void;
  onResize?: (input: { rows: number; cols: number; shouldClaim: boolean }) => Promise<void> | void;
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
}

export type TerminalFontZoomDirection = "in" | "out" | "reset";

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
  disconnectResizeObserver: () => void;
  removeWheelZoomListener: () => void;
  removeWindowResize: () => void;
  removeWindowFocus: () => void;
  removeDocumentVisibilityChange: () => void;
  removeVisualViewportResize: () => void;
  clearFitTimeouts: () => void;
  removeFontListeners: () => void;
  removeTouchListeners: () => void;
  restoreDocumentStyles: () => void;
  restoreViewportStyles: () => void;
  disposeFitAddon: () => void;
  disposeWebglAddon: () => void;
  disposeTerminal: () => void;
}

interface TerminalOutputOperation {
  type: "write" | "clear" | "snapshot";
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

const isMac =
  typeof navigator !== "undefined" &&
  (/Macintosh|Mac OS/i.test(navigator.userAgent ?? "") ||
    /Mac/i.test((navigator as Navigator & { platform?: string }).platform ?? ""));

const isAppleHandheld =
  typeof navigator !== "undefined" &&
  isAppleHandheldPlatform({
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { platform?: string }).platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });

const DEFAULT_TOUCH_SCROLL_LINE_HEIGHT_PX = 18;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
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

export class TerminalEmulatorRuntime {
  private callbacks: TerminalEmulatorRuntimeCallbacks = {};
  private pendingModifiers: PendingTerminalModifiers = {
    ctrl: false,
    shift: false,
    alt: false,
  };
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ligaturesAddon: LigaturesAddon | null = null;
  private searchAddon: SearchAddon | null = null;
  private fitAndEmitResize: ((input?: { force?: boolean; shouldClaim?: boolean }) => void) | null =
    null;
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

  private handleVisibilityRestore = (): void => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    this.fitAndEmitResize?.({ force: true, shouldClaim: false });
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        this.fitAndEmitResize?.({ force: true, shouldClaim: false });
      });
    }
  };

  setCallbacks(input: { callbacks: TerminalEmulatorRuntimeCallbacks }): void {
    this.callbacks = input.callbacks;
  }

  setPendingModifiers(input: { pendingModifiers: PendingTerminalModifiers }): void {
    this.pendingModifiers = input.pendingModifiers;
  }

  mount(input: TerminalEmulatorRuntimeMountInput): void {
    this.unmount();

    input.host.innerHTML = "";
    this.lastSize = null;
    this.hasEmittedClaimedResize = false;
    this.inputModeTracker.reset();
    this.emitInputModeChange();

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: resolveTerminalFontFamily(input.fontFamily),
      fontSize: resolveTerminalFontSize(input.fontSize),
      letterSpacing: resolveTerminalLetterSpacing(input.letterSpacing),
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
    const searchAddon = new SearchAddon({ highlightLimit: 20_000 });
    const unicode11Addon = new Unicode11Addon();
    let webglAddon: WebglAddon | null = null;
    let imageAddon: ImageAddon | null = null;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void this.callbacks.onOpenExternalUrl?.(uri);
      }),
    );
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
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new ClipboardAddon());
    terminal.open(input.host);
    // LigaturesAddon.activate() throws when terminal.element is missing, so it must load
    // after open() — loading earlier used to fail silently and ligatures never rendered.
    if (input.ligaturesEnabled !== false) {
      this.loadLigaturesAddon(terminal);
    }
    this.themeBackgroundElements = this.collectThemeBackgroundElements(input);
    this.applyThemeBackground(input.theme);
    try {
      terminal.unicode.activeVersion = "11";
    } catch {
      // Ignore if unicode API isn't available in this build/runtime.
    }

    const disposeImageAddon = (): void => {
      try {
        imageAddon?.dispose();
      } catch {
        // ignore
      }
      imageAddon = null;
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
      disposeImageAddon();
      // WebGL and DOM renderers can have different cell dimensions.
      this.fitAndEmitResize?.({ force: true, shouldClaim: false });
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
      terminal.parser.registerCsiHandler({ final: "n" }, () => true);
      terminal.parser.registerCsiHandler({ prefix: "?", final: "n" }, () => true);
      terminal.parser.registerCsiHandler({ final: "R" }, () => true);
      terminal.parser.registerCsiHandler({ intermediates: "$", final: "p" }, () => true);
      terminal.parser.registerCsiHandler(
        { prefix: "?", intermediates: "$", final: "p" },
        () => true,
      );
      for (const code of [10, 11, 12]) {
        terminal.parser.registerOscHandler(code, (data) => data.trim() === "?");
      }
    };
    registerProtocolQuerySuppression();

    let webglAddonRaf: number | null = requestAnimationFrame(() => {
      webglAddonRaf = null;
      try {
        disposeWebglRenderer();
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          disposeWebglRenderer();
        });
        terminal.loadAddon(webglAddon);
        imageAddon = new ImageAddon();
        terminal.loadAddon(imageAddon);
        registerProtocolQuerySuppression();
        this.fitAndEmitResize?.({ force: true, shouldClaim: false });
      } catch {
        disposeWebglRenderer();
      }
    });

    const restoreDocumentStyles = this.applyDocumentBoundsStyles({
      root: input.root,
    });
    const restoreViewportStyles = this.applyViewportTouchStyles({
      host: input.host,
    });

    this.terminal = terminal;
    this.fitAddon = fitAddon;
    this.searchAddon = searchAddon;
    window.__paseoTerminal = terminal;

    const fitAndEmitResize = (resizeInput?: { force?: boolean; shouldClaim?: boolean }): void => {
      const force = resizeInput?.force ?? false;
      const shouldClaim = resizeInput?.shouldClaim ?? true;
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
      const sameSize =
        previous !== null && previous.rows === nextRows && previous.cols === nextCols;
      // The mount-time forced fit is unclaimed by design, but it swallows the
      // size delta — a later claim-eligible fit (e.g. ResizeObserver's initial
      // fire) would then bail on "no change" and the daemon/remote pty would
      // stay at its creation size forever (SSH terminals start at 80x24). Let
      // the first claimed fit through even without a delta; the pane dedupes
      // the actual sends.
      if (!force && sameSize && (!shouldClaim || this.hasEmittedClaimedResize)) {
        return;
      }

      this.lastSize = { rows: nextRows, cols: nextCols };
      if (shouldClaim) {
        this.hasEmittedClaimedResize = true;
      }
      this.refreshVisibleRows();
      this.callbacks.onResize?.({
        rows: nextRows,
        cols: nextCols,
        shouldClaim,
      });
    };
    this.fitAndEmitResize = fitAndEmitResize;

    fitAndEmitResize({ force: true, shouldClaim: false });

    const inputDisposable = terminal.onData((data) => {
      if (this.suppressInput) {
        return;
      }
      this.callbacks.onInput?.(data);
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.isComposing) {
        return true;
      }

      if (this.handleFontZoomChord(event)) {
        return false;
      }

      if (!isMac && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();

        // Ctrl+C: copy selection to clipboard if text is selected, otherwise let xterm send SIGINT
        if (key === "c" && terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection());
          return false;
        }

        // Ctrl+V: paste from clipboard into terminal
        if (key === "v") {
          event.preventDefault();
          void navigator.clipboard.readText().then((text) => {
            if (text) {
              terminal.paste(text);
            }
            return;
          });
          return false;
        }

        return true;
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
    });

    const removeTouchListeners = this.setupTouchScrollHandlers({
      root: input.root,
      host: input.host,
      terminal,
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAndEmitResize({ shouldClaim: true });
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

    const windowResizeHandler = () => fitAndEmitResize({ shouldClaim: true });
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
    const visualViewportResizeHandler = () => fitAndEmitResize({ shouldClaim: true });
    visualViewport?.addEventListener("resize", visualViewportResizeHandler);

    const fitTimeouts = FIT_TIMEOUT_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => {
        fitAndEmitResize({ force: true, shouldClaim: false });
      }, delayMs),
    );

    const fontSet = document.fonts;
    const fontReadyHandler = () => {
      this.remeasureFontMetrics();
      fitAndEmitResize({ force: true, shouldClaim: false });
    };
    fontSet?.addEventListener?.("loadingdone", fontReadyHandler);
    void fontSet?.ready
      .then(() => {
        fontReadyHandler();
        return;
      })
      .catch(() => {
        // no-op
      });

    window.setTimeout(() => {
      fitAndEmitResize({ force: true, shouldClaim: false });
    }, 0);

    if (input.initialSnapshot) {
      this.renderSnapshot({ state: input.initialSnapshot });
    }

    this.processOutputQueue();

    const disposables: TerminalEmulatorRuntimeDisposables = {
      disposeInput: () => {
        inputDisposable.dispose();
      },
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
      disposables.disposeInput();
      disposables.disconnectResizeObserver();
      disposables.removeWheelZoomListener();
      disposables.removeWindowResize();
      disposables.removeWindowFocus();
      disposables.removeDocumentVisibilityChange();
      disposables.removeVisualViewportResize();
      disposables.clearFitTimeouts();
      disposables.removeFontListeners();
      disposables.removeTouchListeners();
      disposables.disposeFitAddon();
      disposables.disposeWebglAddon();
      disposables.disposeTerminal();
      disposables.restoreDocumentStyles();
      disposables.restoreViewportStyles();
    };
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

  renderSnapshot(input: { state: TerminalState | null; onCommitted?: () => void }): void {
    if (!input.state) {
      this.clear(input);
      return;
    }
    this.restoreOutput({
      data: encodeTerminalOutput(renderTerminalSnapshotToAnsi(input.state)),
      rows: input.state.rows,
      cols: input.state.cols,
      ...(input.onCommitted ? { onCommitted: input.onCommitted } : {}),
    });
  }

  restoreOutput(input: {
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

  resize(input?: { force?: boolean; shouldClaim?: boolean }): void {
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

    this.fitAndEmitResize?.({ force: true });
    this.refreshVisibleRows();
  }

  setLetterSpacing(input: { letterSpacing?: number }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    try {
      terminal.options.letterSpacing = resolveTerminalLetterSpacing(input.letterSpacing);
    } catch {
      // ignore
      return;
    }

    // Cell width changed, so the column count the grid can hold changes too.
    this.fitAndEmitResize?.({ force: true });
    this.refreshVisibleRows();
  }

  setLigatures(input: { enabled: boolean }): void {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }
    if (input.enabled) {
      this.loadLigaturesAddon(terminal);
    } else {
      this.disposeLigaturesAddon();
    }
    this.refreshVisibleRows();
  }

  private loadLigaturesAddon(terminal: Terminal): void {
    if (this.ligaturesAddon) {
      return;
    }
    try {
      const addon = new LigaturesAddon();
      terminal.loadAddon(addon);
      this.ligaturesAddon = addon;
    } catch {
      // Ligatures require Font Access API or compatible environment
    }
  }

  private disposeLigaturesAddon(): void {
    if (!this.ligaturesAddon) {
      return;
    }
    try {
      this.ligaturesAddon.dispose();
    } catch {
      // ignore
    }
    this.ligaturesAddon = null;
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

  paste(text: string): void {
    this.terminal?.paste(text);
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

    this.cleanup?.();
    this.cleanup = null;
    if (window.__paseoTerminal === this.terminal) {
      window.__paseoTerminal = undefined;
    }
    this.terminal = null;
    this.fitAddon = null;
    // The terminal dispose (via cleanup) tears down loaded addons; just drop the refs.
    this.ligaturesAddon = null;
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
    // Synchronous per-write tracking must run in frame order; doing it here in the drain
    // loop preserves that ordering even though the writes are submitted without waiting.
    const text = this.inputModeDecoder.decode(operation.data, { stream: true });
    const result = this.inputModeTracker.feed(text);
    if (result.changed) {
      this.emitInputModeChange();
    }
    this.hasUngatedWrites = true;
    const onCommitted = operation.onCommitted;
    if (!onCommitted) {
      try {
        terminal.write(operation.data);
      } catch {
        // Match existing behavior: a failed write still proceeds with no commit callback.
      }
      return;
    }
    const commit = () => {
      if (!this.pendingWriteCommits.delete(commit)) {
        return;
      }
      onCommitted();
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

    if (operation.type === "clear") {
      this.inputModeDecoder.decode();
      this.inputModeTracker.reset();
      this.emitInputModeChange();
      terminal.reset();
      finalizeOperation(operation);
      return;
    }

    if (operation.type === "snapshot") {
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
