import { describe, expect, it, vi } from "vitest";
import {
  parseRipgrepMatches,
  RipgrepUnavailableError,
  searchWorkspaceFiles,
} from "./workspace-content-search.js";

const MATCH_LINE = JSON.stringify({
  type: "match",
  data: {
    path: { text: "src/app.ts" },
    lines: { text: "const needle = 1;\n" },
    line_number: 3,
    submatches: [{ match: { text: "needle" }, start: 6, end: 12 }],
  },
});
const BEGIN_LINE = JSON.stringify({ type: "begin", data: { path: { text: "src/app.ts" } } });
const SUMMARY_LINE = JSON.stringify({ type: "summary", data: { stats: {} } });

function matchLine(workspace: string): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: "f.ts" },
      lines: { text: `hit in ${workspace}\n` },
      line_number: 1,
      submatches: [{ match: { text: "hit" }, start: 0, end: 3 }],
    },
  });
}

describe("parseRipgrepMatches", () => {
  it("parses match lines and ignores non-match events", () => {
    const stdout = [BEGIN_LINE, MATCH_LINE, SUMMARY_LINE, ""].join("\n");
    expect(parseRipgrepMatches(stdout, "ws-1", "/work/repo")).toEqual([
      {
        workspaceId: "ws-1",
        absPath: "/work/repo/src/app.ts",
        relPath: "src/app.ts",
        line: 3,
        column: 6,
        lineText: "const needle = 1;",
        matchStart: 6,
        matchEnd: 12,
      },
    ]);
  });

  it("skips malformed json lines", () => {
    expect(parseRipgrepMatches("not json\n{bad}\n", "ws", "/root")).toEqual([]);
  });
});

describe("searchWorkspaceFiles", () => {
  it("throws when ripgrep is unavailable", async () => {
    await expect(
      searchWorkspaceFiles(
        { targets: [{ workspaceId: "ws", root: "/root" }], query: "x" },
        { resolveRipgrep: async () => null, runRipgrep: async () => "" },
      ),
    ).rejects.toBeInstanceOf(RipgrepUnavailableError);
  });

  it("aggregates matches across workspaces and honors maxResults", async () => {
    const runRipgrep = vi.fn(async ({ cwd }: { cwd: string }) =>
      matchLine(cwd === "/a" ? "ws-a" : "ws-b"),
    );
    const result = await searchWorkspaceFiles(
      {
        targets: [
          { workspaceId: "ws-a", root: "/a" },
          { workspaceId: "ws-b", root: "/b" },
        ],
        query: "hit",
        maxResults: 1,
      },
      { resolveRipgrep: async () => "/usr/bin/rg", runRipgrep },
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.workspaceId).toBe("ws-a");
    expect(result.truncated).toBe(true);
    expect(result.engine).toBe("ripgrep");
    expect(runRipgrep).toHaveBeenCalledTimes(1);
  });

  it("passes --ignore-case unless caseSensitive is set", async () => {
    const runRipgrep = vi.fn(async () => "");
    await searchWorkspaceFiles(
      { targets: [{ workspaceId: "ws", root: "/r" }], query: "x" },
      { resolveRipgrep: async () => "/rg", runRipgrep },
    );
    expect(runRipgrep.mock.calls[0]?.[0].args).toContain("--ignore-case");

    runRipgrep.mockClear();
    await searchWorkspaceFiles(
      { targets: [{ workspaceId: "ws", root: "/r" }], query: "x", caseSensitive: true },
      { resolveRipgrep: async () => "/rg", runRipgrep },
    );
    expect(runRipgrep.mock.calls[0]?.[0].args).not.toContain("--ignore-case");
  });
});
