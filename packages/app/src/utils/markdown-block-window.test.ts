import { describe, expect, it } from "vitest";
import {
  MAX_MOUNTED_MARKDOWN_BLOCKS,
  MOUNTED_MARKDOWN_HEAD_BLOCKS,
  selectMarkdownBlockWindow,
} from "./markdown-block-window";

describe("selectMarkdownBlockWindow", () => {
  it("keeps ordinary messages unchanged", () => {
    const blocks = Array.from({ length: MAX_MOUNTED_MARKDOWN_BLOCKS }, (_, index) => index);

    expect(selectMarkdownBlockWindow(blocks, false)).toEqual({
      items: blocks,
      hiddenCount: 0,
      tailStartIndex: null,
    });
  });

  it("keeps a bounded head and live tail in source order", () => {
    const blocks = Array.from({ length: 200 }, (_, index) => index);
    const window = selectMarkdownBlockWindow(blocks, false);

    expect(window.items).toHaveLength(MAX_MOUNTED_MARKDOWN_BLOCKS);
    expect(window.items.slice(0, MOUNTED_MARKDOWN_HEAD_BLOCKS)).toEqual(
      blocks.slice(0, MOUNTED_MARKDOWN_HEAD_BLOCKS),
    );
    expect(window.items.slice(MOUNTED_MARKDOWN_HEAD_BLOCKS)).toEqual(
      blocks.slice(-(MAX_MOUNTED_MARKDOWN_BLOCKS - MOUNTED_MARKDOWN_HEAD_BLOCKS)),
    );
    expect(window.hiddenCount).toBe(200 - MAX_MOUNTED_MARKDOWN_BLOCKS);
    expect(window.tailStartIndex).toBe(MOUNTED_MARKDOWN_HEAD_BLOCKS);
  });

  it("restores every block after explicit expansion", () => {
    const blocks = Array.from({ length: 200 }, (_, index) => index);

    expect(selectMarkdownBlockWindow(blocks, true)).toEqual({
      items: blocks,
      hiddenCount: 0,
      tailStartIndex: null,
    });
  });
});
