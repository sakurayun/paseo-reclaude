// Pure string-range matching for xterm's registerCharacterJoiner.
//
// Why not rely solely on @xterm/addon-ligatures font parsing?
// That addon prefers Local Font Access tables when a family name matches a
// system font. If that font has empty/missing calt lookups, the joiner returns
// NO ranges and never falls back — so typing "=>" / "->" looks unjoined even
// when the face on screen (e.g. bundled Maple Mono) supports ligatures.
// Always joining common programming sequences, plus font-feature-settings on
// the terminal element so WebGL's texture atlas inherits calt/liga, is reliable
// for interactive input.

export function findTerminalLigatureRanges(
  text: string,
  sequences: readonly string[],
): Array<[number, number]> {
  if (text.length === 0 || sequences.length === 0) {
    return [];
  }
  // Longest-first so "===" wins over "==", "!==" over "!=", etc.
  const sorted =
    sequences[0]!.length >= (sequences[sequences.length - 1]?.length ?? 0)
      ? sequences
      : [...sequences].sort((a, b) => b.length - a.length);

  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const sequence of sorted) {
      if (sequence.length === 0) {
        continue;
      }
      if (text.startsWith(sequence, index)) {
        // Character joiner ranges are [start, end) in cell indices.
        ranges.push([index, index + sequence.length]);
        index += sequence.length - 1;
        break;
      }
    }
  }
  return ranges;
}
