import { describe, expect, it } from "vitest";
import { enumerateDroppedItems } from "./enumerate-dropped-entries";

function fakeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

function fakeFileEntry(fullPath: string, size: number): FileSystemFileEntry {
  const segments = fullPath.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? fullPath;
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (resolve: (file: File) => void) => resolve(fakeFile(name, size)),
  } as unknown as FileSystemFileEntry;
}

function fakeDirEntry(fullPath: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  const segments = fullPath.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? fullPath;
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let drained = false;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          if (drained) {
            resolve([]);
            return;
          }
          drained = true;
          resolve(children);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

describe("enumerateDroppedItems", () => {
  it("walks nested directories and keeps the drop root in relative paths", async () => {
    const tree = fakeDirEntry("/photos", [
      fakeFileEntry("/photos/a.jpg", 10),
      fakeDirEntry("/photos/2024", [fakeFileEntry("/photos/2024/b.jpg", 20)]),
    ]);
    const result = await enumerateDroppedItems([{ file: null, entry: tree }]);
    expect(result.files.map((f) => f.relativePath)).toEqual(["photos/a.jpg", "photos/2024/b.jpg"]);
    expect(result.totalSize).toBe(30);
    expect(result.truncated).toBe(false);
  });

  it("falls back to plain files when no entry handle exists", async () => {
    const result = await enumerateDroppedItems([{ file: fakeFile("note.txt", 5), entry: null }]);
    expect(result.files.map((f) => f.relativePath)).toEqual(["note.txt"]);
    expect(result.totalSize).toBe(5);
  });

  it("mixes top-level files and directories", async () => {
    const result = await enumerateDroppedItems([
      { file: null, entry: fakeFileEntry("/readme.md", 1) },
      { file: null, entry: fakeDirEntry("/src", [fakeFileEntry("/src/main.ts", 2)]) },
    ]);
    expect(result.files.map((f) => f.relativePath)).toEqual(["readme.md", "src/main.ts"]);
  });
});
