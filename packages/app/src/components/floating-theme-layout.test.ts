import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createMarkdownStyles } from "./markdown/styles";
import { REGISTERED_THEMES, lightTheme } from "@/styles/theme";

// 检查真实 JSX 的挂载关系，避免只保留主题参数却忘记给新版容器接入样式。
describe("floating workspace layout", () => {
  it("keeps the split tree inside a floating card and the header outside it", () => {
    const source = ts.createSourceFile(
      "split-container.tsx",
      readFileSync(new URL("./split-container.tsx", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let splitRoots = 0;
    let headers = 0;
    const isInCard = (node: ts.Node): boolean => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ts.isJsxElement(parent) &&
          parent.openingElement.attributes.properties.some(
            (attribute) => attribute.getText(source) === "style={styles.floatingContent}",
          )
        )
          return true;
      }
      return false;
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(source) === "SplitNodeView" &&
        node.attributes.properties.some(
          (attribute) => attribute.getText(source) === "node={renderRoot}",
        )
      ) {
        splitRoots++;
        expect(isInCard(node)).toBe(true);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "renderMainHeader") {
        headers++;
        expect(isInCard(node)).toBe(false);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(splitRoots).toBe(1);
    expect(headers).toBe(1);
  });
});

describe("floating Markdown chrome", () => {
  it.each(Object.entries(REGISTERED_THEMES).filter(([, theme]) => theme.shell.floating))(
    "%s removes table and horizontal rules while retaining spacing",
    (_name, theme) => {
      const { markdownStyle } = createMarkdownStyles(theme, { blockGap: 16 });
      expect(markdownStyle.table?.borderColor).toBe("transparent");
      expect(markdownStyle.thematicBreak?.height).toBe(0);
      expect(markdownStyle.thematicBreak?.marginBottom).toBe(16);
    },
  );
  it("preserves the classic rule when rendering a non-floating theme", () => {
    expect(
      createMarkdownStyles(lightTheme, { blockGap: 16 }).markdownStyle.thematicBreak?.height,
    ).toBe(1);
  });
});
