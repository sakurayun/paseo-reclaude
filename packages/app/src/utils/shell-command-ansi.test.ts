import { describe, expect, it } from "vitest";

import {
  buildShellAnsiDocument,
  colorizeShellCommand,
  colorizeShellOutput,
  textHasAnsi,
} from "./shell-command-ansi";
import { ansiToPlainText } from "./ansi-spans";

describe("colorizeShellCommand", () => {
  it("leaves already-ANSI text unchanged", () => {
    const colored = "\u001b[31mred\u001b[0m";
    expect(colorizeShellCommand(colored)).toBe(colored);
  });

  it("colorizes command name, flags, and strings distinctly", () => {
    const out = colorizeShellCommand('npm run test --bail=1 -c "hello"');
    expect(textHasAnsi(out)).toBe(true);
    expect(ansiToPlainText(out)).toBe('npm run test --bail=1 -c "hello"');
    expect(out).toContain("\u001b[1;96m"); // command name
    expect(out).toContain("\u001b[36m"); // flags
    expect(out).toContain("\u001b[33m"); // strings
  });

  it("mutes comments relative to command body", () => {
    const out = colorizeShellCommand("echo hi # trailing note");
    expect(ansiToPlainText(out)).toBe("echo hi # trailing note");
    expect(out).toContain("\u001b[2;90m");
    expect(out).toContain("# trailing note");
  });

  it("treats full-line comments as comments", () => {
    const out = colorizeShellCommand("# setup env\necho ok");
    expect(ansiToPlainText(out)).toBe("# setup env\necho ok");
    expect(out.indexOf("\u001b[2;90m")).toBeLessThan(out.indexOf("echo"));
  });

  it("colorizes operators and variables", () => {
    const out = colorizeShellCommand("cat $FILE | grep foo && echo done");
    expect(ansiToPlainText(out)).toBe("cat $FILE | grep foo && echo done");
    expect(out).toContain("\u001b[95m"); // variable
    expect(out).toContain("\u001b[1;35m"); // operator
  });

  it("starts a new command name after pipe and &&", () => {
    const out = colorizeShellCommand("ls | wc -l");
    const nameCode = "\u001b[1;96m";
    expect(out.split(nameCode).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("colorizes env assignments, paths, globs, and substitutions", () => {
    const cmd = "FOO=bar npm test ./src/main.ts ./src/*.ts $(date) `uname`";
    const out = colorizeShellCommand(cmd);
    expect(ansiToPlainText(out)).toBe(cmd);
    expect(out).toContain("\u001b[94m"); // assignment key
    expect(out).toContain("\u001b[96m"); // path
    expect(out).toContain("\u001b[35m"); // glob
    expect(out).toContain("\u001b[1;95m"); // substitution
  });
});

describe("colorizeShellOutput", () => {
  it("auto-colors plain output while keeping visible text stable", () => {
    const plain = "error: boom\n/tmp/foo.ts:12: warning: x\n✓ 3 passed\nhello world\n";
    const out = colorizeShellOutput(plain);
    expect(textHasAnsi(out)).toBe(true);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[1;91m"); // error
    expect(out).toContain("\u001b[1;93m"); // warn
    expect(out).toContain("\u001b[1;92m"); // success
  });

  it("highlights paths and numbers inside plain lines", () => {
    const plain = "compiled packages/app/src/foo.ts in 42ms";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[96m"); // path
    expect(out).toContain("\u001b[93m"); // number
  });

  it("colors unified diff markers", () => {
    const plain = "--- a/x\n+++ b/x\n-old\n+new\n";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[31m"); // deletion
    expect(out).toContain("\u001b[32m"); // addition
  });

  it("colors git status short lines", () => {
    const plain = " M packages/app/src/x.ts\n?? new-file.ts\nA  added.ts\n";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[33m"); // modified
    expect(out).toContain("\u001b[96m"); // untracked
    expect(out).toContain("\u001b[32m"); // added
  });

  it("colors JSON-ish keys, booleans, and numbers", () => {
    const plain = '{"ok": true, "count": 3, "name": "paseo"}';
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[94m"); // key
    expect(out).toContain("\u001b[95m"); // boolean
    expect(out).toContain("\u001b[93m"); // number
  });

  it("colors HTTP methods, status codes, timestamps, and hashes", () => {
    const plain = "GET /api 200 in 12ms at 2026-07-23T12:00:00Z sha abcdef0123456789";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[1;94m"); // method / info
    expect(out).toContain("\u001b[92m"); // 200 ok
    expect(out).toContain("\u001b[36m"); // timestamp
    expect(out).toContain("\u001b[90m"); // hash
  });

  it("colors 4xx/5xx status codes as errors", () => {
    const plain = "POST /login 401 then 503";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[91m"); // 401
    expect(out).toContain("\u001b[1;91m"); // 503
  });

  it("colors stack frames as errors", () => {
    const plain = "    at Object.<anonymous> (packages/app/src/x.ts:10:5)";
    const out = colorizeShellOutput(plain);
    expect(ansiToPlainText(out)).toBe(plain);
    expect(out).toContain("\u001b[1;91m");
  });

  it("preserves vendor-colored output", () => {
    const colored = "\u001b[32mpassed\u001b[0m";
    expect(colorizeShellOutput(colored)).toBe(colored);
  });
});

describe("buildShellAnsiDocument", () => {
  it("builds prompt + command + output with stable visible text", () => {
    const doc = buildShellAnsiDocument("echo hi # note", "hello\n");
    expect(ansiToPlainText(doc)).toBe("$ echo hi # note\n\nhello\n");
    expect(doc.startsWith("\u001b[1;32m$ \u001b[0m")).toBe(true);
  });

  it("omits the blank line when there is no output", () => {
    const doc = buildShellAnsiDocument("pwd", null);
    expect(ansiToPlainText(doc)).toBe("$ pwd");
  });
});
