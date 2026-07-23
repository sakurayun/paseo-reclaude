/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  canvasToPngDataUrl,
  getTerminalImageAtViewportCell,
  openTerminalImageLightbox,
  resolveTerminalImageBufferCoords,
  shouldOpenTerminalImagePreview,
} from "./terminal-image-preview";

describe("resolveTerminalImageBufferCoords", () => {
  it("maps viewport cells to absolute buffer lines", () => {
    expect(
      resolveTerminalImageBufferCoords({
        viewportCol: 3,
        viewportRow: 2,
        viewportY: 100,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ x: 3, y: 102 });
  });

  it("rejects out-of-bounds cells", () => {
    expect(
      resolveTerminalImageBufferCoords({
        viewportCol: 80,
        viewportRow: 0,
        viewportY: 0,
        cols: 80,
        rows: 24,
      }),
    ).toBeNull();
  });
});

describe("getTerminalImageAtViewportCell", () => {
  it("returns undefined without an image source", () => {
    expect(
      getTerminalImageAtViewportCell({
        imageSource: null,
        viewportCol: 0,
        viewportRow: 0,
        viewportY: 0,
        cols: 80,
        rows: 24,
      }),
    ).toBeUndefined();
  });

  it("queries the image source with absolute buffer coordinates", () => {
    const canvas = {} as HTMLCanvasElement;
    const getImageAtBufferCell = vi.fn().mockReturnValue(canvas);
    expect(
      getTerminalImageAtViewportCell({
        imageSource: { getImageAtBufferCell },
        viewportCol: 4,
        viewportRow: 1,
        viewportY: 50,
        cols: 80,
        rows: 24,
      }),
    ).toBe(canvas);
    expect(getImageAtBufferCell).toHaveBeenCalledWith(4, 51);
  });

  it("swallows source errors", () => {
    expect(
      getTerminalImageAtViewportCell({
        imageSource: {
          getImageAtBufferCell: () => {
            throw new Error("boom");
          },
        },
        viewportCol: 0,
        viewportRow: 0,
        viewportY: 0,
        cols: 80,
        rows: 24,
      }),
    ).toBeUndefined();
  });
});

describe("shouldOpenTerminalImagePreview", () => {
  const base = {
    button: 0,
    detail: 1,
    elapsedMs: 80,
    hasMeaningfulSelection: false,
    mouseTrackingMode: "none",
    suppressInput: false,
    hasImage: true,
  };

  it("accepts a plain primary click on an image", () => {
    expect(shouldOpenTerminalImagePreview(base)).toBe(true);
  });

  it("rejects non-image cells and interaction conflicts", () => {
    expect(shouldOpenTerminalImagePreview({ ...base, hasImage: false })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, hasMeaningfulSelection: true })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, mouseTrackingMode: "vt200" })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, button: 2 })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, detail: 2 })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, elapsedMs: 600 })).toBe(false);
    expect(shouldOpenTerminalImagePreview({ ...base, suppressInput: true })).toBe(false);
  });
});

describe("canvasToPngDataUrl", () => {
  it("returns a png data url from canvas.toDataURL", () => {
    const canvas = {
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,AAA"),
    } as unknown as HTMLCanvasElement;
    expect(canvasToPngDataUrl(canvas)).toBe("data:image/png;base64,AAA");
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("returns null when toDataURL throws", () => {
    const canvas = {
      toDataURL: () => {
        throw new Error("tainted");
      },
    } as unknown as HTMLCanvasElement;
    expect(canvasToPngDataUrl(canvas)).toBeNull();
  });
});

describe("openTerminalImageLightbox", () => {
  it("mounts an overlay and closes on Escape / close button / backdrop", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    openTerminalImageLightbox({
      root,
      dataUrl: "data:image/png;base64,AAA",
      closeLabel: "Close preview",
    });

    const overlay = root.querySelector("[data-terminal-image-lightbox='true']");
    expect(overlay).not.toBeNull();
    expect(root.style.position).toBe("relative");

    const img = overlay?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");

    const closeButton = overlay?.querySelector("button");
    expect(closeButton?.getAttribute("aria-label")).toBe("Close preview");
    closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-terminal-image-lightbox='true']")).toBeNull();

    openTerminalImageLightbox({
      root,
      dataUrl: "data:image/png;base64,BBB",
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector("[data-terminal-image-lightbox='true']")).toBeNull();

    openTerminalImageLightbox({
      root,
      dataUrl: "data:image/png;base64,CCC",
    });
    const backdrop = root.querySelector("[data-terminal-image-lightbox='true']");
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-terminal-image-lightbox='true']")).toBeNull();

    root.remove();
  });
});
