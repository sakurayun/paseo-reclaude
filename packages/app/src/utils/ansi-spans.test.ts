import { describe, expect, it } from "vitest";
import { ansiToPlainText, parseAnsiToSpans, xterm256ToHex } from "./ansi-spans";

describe("parseAnsiToSpans", () => {
  it("returns a single default span for plain text", () => {
    const spans = parseAnsiToSpans("hello world");
    expect(spans).toEqual([
      {
        text: "hello world",
        style: {
          fg: { kind: "default" },
          bg: { kind: "default" },
          bold: false,
          dim: false,
          italic: false,
          underline: false,
          strikethrough: false,
          reverse: false,
        },
      },
    ]);
  });

  it("maps basic 16-color SGR codes to named palette colors", () => {
    const spans = parseAnsiToSpans("\u001b[31mred\u001b[0m plain \u001b[1;32mgreen\u001b[0m");
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({
      text: "red",
      style: { fg: { kind: "named", name: "red" } },
    });
    expect(spans[1]).toMatchObject({
      text: " plain ",
      style: { fg: { kind: "default" } },
    });
    expect(spans[2]).toMatchObject({
      text: "green",
      style: { fg: { kind: "named", name: "green" }, bold: true },
    });
  });

  it("handles 256-color and truecolor", () => {
    const spans = parseAnsiToSpans("\u001b[38;5;196mx\u001b[0m\u001b[38;2;255;100;50my\u001b[0m");
    expect(spans[0].style.fg).toEqual({ kind: "rgb", hex: xterm256ToHex(196) });
    expect(spans[1].style.fg).toEqual({ kind: "rgb", hex: "#ff6432" });
  });

  it("maps 256-color indices 0–15 to named colors", () => {
    const spans = parseAnsiToSpans("\u001b[38;5;1merr\u001b[0m");
    expect(spans[0].style.fg).toEqual({ kind: "named", name: "red" });
  });

  it("strips non-SGR escapes and normalizes CR", () => {
    expect(ansiToPlainText("a\u001b[2Jb\u001b]0;title\u0007c")).toBe("abc");
    expect(ansiToPlainText("line1\r\nline2\rline3")).toBe("line1\nline2\nline3");
  });

  it("merges adjacent spans with identical styles", () => {
    const spans = parseAnsiToSpans("\u001b[32ma\u001b[32mb\u001b[0m");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("ab");
  });

  it("keeps SGR colors when CSI clear-screen is interleaved", () => {
    const spans = parseAnsiToSpans("\u001b[2J\u001b[31merr\u001b[0m");
    expect(spans).toEqual([
      expect.objectContaining({
        text: "err",
        style: expect.objectContaining({ fg: { kind: "named", name: "red" } }),
      }),
    ]);
  });
});
