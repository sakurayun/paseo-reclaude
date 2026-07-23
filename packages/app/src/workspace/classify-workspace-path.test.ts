import { describe, expect, it, vi } from "vitest";
import {
  ancestorExplorerPaths,
  classifyWorkspacePath,
  joinAbsolutePath,
  toWorkspaceRelativePath,
} from "./classify-workspace-path";

describe("toWorkspaceRelativePath", () => {
  it("maps workspace root to explorer root", () => {
    expect(
      toWorkspaceRelativePath({
        path: "/repo",
        workspaceRoot: "/repo",
      }),
    ).toBe(".");
  });

  it("maps workspace root with a trailing slash to explorer root", () => {
    expect(
      toWorkspaceRelativePath({
        path: "/Users/suanshu/Documents/OwlSpeak/",
        workspaceRoot: "/Users/suanshu/Documents/OwlSpeak",
      }),
    ).toBe(".");
  });

  it("maps absolute paths under the workspace to relative paths", () => {
    expect(
      toWorkspaceRelativePath({
        path: "/repo/src/main.ts",
        workspaceRoot: "/repo",
      }),
    ).toBe("src/main.ts");
  });

  it("normalizes relative paths", () => {
    expect(
      toWorkspaceRelativePath({
        path: "./src/main.ts",
        workspaceRoot: "/repo",
      }),
    ).toBe("src/main.ts");
  });

  it("returns null for paths outside the workspace", () => {
    expect(
      toWorkspaceRelativePath({
        path: "/Users/suanshu/Desktop/apps/moego",
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
      }),
    ).toBeNull();
  });
});

describe("ancestorExplorerPaths", () => {
  it("returns every ancestor including the leaf", () => {
    expect(ancestorExplorerPaths("src/components/button.tsx")).toEqual([
      "src",
      "src/components",
      "src/components/button.tsx",
    ]);
  });

  it("returns empty for the explorer root", () => {
    expect(ancestorExplorerPaths(".")).toEqual([]);
  });
});

describe("joinAbsolutePath", () => {
  it("joins parent and child segments", () => {
    expect(joinAbsolutePath("/Users/suanshu/Desktop/apps/moego", "petgem")).toBe(
      "/Users/suanshu/Desktop/apps/moego/petgem",
    );
  });
});

describe("classifyWorkspacePath", () => {
  it("classifies the workspace root as a directory without listing", async () => {
    const listDirectory = vi.fn(async () => ({ path: ".", entries: [] }));

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
        path: "/Users/suanshu/Desktop/apps/moego/petgem",
      }),
    ).resolves.toEqual({
      kind: "directory",
      relativePath: ".",
    });
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("classifies directories by listing the path itself", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => {
      if (path === "src/components") {
        return { path: "src/components", entries: [] };
      }
      throw new Error("unexpected path");
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/repo",
        path: "/repo/src/components",
      }),
    ).resolves.toEqual({
      kind: "directory",
      relativePath: "src/components",
    });
    expect(listDirectory).toHaveBeenCalledWith("/repo", "src/components");
  });

  it("classifies files when listDirectory reports not-a-directory", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("Requested path is not a directory");
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/repo",
        path: "assets/logo.png",
      }),
    ).resolves.toEqual({
      kind: "file",
      relativePath: "assets/logo.png",
    });
  });

  it("classifies absolute directories outside the workspace via path-as-root listing", async () => {
    const listDirectory = vi.fn(async (cwd: string, path: string) => {
      if (cwd === "/Users/suanshu/Desktop/apps/moego" && path === ".") {
        return {
          path: ".",
          entries: [
            { name: "petgem", path: "petgem", kind: "directory" as const },
            { name: "paseo-reclaude", path: "paseo-reclaude", kind: "directory" as const },
          ],
        };
      }
      throw new Error(`unexpected list: ${cwd} ${path}`);
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
        path: "/Users/suanshu/Desktop/apps/moego",
      }),
    ).resolves.toEqual({
      kind: "absolute-directory",
      absolutePath: "/Users/suanshu/Desktop/apps/moego",
    });
    expect(listDirectory).toHaveBeenCalledWith("/Users/suanshu/Desktop/apps/moego", ".");
  });

  it("classifies absolute files outside the workspace", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("Requested path is not a directory");
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/Users/suanshu/Desktop/apps/moego/petgem",
        path: "/Users/suanshu/Desktop/apps/moego/notes.txt",
      }),
    ).resolves.toEqual({
      kind: "absolute-file",
      absolutePath: "/Users/suanshu/Desktop/apps/moego/notes.txt",
    });
  });

  it("falls back to the parent listing when a direct probe fails for other reasons", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => {
      if (path === "src/components") {
        throw new Error("permission denied");
      }
      if (path === "src") {
        return {
          path: "src",
          entries: [
            { name: "components", path: "src/components", kind: "directory" as const },
            { name: "main.ts", path: "src/main.ts", kind: "file" as const },
          ],
        };
      }
      throw new Error("missing");
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/repo",
        path: "/repo/src/components",
      }),
    ).resolves.toEqual({
      kind: "directory",
      relativePath: "src/components",
    });
  });

  it("returns null when the path cannot be classified", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("not found");
    });

    await expect(
      classifyWorkspacePath({
        listDirectory,
        workspaceRoot: "/repo",
        path: "missing.bin",
      }),
    ).resolves.toBeNull();
  });
});
