/**
 * Insert zero-width break opportunities after path/identifier separators so
 * long monospaced tokens (file paths, dotted ids) wrap on narrow native
 * viewports instead of overflowing and being clipped by parent overflow:hidden.
 *
 * Safe to use on every platform — ZWSP is invisible and copy/paste of the
 * rendered string still yields the original characters in selection on modern
 * engines when users select across the glyph runs.
 */
export function breakableMonoText(content: string): string {
  if (content.length < 12) {
    return content;
  }
  // After / \ . _ - : so path and package tokens can reflow mid-token.
  return content.replace(/([/\\._:-])/g, "$1\u200b");
}
