import { describe, expect, it } from "vitest";
import { buildAbsoluteExplorerPath, buildRelativeExplorerPath } from "./explorer-paths";

describe("buildAbsoluteExplorerPath", () => {
  it("builds a POSIX absolute path from a relative explorer path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/Users/moboudra/dev/paseo",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("/Users/moboudra/dev/paseo/packages/app/src/components/file-explorer-pane.tsx");
  });

  it("returns workspace root when entry path points to explorer root", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/Users/moboudra/dev/paseo",
        entryPath: ".",
      }),
    ).toBe("/Users/moboudra/dev/paseo");
  });

  it("trims trailing separators from workspace root before joining", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/Users/moboudra/dev/paseo/",
        entryPath: "README.md",
      }),
    ).toBe("/Users/moboudra/dev/paseo/README.md");
  });

  it("builds a Windows absolute path with backslash separators", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "C:\\repo\\paseo",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("C:\\repo\\paseo\\packages\\app\\src\\components\\file-explorer-pane.tsx");
  });

  it("passes through an already-absolute entry path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/Users/moboudra/dev/paseo",
        entryPath: "/tmp/another/location.txt",
      }),
    ).toBe("/tmp/another/location.txt");
  });
});

describe("buildRelativeExplorerPath", () => {
  it("returns the workspace-relative path unchanged", () => {
    expect(buildRelativeExplorerPath("packages/app/src/index.ts")).toBe(
      "packages/app/src/index.ts",
    );
  });

  it("drops a leading ./ segment", () => {
    expect(buildRelativeExplorerPath("./README.md")).toBe("README.md");
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    expect(buildRelativeExplorerPath("packages\\app\\index.ts")).toBe("packages/app/index.ts");
  });

  it("collapses duplicate separators and trims surrounding whitespace", () => {
    expect(buildRelativeExplorerPath("  src//utils/path.ts  ")).toBe("src/utils/path.ts");
  });

  it("returns an empty string for the explorer root", () => {
    expect(buildRelativeExplorerPath(".")).toBe("");
  });
});
