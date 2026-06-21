import { describe, expect, it, vi } from "vitest";
import { requestTerminalWebViewFocus } from "./terminal-webview-focus";

describe("requestTerminalWebViewFocus", () => {
  it("does nothing when the native WebView ref has no requestFocus method", () => {
    expect(() => requestTerminalWebViewFocus({})).not.toThrow();
    expect(() => requestTerminalWebViewFocus(null)).not.toThrow();
  });

  it("calls requestFocus with the WebView ref as this", () => {
    const webView = {
      requestFocus: vi.fn(function (this: unknown) {
        expect(this).toBe(webView);
      }),
    };

    requestTerminalWebViewFocus(webView);

    expect(webView.requestFocus).toHaveBeenCalledTimes(1);
  });
});
