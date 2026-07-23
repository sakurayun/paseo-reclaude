import { describe, expect, it } from "vitest";
import {
  resolveDirectorySurfacePaths,
  resolveOutsideAbsolutePath,
  shouldBrowseOutsideAbsoluteDirectory,
  shouldSkipFileReadForOutsidePath,
} from "./outside-path";

describe("resolveOutsideAbsolutePath", () => {
  it("returns absolute paths outside the workspace", () => {
    expect(
      resolveOutsideAbsolutePath({
        path: "/Users/suanshu/Desktop/apps/moego",
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
      }),
    ).toBe("/Users/suanshu/Desktop/apps/moego");
  });

  it("returns null for paths inside the workspace", () => {
    expect(
      resolveOutsideAbsolutePath({
        path: "/Users/suanshu/Desktop/apps/moego/petgem/src",
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
      }),
    ).toBeNull();
  });
});

describe("shouldBrowseOutsideAbsoluteDirectory", () => {
  it("returns the path only when classified as a directory", () => {
    expect(
      shouldBrowseOutsideAbsoluteDirectory({
        outsideAbsolutePath: "/tmp/out",
        outsidePathKind: "directory",
      }),
    ).toBe("/tmp/out");
    expect(
      shouldBrowseOutsideAbsoluteDirectory({
        outsideAbsolutePath: "/tmp/out",
        outsidePathKind: "file",
      }),
    ).toBeNull();
  });
});

describe("shouldSkipFileReadForOutsidePath", () => {
  it("skips file reads while classifying outside paths", () => {
    expect(
      shouldSkipFileReadForOutsidePath({
        outsideAbsolutePath: "/tmp/out",
        outsidePathKind: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldSkipFileReadForOutsidePath({
        outsideAbsolutePath: "/tmp/out",
        outsidePathKind: "file",
      }),
    ).toBe(false);
  });
});

describe("resolveDirectorySurfacePaths", () => {
  it("prefers a classified outside directory for browsing", () => {
    expect(
      resolveDirectorySurfacePaths({
        directoryRelativePath: null,
        outsideAbsolutePath: "/Users/suanshu/Desktop/apps/moego",
        browseAbsoluteDirectory: "/Users/suanshu/Desktop/apps/moego",
        directoryLoadError: false,
        path: "/Users/suanshu/Desktop/apps/moego",
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
      }),
    ).toEqual({
      activeAbsoluteDirectory: "/Users/suanshu/Desktop/apps/moego",
      recoveredDirectoryPath: null,
    });
  });
});
