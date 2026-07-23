/**
 * Lightweight ANSI colorization for shell tool cards.
 *
 * - Command: syntax tokens (name / flags / strings / comments / operators /
 *   paths / globs / env assignments / substitutions).
 * - Output: auto semantic coloring for plain text (most tool captures strip
 *   native ANSI). Severity lines, diffs, git status, JSON-ish lines, logs,
 *   paths, URLs, timestamps, SHAs, numbers, and booleans get distinct SGR;
 *   already-ANSI output is preserved.
 *
 * Tokens map to the 16-color SGR set so they pick up the user's terminal palette.
 * Visible (stripped) text is never altered — find-highlight offsets stay valid.
 */

const ESC_CHAR = "\x1b";
const ESC = `${ESC_CHAR}[`;
const RESET = `${ESC}0m`;

/** Named SGR codes used for shell command / output roles. */
export const SHELL_ANSI: Record<string, string> = {
  prompt: `${ESC}1;32m`, // bold green — the `$ ` cue
  command: `${ESC}1;97m`, // bold bright white — command args
  comment: `${ESC}2;90m`, // dim bright-black — comments
  string: `${ESC}33m`, // yellow — quoted strings
  flag: `${ESC}36m`, // cyan — -f / --flag
  operator: `${ESC}1;35m`, // bold magenta — | && || ; > <
  variable: `${ESC}95m`, // bright magenta — $VAR / ${VAR}
  commandName: `${ESC}1;96m`, // bold bright cyan — first word of each segment
  path: `${ESC}96m`, // bright cyan — paths in command/output
  glob: `${ESC}35m`, // magenta — * ? [] globs
  assignment: `${ESC}94m`, // bright blue — KEY= in env assigns
  substitution: `${ESC}1;95m`, // bold bright magenta — $(...) / `...`
  number: `${ESC}93m`, // bright yellow
  /** Default plain stdout body (softer than the command line). */
  output: `${ESC}37m`,
  outputMuted: `${ESC}2;90m`,
  outputError: `${ESC}1;91m`,
  outputWarn: `${ESC}1;93m`,
  outputSuccess: `${ESC}1;92m`,
  outputInfo: `${ESC}1;94m`,
  outputPath: `${ESC}96m`,
  outputNumber: `${ESC}93m`,
  outputDiffAdd: `${ESC}32m`,
  outputDiffDel: `${ESC}31m`,
  outputKey: `${ESC}94m`, // JSON / log keys
  outputBoolean: `${ESC}95m`, // true/false/null
  outputHash: `${ESC}90m`, // dim — SHAs / hex ids
  outputTimestamp: `${ESC}36m`, // cyan — timestamps
  outputHttpOk: `${ESC}92m`, // 2xx
  outputHttpRedirect: `${ESC}93m`, // 3xx
  outputHttpClientErr: `${ESC}91m`, // 4xx
  outputHttpServerErr: `${ESC}1;91m`, // 5xx
  outputGitAdd: `${ESC}32m`,
  outputGitMod: `${ESC}33m`,
  outputGitDel: `${ESC}31m`,
  outputGitUntracked: `${ESC}96m`,
};

export function textHasAnsi(text: string): boolean {
  return text.includes(ESC_CHAR);
}

function wrap(sgr: string, text: string): string {
  if (text.length === 0) return "";
  return `${sgr}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Output coloring
// ---------------------------------------------------------------------------

/**
 * Auto-color plain shell stdout/stderr for the tool card.
 * Preserves vendor ANSI when present (e.g. `ls --color`, test runners).
 */
export function colorizeShellOutput(output: string): string {
  if (output.length === 0 || textHasAnsi(output)) {
    return output;
  }

  const parts = output.split(/(\r\n|\n|\r)/);
  let result = "";
  for (const part of parts) {
    if (part === "\n" || part === "\r" || part === "\r\n") {
      result += part;
      continue;
    }
    if (part.length === 0) continue;
    result += colorizeOutputLine(part);
  }
  return result;
}

type OutputLineKind =
  | "error"
  | "warn"
  | "success"
  | "info"
  | "diffAdd"
  | "diffDel"
  | "gitAdd"
  | "gitMod"
  | "gitDel"
  | "gitUntracked"
  | "muted"
  | "json"
  | "plain";

function classifyOutputLine(line: string): OutputLineKind {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "muted";

  const diffKind = classifyDiffLine(trimmed);
  if (diffKind) return diffKind;

  const gitKind = classifyGitLine(trimmed);
  if (gitKind) return gitKind;

  if (isJsonishLine(trimmed)) return "json";

  const severity = classifySeverityLine(line, trimmed);
  if (severity) return severity;

  if (/^[-=_*~.]{3,}$/.test(trimmed)) return "muted";
  if (/^[│├└─┌┐┘┴┬┤┼╔╗╚╝║═\s]+$/.test(trimmed)) return "muted";

  return "plain";
}

function classifyDiffLine(trimmed: string): OutputLineKind | null {
  if (/^diff --git |^index [0-9a-f]+\.\.|^\+\+\+ |^--- |^@@ /.test(trimmed)) {
    return "info";
  }
  if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) return "diffAdd";
  if (trimmed.startsWith("-") && !trimmed.startsWith("---")) return "diffDel";
  return null;
}

function classifyGitLine(trimmed: string): OutputLineKind | null {
  const gitStatus = trimmed.match(/^([ MADRCU?!]{1,2})\s+\S/);
  if (gitStatus) {
    const code = gitStatus[1]!.replace(/ /g, "");
    if (code.includes("?") || code === "!") return "gitUntracked";
    if (code.includes("D")) return "gitDel";
    if (code.includes("A") || code.includes("C")) return "gitAdd";
    if (code.includes("M") || code.includes("R") || code.includes("U")) return "gitMod";
  }
  if (/^Changes (not staged|to be committed)|^Untracked files:|^On branch /i.test(trimmed)) {
    return "info";
  }
  return null;
}

function isJsonishLine(trimmed: string): boolean {
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return true;
  if (/^"[^"]+"\s*:/.test(trimmed) || /^\s*"[^"]+"\s*:/.test(trimmed)) return true;
  return false;
}

function classifySeverityLine(line: string, trimmed: string): OutputLineKind | null {
  if (
    /\b(error|err!|fatal|panic|failed|failure|exception|traceback|denied|refused|ENOENT|EACCES|EPERM|ECONNREFUSED|TypeError|ReferenceError|SyntaxError)\b/i.test(
      trimmed,
    ) ||
    /^\s*[✗×✖]|^\s*FAIL(ED)?\b|^\s*\[ERROR\]|^\s*ERROR[:\s]/i.test(trimmed) ||
    /^\s+at\s+\S+/.test(line) ||
    /^\s*File ".+", line \d+/.test(trimmed)
  ) {
    return "error";
  }
  if (
    /\b(warning|warn|deprecated|timeout|retrying|slow)\b/i.test(trimmed) ||
    /^\s*⚠|^\s*\[WARN(ING)?\]|^\s*WARN[:\s]/i.test(trimmed)
  ) {
    return "warn";
  }
  if (
    /\b(passed|passing|success|successful|succeeded|done|completed|ready|installed|built)\b/i.test(
      trimmed,
    ) ||
    /^\s*[✓✔✅]|^\s*PASS(ED)?\b|^\s*\[OK\]|^\s*OK\b|^\s*ok\b/i.test(trimmed)
  ) {
    return "success";
  }
  if (
    /^\s*(info|debug|trace|note|log)\b/i.test(trimmed) ||
    /^\s*[→›»]|^\s*\[INFO\]|^\s*\[DEBUG\]|^\s*\[TRACE\]/i.test(trimmed)
  ) {
    return "info";
  }
  return null;
}

function lineKindSgr(kind: OutputLineKind): string {
  switch (kind) {
    case "error":
      return SHELL_ANSI.outputError;
    case "warn":
      return SHELL_ANSI.outputWarn;
    case "success":
      return SHELL_ANSI.outputSuccess;
    case "info":
      return SHELL_ANSI.outputInfo;
    case "diffAdd":
    case "gitAdd":
      return SHELL_ANSI.outputDiffAdd;
    case "diffDel":
    case "gitDel":
      return SHELL_ANSI.outputDiffDel;
    case "gitMod":
      return SHELL_ANSI.outputGitMod;
    case "gitUntracked":
      return SHELL_ANSI.outputGitUntracked;
    case "muted":
      return SHELL_ANSI.outputMuted;
    case "json":
    case "plain":
      return SHELL_ANSI.output;
  }
}

function colorizeOutputLine(line: string): string {
  const kind = classifyOutputLine(line);

  // Diff / git whole-line tints — signal over tokens.
  if (
    kind === "diffAdd" ||
    kind === "diffDel" ||
    kind === "gitAdd" ||
    kind === "gitMod" ||
    kind === "gitDel" ||
    kind === "gitUntracked" ||
    kind === "muted"
  ) {
    return wrap(lineKindSgr(kind), line);
  }

  // JSON-ish: token highlight with key/string/number/bool.
  if (kind === "json") {
    return colorizeJsonishLine(line);
  }

  // Severity / info / success / error: base line tint + path/url/number tokens
  // so file locations still pop inside an error banner.
  if (kind !== "plain") {
    return colorizeOutputTokens(line, lineKindSgr(kind));
  }

  return colorizeOutputTokens(line, SHELL_ANSI.output);
}

// ---- Token regexes (output) ----

const URL_RE = /https?:\/\/[^\s"'`]+/g;
const PATH_RE =
  /(?:~|\/|\.\.?\/|[A-Za-z]:\\)[^\s"'`,;]+|(?:[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12})(?::\d+(?::\d+)?)?/g;
const NUMBER_RE = /\d+(?:\.\d+)?(?:ms|s|m|h|kb|mb|gb|tb|%)?/gi;
const QUOTED_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const TIMESTAMP_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
const HASH_RE = /\b[0-9a-f]{7,40}\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BOOLEAN_RE = /\b(true|false|null|undefined|NaN|Infinity)\b/g;
const HTTP_METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const HTTP_STATUS_RE = /\b([1-5]\d{2})\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LOG_LEVEL_RE = /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|SUCCESS)\b/g;
const INLINE_SEVERITY_RE =
  /\b(error|failed|failure|exception|warning|deprecated|passed|success|ok)\b/gi;

interface Span {
  start: number;
  end: number;
  sgr: string;
  priority: number; // higher wins when sorting equal starts
}

function colorizeOutputTokens(line: string, baseSgr: string): string {
  const spans: Span[] = [];

  collectSpans(line, URL_RE, SHELL_ANSI.outputPath, 50, spans);
  collectSpans(line, EMAIL_RE, SHELL_ANSI.outputPath, 48, spans);
  collectSpans(line, PATH_RE, SHELL_ANSI.outputPath, 40, spans);
  collectSpans(line, UUID_RE, SHELL_ANSI.outputHash, 45, spans);
  collectSpans(line, TIMESTAMP_RE, SHELL_ANSI.outputTimestamp, 42, spans);
  collectSpans(line, HASH_RE, SHELL_ANSI.outputHash, 30, spans);
  collectSpans(line, QUOTED_RE, SHELL_ANSI.string, 55, spans);
  collectSpans(line, BOOLEAN_RE, SHELL_ANSI.outputBoolean, 35, spans);
  collectSpans(line, HTTP_METHOD_RE, SHELL_ANSI.outputInfo, 38, spans);
  collectHttpStatusSpans(line, spans);
  collectSpans(line, LOG_LEVEL_RE, SHELL_ANSI.outputInfo, 36, spans);
  collectInlineSeveritySpans(line, spans);
  collectSpans(line, NUMBER_RE, SHELL_ANSI.outputNumber, 20, spans);

  return applySpans(line, spans, baseSgr);
}

function colorizeJsonishLine(line: string): string {
  const spans: Span[] = [];
  // JSON keys: "key":
  collectSpans(line, /"[^"\\]*(?:\\.[^"\\]*)*"\s*:/g, SHELL_ANSI.outputKey, 60, spans);
  collectSpans(line, QUOTED_RE, SHELL_ANSI.string, 50, spans);
  collectSpans(line, BOOLEAN_RE, SHELL_ANSI.outputBoolean, 40, spans);
  collectSpans(line, NUMBER_RE, SHELL_ANSI.outputNumber, 30, spans);
  collectSpans(line, URL_RE, SHELL_ANSI.outputPath, 45, spans);
  return applySpans(line, spans, SHELL_ANSI.output);
}

function collectHttpStatusSpans(line: string, out: Span[]): void {
  const pattern = new RegExp(HTTP_STATUS_RE.source, HTTP_STATUS_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const code = Number(match[1]);
    let sgr = SHELL_ANSI.outputNumber;
    if (code >= 200 && code < 300) sgr = SHELL_ANSI.outputHttpOk;
    else if (code >= 300 && code < 400) sgr = SHELL_ANSI.outputHttpRedirect;
    else if (code >= 400 && code < 500) sgr = SHELL_ANSI.outputHttpClientErr;
    else if (code >= 500 && code < 600) sgr = SHELL_ANSI.outputHttpServerErr;
    out.push({
      start: match.index,
      end: match.index + match[0].length,
      sgr,
      priority: 37,
    });
  }
}

function collectInlineSeveritySpans(line: string, out: Span[]): void {
  const pattern = new RegExp(INLINE_SEVERITY_RE.source, INLINE_SEVERITY_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const word = match[0].toLowerCase();
    let sgr = SHELL_ANSI.outputInfo;
    if (word === "error" || word === "failed" || word === "failure" || word === "exception") {
      sgr = SHELL_ANSI.outputError;
    } else if (word === "warning" || word === "deprecated") {
      sgr = SHELL_ANSI.outputWarn;
    } else if (word === "passed" || word === "success" || word === "ok") {
      sgr = SHELL_ANSI.outputSuccess;
    }
    out.push({
      start: match.index,
      end: match.index + match[0].length,
      sgr,
      priority: 34,
    });
  }
}

function collectSpans(line: string, re: RegExp, sgr: string, priority: number, out: Span[]): void {
  const pattern = new RegExp(re.source, re.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    out.push({
      start: match.index,
      end: match.index + match[0].length,
      sgr,
      priority,
    });
  }
}

function applySpans(line: string, spans: Span[], baseSgr: string): string {
  if (spans.length === 0) {
    return wrap(baseSgr, line);
  }

  // Prefer earlier start; for same start, higher priority then longer span.
  spans.sort((a, b) => a.start - b.start || b.priority - a.priority || b.end - a.end);

  const nonOverlapping: Span[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    nonOverlapping.push(span);
    cursor = span.end;
  }

  let result = "";
  let i = 0;
  for (const span of nonOverlapping) {
    if (span.start > i) {
      result += wrap(baseSgr, line.slice(i, span.start));
    }
    result += wrap(span.sgr, line.slice(span.start, span.end));
    i = span.end;
  }
  if (i < line.length) {
    result += wrap(baseSgr, line.slice(i));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Command coloring
// ---------------------------------------------------------------------------

/**
 * Colorize a shell command string for display. Idempotent for already-ANSI text.
 */
export function colorizeShellCommand(command: string): string {
  if (command.length === 0 || textHasAnsi(command)) {
    return command;
  }

  let result = "";
  let i = 0;
  let atSegmentStart = true;

  while (i < command.length) {
    const step = nextCommandToken(command, i, atSegmentStart);
    result += step.fragment;
    i = step.nextIndex;
    atSegmentStart = step.atSegmentStart;
  }

  return result;
}

interface CommandTokenStep {
  fragment: string;
  nextIndex: number;
  atSegmentStart: boolean;
}

function nextCommandToken(
  command: string,
  index: number,
  atSegmentStart: boolean,
): CommandTokenStep {
  const ch = command[index]!;

  if (ch === "\n" || ch === "\r") {
    return { fragment: ch, nextIndex: index + 1, atSegmentStart: true };
  }

  if (ch === "#" && isCommentStart(command, index)) {
    return takeComment(command, index, atSegmentStart);
  }

  if (ch === "'") {
    return takeSingleQuoted(command, index);
  }

  if (ch === '"') {
    return takeDoubleQuoted(command, index);
  }

  // Backtick command substitution
  if (ch === "`") {
    return takeBacktick(command, index);
  }

  // $(...) command substitution
  if (ch === "$" && command[index + 1] === "(") {
    return takeDollarParen(command, index);
  }

  if (isOperatorStart(ch)) {
    return takeOperator(command, index);
  }

  if (/\s/.test(ch)) {
    return { fragment: ch, nextIndex: index + 1, atSegmentStart };
  }

  if (ch === "$") {
    return takeVariable(command, index);
  }

  return takeWord(command, index, atSegmentStart);
}

function takeComment(command: string, index: number, atSegmentStart: boolean): CommandTokenStep {
  let end = index + 1;
  while (end < command.length && command[end] !== "\n" && command[end] !== "\r") {
    end += 1;
  }
  return {
    fragment: wrap(SHELL_ANSI.comment, command.slice(index, end)),
    nextIndex: end,
    atSegmentStart,
  };
}

function takeSingleQuoted(command: string, index: number): CommandTokenStep {
  let end = index + 1;
  while (end < command.length && command[end] !== "'") {
    end += 1;
  }
  if (end < command.length) end += 1;
  return {
    fragment: wrap(SHELL_ANSI.string, command.slice(index, end)),
    nextIndex: end,
    atSegmentStart: false,
  };
}

function takeDoubleQuoted(command: string, index: number): CommandTokenStep {
  let end = index + 1;
  while (end < command.length) {
    if (command[end] === "\\") {
      end += 2;
      continue;
    }
    if (command[end] === '"') {
      end += 1;
      break;
    }
    end += 1;
  }
  return {
    fragment: wrap(SHELL_ANSI.string, command.slice(index, end)),
    nextIndex: end,
    atSegmentStart: false,
  };
}

function takeBacktick(command: string, index: number): CommandTokenStep {
  let end = index + 1;
  while (end < command.length && command[end] !== "`") {
    if (command[end] === "\\") {
      end += 2;
      continue;
    }
    end += 1;
  }
  if (end < command.length) end += 1;
  return {
    fragment: wrap(SHELL_ANSI.substitution, command.slice(index, end)),
    nextIndex: end,
    atSegmentStart: false,
  };
}

function takeDollarParen(command: string, index: number): CommandTokenStep {
  let end = index + 2;
  let depth = 1;
  while (end < command.length && depth > 0) {
    const c = command[end]!;
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    end += 1;
  }
  return {
    fragment: wrap(SHELL_ANSI.substitution, command.slice(index, end)),
    nextIndex: end,
    atSegmentStart: false,
  };
}

function takeOperator(command: string, index: number): CommandTokenStep {
  const { text, length, startsNewSegment } = readOperator(command, index);
  return {
    fragment: wrap(SHELL_ANSI.operator, text),
    nextIndex: index + length,
    atSegmentStart: startsNewSegment,
  };
}

function takeVariable(command: string, index: number): CommandTokenStep {
  const { text, length } = readVariable(command, index);
  return {
    fragment: wrap(SHELL_ANSI.variable, text),
    nextIndex: index + length,
    atSegmentStart: false,
  };
}

function takeWord(command: string, index: number, atSegmentStart: boolean): CommandTokenStep {
  const { text, length } = readWord(command, index);

  // ENV=value assignment at segment start
  const assign = text.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (assign && atSegmentStart) {
    const key = assign[1]!;
    const value = assign[2]!;
    const fragment =
      wrap(SHELL_ANSI.assignment, `${key}=`) +
      (value.length > 0 ? wrap(SHELL_ANSI.string, value) : "");
    return {
      fragment,
      nextIndex: index + length,
      // Keep atSegmentStart true so `FOO=1 npm test` still colors `npm` as name.
      atSegmentStart: true,
    };
  }

  let sgr = SHELL_ANSI.command;
  if (text.startsWith("-") && text.length > 1) {
    sgr = SHELL_ANSI.flag;
  } else if (atSegmentStart) {
    sgr = SHELL_ANSI.commandName;
  } else if (/[*?[]/.test(text)) {
    // Globs before paths — `./src/*.ts` is a glob pattern, not a plain path.
    sgr = SHELL_ANSI.glob;
  } else if (looksLikePath(text)) {
    sgr = SHELL_ANSI.path;
  } else if (/^\d+(?:\.\d+)?$/.test(text)) {
    sgr = SHELL_ANSI.number;
  }

  return {
    fragment: wrap(sgr, text),
    nextIndex: index + length,
    atSegmentStart: false,
  };
}

function looksLikePath(text: string): boolean {
  if (
    text.startsWith("/") ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.startsWith("~/")
  ) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  // file.ext (not a bare extensionless word)
  return /^[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12}$/.test(text);
}

/**
 * Full shell card document: green prompt + colorized command + optional blank
 * line + auto-colored (or vendor-ANSI) output. Visible text (ANSI stripped) is
 * unchanged from `$ cmd\n\noutput` so find-highlight offsets stay valid.
 */
export function buildShellAnsiDocument(command: string, output: string | null | undefined): string {
  const normalizedCommand = command.replace(/\n+$/, "");
  const rawOutput = output ?? "";
  const commandOutput = rawOutput.replace(/^\n+/, "");
  const hasOutput = commandOutput.length > 0;

  const prompt = `${SHELL_ANSI.prompt}$ ${RESET}`;
  const coloredCommand = colorizeShellCommand(normalizedCommand);

  if (!hasOutput) {
    return `${prompt}${coloredCommand}`;
  }
  return `${prompt}${coloredCommand}\n\n${colorizeShellOutput(commandOutput)}`;
}

function isCommentStart(command: string, index: number): boolean {
  if (command[index] !== "#") return false;
  if (index === 0) return true;
  const prev = command[index - 1]!;
  return /[\s;|&<>()]/.test(prev);
}

function isOperatorStart(ch: string): boolean {
  return "|;&<>".includes(ch);
}

function readOperator(
  command: string,
  index: number,
): { text: string; length: number; startsNewSegment: boolean } {
  const two = command.slice(index, index + 2);
  if (
    two === "&&" ||
    two === "||" ||
    two === ">>" ||
    two === "<<" ||
    two === ">&" ||
    two === "<&"
  ) {
    return { text: two, length: 2, startsNewSegment: two === "&&" || two === "||" };
  }
  const ch = command[index]!;
  if (ch === "|" || ch === ";") {
    return { text: ch, length: 1, startsNewSegment: true };
  }
  return { text: ch, length: 1, startsNewSegment: false };
}

function readVariable(command: string, index: number): { text: string; length: number } {
  if (command[index + 1] === "{") {
    let end = index + 2;
    while (end < command.length && command[end] !== "}") {
      end += 1;
    }
    if (end < command.length) end += 1;
    return { text: command.slice(index, end), length: end - index };
  }
  let end = index + 1;
  if (end < command.length && /[?$!0-9@*#-]/.test(command[end]!)) {
    return { text: command.slice(index, end + 1), length: 2 };
  }
  while (end < command.length && /[A-Za-z0-9_]/.test(command[end]!)) {
    end += 1;
  }
  if (end === index + 1) {
    return { text: "$", length: 1 };
  }
  return { text: command.slice(index, end), length: end - index };
}

function readWord(command: string, index: number): { text: string; length: number } {
  let end = index;
  while (end < command.length) {
    const ch = command[end]!;
    if (/\s/.test(ch)) break;
    if (ch === "#" && isCommentStart(command, end)) break;
    if (ch === "'" || ch === '"') break;
    if (ch === "`") break;
    if (ch === "$") break;
    if (isOperatorStart(ch)) break;
    if (ch === "\n" || ch === "\r") break;
    end += 1;
  }
  return { text: command.slice(index, end), length: Math.max(1, end - index) };
}
