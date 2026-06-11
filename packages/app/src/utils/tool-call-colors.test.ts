import { describe, expect, it } from "vitest";
import { resolveMcpServerColor, resolveToolCallColor } from "./tool-call-colors";

describe("resolveToolCallColor", () => {
  it("colors shell tools by category", () => {
    const color = resolveToolCallColor("Bash", {
      type: "shell",
      command: "ls",
    });
    expect(color).toEqual({ light: "#b45309", dark: "#fbbf24" });
  });

  it("colors read tools by category", () => {
    const color = resolveToolCallColor("Read", {
      type: "read",
      filePath: "/tmp/a.txt",
    });
    expect(color).toEqual({ light: "#2563eb", dark: "#60a5fa" });
  });

  it("leaves unknown plain tools uncolored", () => {
    expect(resolveToolCallColor("SomeTool")).toBeUndefined();
  });

  it("uses the brand color for known MCP servers", () => {
    const color = resolveToolCallColor("mcp__playwright__browser_click", {
      type: "unknown",
      input: null,
      output: null,
    });
    expect(color).toEqual({ light: "#2c8a2f", dark: "#45ba4b" });
  });

  it("matches known MCP servers case- and separator-insensitively", () => {
    expect(resolveMcpServerColor("Chrome-DevTools")).toEqual({
      light: "#1a73e8",
      dark: "#8ab4f8",
    });
  });

  it("hashes unknown MCP servers onto a stable fallback color", () => {
    const first = resolveMcpServerColor("my-custom-server");
    const second = resolveMcpServerColor("my-custom-server");
    expect(first).toEqual(second);
    expect(first.light).toMatch(/^#/);
  });

  it("keeps the Paseo brand color for Paseo MCP tools", () => {
    const color = resolveToolCallColor("mcp__paseo__create_agent", {
      type: "unknown",
      input: null,
      output: null,
    });
    expect(color).toEqual({ light: "#16a34a", dark: "#4ade80" });
  });
});
