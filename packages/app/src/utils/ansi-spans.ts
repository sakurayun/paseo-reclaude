/**
 * Parse terminal ANSI SGR sequences into styled spans so shell tool output can
 * reuse the same 16/256/truecolor mapping the terminal palette uses.
 */

export type AnsiNamedColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

export type AnsiColorRef =
  | { kind: "named"; name: AnsiNamedColor }
  | { kind: "rgb"; hex: string }
  | { kind: "default" };

export interface AnsiSpanStyle {
  fg: AnsiColorRef;
  bg: AnsiColorRef;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  reverse: boolean;
}

export interface AnsiSpan {
  text: string;
  style: AnsiSpanStyle;
}

const DEFAULT_STYLE: AnsiSpanStyle = {
  fg: { kind: "default" },
  bg: { kind: "default" },
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  reverse: false,
};

const NAMED_FG: Record<number, AnsiNamedColor> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "brightBlack",
  91: "brightRed",
  92: "brightGreen",
  93: "brightYellow",
  94: "brightBlue",
  95: "brightMagenta",
  96: "brightCyan",
  97: "brightWhite",
};

const NAMED_BG: Record<number, AnsiNamedColor> = {
  40: "black",
  41: "red",
  42: "green",
  43: "yellow",
  44: "blue",
  45: "magenta",
  46: "cyan",
  47: "white",
  100: "brightBlack",
  101: "brightRed",
  102: "brightGreen",
  103: "brightYellow",
  104: "brightBlue",
  105: "brightMagenta",
  106: "brightCyan",
  107: "brightWhite",
};

const NAMED_FROM_INDEX: AnsiNamedColor[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

function cloneStyle(style: AnsiSpanStyle): AnsiSpanStyle {
  return {
    fg: style.fg,
    bg: style.bg,
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    reverse: style.reverse,
  };
}

function stylesEqual(a: AnsiSpanStyle, b: AnsiSpanStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.reverse === b.reverse &&
    colorRefEqual(a.fg, b.fg) &&
    colorRefEqual(a.bg, b.bg)
  );
}

function colorRefEqual(a: AnsiColorRef, b: AnsiColorRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "named" && b.kind === "named") return a.name === b.name;
  if (a.kind === "rgb" && b.kind === "rgb") return a.hex === b.hex;
  return true;
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Standard xterm 256-color palette (indices 0–255) as #rrggbb. */
export function xterm256ToHex(index: number): string {
  const i = Math.max(0, Math.min(255, Math.floor(index)));
  if (i < 16) {
    const system = [
      "#000000",
      "#cd0000",
      "#00cd00",
      "#cdcd00",
      "#0000ee",
      "#cd00cd",
      "#00cdcd",
      "#e5e5e5",
      "#7f7f7f",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#5c5cff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ];
    return system[i];
  }
  if (i < 232) {
    const n = i - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return toHex(level(r), level(g), level(b));
  }
  const gray = 8 + (i - 232) * 10;
  return toHex(gray, gray, gray);
}

function colorFrom256(index: number): AnsiColorRef {
  if (index >= 0 && index < 16) {
    return { kind: "named", name: NAMED_FROM_INDEX[index] };
  }
  return { kind: "rgb", hex: xterm256ToHex(index) };
}

function applyDecoration(next: AnsiSpanStyle, code: number): boolean {
  switch (code) {
    case 1:
      next.bold = true;
      return true;
    case 2:
      next.dim = true;
      return true;
    case 3:
      next.italic = true;
      return true;
    case 4:
      next.underline = true;
      return true;
    case 7:
      next.reverse = true;
      return true;
    case 9:
      next.strikethrough = true;
      return true;
    case 22:
      next.bold = false;
      next.dim = false;
      return true;
    case 23:
      next.italic = false;
      return true;
    case 24:
      next.underline = false;
      return true;
    case 27:
      next.reverse = false;
      return true;
    case 29:
      next.strikethrough = false;
      return true;
    default:
      return false;
  }
}

function applyExtendedColor(
  next: AnsiSpanStyle,
  isFg: boolean,
  params: number[],
  start: number,
): number {
  let i = start;
  const mode = params[i];
  i += 1;
  if (mode === 5) {
    const color = colorFrom256(params[i] ?? 0);
    i += 1;
    if (isFg) next.fg = color;
    else next.bg = color;
    return i;
  }
  if (mode === 2) {
    const color: AnsiColorRef = {
      kind: "rgb",
      hex: toHex(params[i] ?? 0, params[i + 1] ?? 0, params[i + 2] ?? 0),
    };
    i += 3;
    if (isFg) next.fg = color;
    else next.bg = color;
  }
  return i;
}

function applySgr(style: AnsiSpanStyle, params: number[]): AnsiSpanStyle {
  const next = cloneStyle(style);
  if (params.length === 0) {
    return cloneStyle(DEFAULT_STYLE);
  }

  let i = 0;
  while (i < params.length) {
    const code = params[i] ?? 0;
    i += 1;

    if (code === 0) {
      Object.assign(next, cloneStyle(DEFAULT_STYLE));
      continue;
    }
    if (applyDecoration(next, code)) continue;
    if (code === 39) {
      next.fg = { kind: "default" };
      continue;
    }
    if (code === 49) {
      next.bg = { kind: "default" };
      continue;
    }
    if (NAMED_FG[code]) {
      next.fg = { kind: "named", name: NAMED_FG[code] };
      continue;
    }
    if (NAMED_BG[code]) {
      next.bg = { kind: "named", name: NAMED_BG[code] };
      continue;
    }
    if (code === 38 || code === 48) {
      i = applyExtendedColor(next, code === 38, params, i);
    }
  }
  return next;
}

function parseSgrParams(body: string): number[] {
  if (!body) return [0];
  return body.split(";").map((part) => {
    if (part === "") return 0;
    const n = Number(part);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * Consume a single ESC sequence starting at `index` (which points at ESC).
 * Returns the index after the sequence. SGR (`…m`) also returns params.
 */
function consumeEscape(
  input: string,
  index: number,
): { nextIndex: number; sgrParams: number[] | null } {
  const n = input.length;
  if (index >= n || input[index] !== "\u001b") {
    return { nextIndex: index + 1, sgrParams: null };
  }

  const next = input[index + 1];

  // CSI: ESC [
  if (next === "[") {
    let i = index + 2;
    // parameter bytes 0x30–0x3F
    while (i < n) {
      const code = input.charCodeAt(i);
      if (code >= 0x30 && code <= 0x3f) {
        i += 1;
        continue;
      }
      break;
    }
    // intermediate bytes 0x20–0x2F
    while (i < n) {
      const code = input.charCodeAt(i);
      if (code >= 0x20 && code <= 0x2f) {
        i += 1;
        continue;
      }
      break;
    }
    if (i >= n) {
      return { nextIndex: n, sgrParams: null };
    }
    const final = input[i];
    const finalIndex = i + 1;
    if (final === "m") {
      const body = input.slice(index + 2, i);
      // Only pure digit/semicolon bodies are SGR params we understand; `?` etc.
      // still get consumed so they do not leak into the text.
      if (/^[0-9;]*$/.test(body)) {
        return { nextIndex: finalIndex, sgrParams: parseSgrParams(body) };
      }
      return { nextIndex: finalIndex, sgrParams: null };
    }
    return { nextIndex: finalIndex, sgrParams: null };
  }

  // OSC: ESC ] … BEL or ESC \
  if (next === "]") {
    let i = index + 2;
    while (i < n) {
      if (input[i] === "\u0007") {
        return { nextIndex: i + 1, sgrParams: null };
      }
      if (input[i] === "\u001b" && input[i + 1] === "\\") {
        return { nextIndex: i + 2, sgrParams: null };
      }
      i += 1;
    }
    return { nextIndex: n, sgrParams: null };
  }

  // Two-character escapes (ESC c, ESC 7, ESC D, …)
  if (next !== undefined) {
    return { nextIndex: index + 2, sgrParams: null };
  }
  return { nextIndex: index + 1, sgrParams: null };
}

/**
 * Convert ANSI-colored terminal text into styled spans. Identical adjacent
 * styles are merged. `\r\n` normalizes to `\n`; lone `\r` becomes `\n`.
 * Non-SGR control sequences are stripped (not shown as glyphs).
 */
export function parseAnsiToSpans(input: string): AnsiSpan[] {
  if (!input) return [];

  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const spans: AnsiSpan[] = [];
  let style = cloneStyle(DEFAULT_STYLE);
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    const last = spans[spans.length - 1];
    if (last && stylesEqual(last.style, style)) {
      last.text += buffer;
    } else {
      spans.push({ text: buffer, style: cloneStyle(style) });
    }
    buffer = "";
  };

  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === "\u001b") {
      flush();
      const consumed = consumeEscape(normalized, i);
      if (consumed.sgrParams) {
        style = applySgr(style, consumed.sgrParams);
      }
      i = consumed.nextIndex;
      continue;
    }
    // Drop other C0 controls except tab/newline.
    if (ch < " " && ch !== "\t" && ch !== "\n") {
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return spans;
}

/** Visible plain text with ANSI codes removed. */
export function ansiToPlainText(input: string): string {
  return parseAnsiToSpans(input)
    .map((span) => span.text)
    .join("");
}

/** Visible (ANSI-stripped) length of the input. */
export function ansiVisibleLength(input: string): number {
  return ansiToPlainText(input).length;
}

/**
 * Map a raw-string character index onto the corresponding visible-text index
 * after ANSI / C0 control stripping (same rules as parseAnsiToSpans).
 */
export function rawIndexToVisibleIndex(raw: string, rawIndex: number): number {
  const target = Math.max(0, Math.min(raw.length, rawIndex));
  let visible = 0;
  let i = 0;
  while (i < target) {
    if (raw[i] === "\u001b") {
      i = consumeEscape(raw, i).nextIndex;
      continue;
    }
    if (raw[i] < " " && raw[i] !== "\t" && raw[i] !== "\n" && raw[i] !== "\r") {
      i += 1;
      continue;
    }
    // CR/LF each count as one visible unit; parseAnsiToSpans normalizes pairs
    // later but offsets stay monotonic and in range either way.
    visible += 1;
    i += 1;
  }
  return visible;
}

/** Map a [start, end) range on raw text to visible-text offsets. */
export function mapRawRangeToVisible(
  raw: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const visibleStart = rawIndexToVisibleIndex(raw, start);
  const visibleEnd = rawIndexToVisibleIndex(raw, end);
  return {
    start: visibleStart,
    end: Math.max(visibleStart, visibleEnd),
  };
}
