export const MAX_MOUNTED_MARKDOWN_BLOCKS = 96;
export const MOUNTED_MARKDOWN_HEAD_BLOCKS = 32;
export const MAX_PROMOTED_ASSISTANT_MARKDOWN_BLOCKS = MOUNTED_MARKDOWN_HEAD_BLOCKS;
const MOUNTED_MARKDOWN_TAIL_BLOCKS = MAX_MOUNTED_MARKDOWN_BLOCKS - MOUNTED_MARKDOWN_HEAD_BLOCKS;

export interface MarkdownBlockWindow<T> {
  items: readonly T[];
  hiddenCount: number;
  tailStartIndex: number | null;
}

export function selectMarkdownBlockWindow<T>(
  items: readonly T[],
  expanded: boolean,
): MarkdownBlockWindow<T> {
  if (expanded || items.length <= MAX_MOUNTED_MARKDOWN_BLOCKS) {
    return { items, hiddenCount: 0, tailStartIndex: null };
  }

  return {
    items: [
      ...items.slice(0, MOUNTED_MARKDOWN_HEAD_BLOCKS),
      ...items.slice(-MOUNTED_MARKDOWN_TAIL_BLOCKS),
    ],
    hiddenCount: items.length - MAX_MOUNTED_MARKDOWN_BLOCKS,
    tailStartIndex: MOUNTED_MARKDOWN_HEAD_BLOCKS,
  };
}
