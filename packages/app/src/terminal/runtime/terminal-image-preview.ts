/**
 * Click-to-preview helpers for images rendered by @xterm/addon-image
 * (Sixel / iTerm2 IIP / Kitty graphics).
 *
 * The addon stores the original canvas on extended cell attributes; we hit-test
 * buffer cells under the mouse and open a simple DOM lightbox so users can
 * inspect the full-resolution image without leaving the terminal.
 */

export interface TerminalImageSource {
  getImageAtBufferCell: (x: number, y: number) => HTMLCanvasElement | undefined;
}

export interface TerminalImageBufferCoords {
  /** 0-based column. */
  x: number;
  /** Absolute buffer line index (not viewport-relative). */
  y: number;
}

/** Resolve absolute buffer coordinates from a viewport cell + viewportY. */
export function resolveTerminalImageBufferCoords(input: {
  viewportCol: number;
  viewportRow: number;
  viewportY: number;
  cols: number;
  rows: number;
}): TerminalImageBufferCoords | null {
  const { viewportCol, viewportRow, viewportY, cols, rows } = input;
  if (
    !Number.isFinite(viewportCol) ||
    !Number.isFinite(viewportRow) ||
    !Number.isFinite(viewportY) ||
    viewportCol < 0 ||
    viewportRow < 0 ||
    viewportCol >= cols ||
    viewportRow >= rows
  ) {
    return null;
  }
  return {
    x: viewportCol,
    y: viewportY + viewportRow,
  };
}

export function getTerminalImageAtViewportCell(input: {
  imageSource: TerminalImageSource | null | undefined;
  viewportCol: number;
  viewportRow: number;
  viewportY: number;
  cols: number;
  rows: number;
}): HTMLCanvasElement | undefined {
  if (!input.imageSource) {
    return undefined;
  }
  const coords = resolveTerminalImageBufferCoords(input);
  if (!coords) {
    return undefined;
  }
  try {
    return input.imageSource.getImageAtBufferCell(coords.x, coords.y);
  } catch {
    return undefined;
  }
}

/**
 * Whether a primary click should open the image lightbox.
 * Unlike cursor repositioning, scrollback clicks are allowed so users can
 * inspect images that have scrolled up.
 */
export function shouldOpenTerminalImagePreview(input: {
  button: number;
  detail: number;
  elapsedMs: number;
  hasMeaningfulSelection: boolean;
  mouseTrackingMode: string;
  suppressInput: boolean;
  hasImage: boolean;
  maxClickMs?: number;
}): boolean {
  const maxClickMs = input.maxClickMs ?? 500;
  if (!input.hasImage) {
    return false;
  }
  if (input.suppressInput) {
    return false;
  }
  if (input.button !== 0) {
    return false;
  }
  if (input.detail !== 1) {
    return false;
  }
  if (input.elapsedMs >= maxClickMs) {
    return false;
  }
  if (input.hasMeaningfulSelection) {
    return false;
  }
  // When an app is tracking the mouse, leave the click to the app.
  if (input.mouseTrackingMode !== "none") {
    return false;
  }
  return true;
}

export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export interface TerminalImageLightboxHandle {
  close: () => void;
}

/**
 * Mount a full-screen image lightbox on `root`. Esc / backdrop / close button dismiss.
 * Returns a dispose handle; calling close twice is a no-op.
 */
export function openTerminalImageLightbox(input: {
  root: HTMLElement;
  dataUrl: string;
  closeLabel?: string;
}): TerminalImageLightboxHandle {
  const closeLabel = input.closeLabel ?? "Close image preview";
  let closed = false;

  const overlay = document.createElement("div");
  overlay.dataset.terminalImageLightbox = "true";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Terminal image preview");
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    zIndex: "1000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.78)",
    cursor: "zoom-out",
    // Isolate from terminal focus/scroll.
    touchAction: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const img = document.createElement("img");
  img.src = input.dataUrl;
  img.alt = "Terminal image";
  img.draggable = false;
  Object.assign(img.style, {
    maxWidth: "min(96%, 1600px)",
    maxHeight: "min(92%, 100%)",
    objectFit: "contain",
    borderRadius: "6px",
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
    cursor: "default",
    userSelect: "none",
    // Prevent the image from eating the backdrop click when the user intends
    // to dismiss by clicking near the edges of a small image.
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", closeLabel);
  closeButton.textContent = "×";
  Object.assign(closeButton.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    width: "36px",
    height: "36px",
    border: "none",
    borderRadius: "18px",
    background: "rgba(30, 30, 30, 0.85)",
    color: "#f5f5f5",
    fontSize: "22px",
    lineHeight: "36px",
    cursor: "pointer",
    padding: "0",
  } satisfies Partial<CSSStyleDeclaration>);

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  // Don't close when clicking the image itself (user may want to inspect).
  img.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  document.addEventListener("keydown", onKeyDown, true);
  overlay.appendChild(img);
  overlay.appendChild(closeButton);

  // Ensure the host can position the overlay.
  const previousPosition = input.root.style.position;
  if (!previousPosition || previousPosition === "static") {
    input.root.style.position = "relative";
  }
  input.root.appendChild(overlay);

  return { close };
}
