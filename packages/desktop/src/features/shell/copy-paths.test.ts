import { describe, expect, it, vi } from "vitest";
import { copyFilePathsToClipboard, type FilePathClipboard } from "./copy-paths.js";

vi.mock("electron", () => ({ clipboard: {}, ClipboardItem: vi.fn() }));

function createRecordingClipboard(): FilePathClipboard & {
  writes: Array<Record<string, string | Blob>>;
} {
  const writes: Array<Record<string, string | Blob>> = [];
  return {
    writes,
    async write(items) {
      writes.push(items);
    },
  };
}

describe("copyFilePathsToClipboard", () => {
  it("writes NSFilenamesPboardType on macOS", async () => {
    const fileClipboard = createRecordingClipboard();
    expect(await copyFilePathsToClipboard(["/tmp/a.txt", "/tmp/b"], "darwin", fileClipboard)).toBe(
      true,
    );
    expect(fileClipboard.writes).toHaveLength(1);
    const blob = fileClipboard.writes[0][
      'electron application/osclipboard;format="NSFilenamesPboardType"'
    ] as Blob;
    const plist = await blob.text();
    expect(plist).toContain("<string>/tmp/a.txt</string>");
    expect(plist).toContain("<string>/tmp/b</string>");
  });

  it("writes CF_HDROP on Windows", async () => {
    const fileClipboard = createRecordingClipboard();
    expect(await copyFilePathsToClipboard(["C:\\repo\\a.txt"], "win32", fileClipboard)).toBe(true);
    const blob = fileClipboard.writes[0][
      'electron application/osclipboard;format="CF_HDROP"'
    ] as Blob;
    const buffer = Buffer.from(await blob.arrayBuffer());
    expect(buffer.readUInt32LE(0)).toBe(20);
    expect(buffer.readUInt32LE(16)).toBe(1);
    expect(buffer.subarray(20).toString("utf16le")).toBe("C:\\repo\\a.txt\0\0");
  });

  it("writes uri-list and text on Linux", async () => {
    const fileClipboard = createRecordingClipboard();
    expect(await copyFilePathsToClipboard(["/tmp/a.txt"], "linux", fileClipboard)).toBe(true);
    expect(fileClipboard.writes).toEqual([
      { "text/uri-list": "file:///tmp/a.txt", "text/plain": "/tmp/a.txt" },
    ]);
  });

  it("returns false for an empty path list", async () => {
    const fileClipboard = createRecordingClipboard();
    expect(await copyFilePathsToClipboard([], "darwin", fileClipboard)).toBe(false);
    expect(fileClipboard.writes).toHaveLength(0);
  });
});
