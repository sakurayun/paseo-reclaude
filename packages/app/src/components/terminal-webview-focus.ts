export function requestTerminalWebViewFocus(webView: unknown): void {
  if (!webView || typeof webView !== "object") {
    return;
  }

  const requestFocus = (webView as { requestFocus?: unknown }).requestFocus;
  if (typeof requestFocus !== "function") {
    return;
  }

  requestFocus.call(webView);
}
