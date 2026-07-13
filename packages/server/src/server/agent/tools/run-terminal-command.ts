import type { TerminalManager } from "../../../terminal/terminal-manager.js";

// Fork-owned helper behind the run_terminal_command MCP tool: write a command
// into a live terminal and wait for it to finish, then return the output the
// command produced.
//
// Completion is detected in three tiers of decreasing reliability:
// 1. OSC 633 command-finished (exact exit code) — only shells with Paseo's
//    shell integration emit it (locally spawned zsh; a remote shell only if it
//    has its own integration).
// 2. Output quiescence: once the terminal has echoed something, quietMs of
//    silence is treated as "probably done" (completed=false, exitCode=null).
// 3. timeoutMs cap. The command is NOT killed or interrupted on timeout — a
//    long build may still be running; callers can keep polling with
//    capture_terminal or send C-c via send_terminal_keys.

export interface RunTerminalCommandInput {
  terminalId: string;
  command: string;
  timeoutMs: number;
  quietMs: number;
}

export interface RunTerminalCommandResult {
  terminalId: string;
  // true only when the OSC 633 command-finished event was observed.
  completed: boolean;
  exitCode: number | null;
  output: string[];
  totalLines: number;
  // Head of the output may have been evicted from the scrollback ring buffer.
  truncated: boolean;
  durationMs: number;
}

// Mirrors the headless-xterm scrollback limit in terminal.ts (scrollback: 1000).
// Used only to flag possible ring-buffer eviction, never to slice.
const SCROLLBACK_LINE_LIMIT = 1000;

type FinishReason =
  | { kind: "command-finished"; exitCode: number | null }
  | { kind: "quiet" }
  | { kind: "timeout" }
  | { kind: "exit" }
  | { kind: "abort" };

export async function runTerminalCommand(
  terminalManager: TerminalManager,
  input: RunTerminalCommandInput,
  options?: { signal?: AbortSignal },
): Promise<RunTerminalCommandResult> {
  const session = terminalManager.getTerminal(input.terminalId);
  if (!session) {
    throw new Error(`Terminal ${input.terminalId} not found`);
  }
  if (session.getExitInfo()) {
    throw new Error(
      `Terminal ${input.terminalId} has exited; create a new terminal or reconnect first`,
    );
  }

  const baseline = await terminalManager.captureTerminal(input.terminalId, { stripAnsi: true });
  const startedAt = Date.now();

  // One promise per completion signal, raced below; each resolves at most
  // once and every listener/timer is torn down in the shared cleanup pass.
  // Everything attaches before the command is written so a fast-finishing
  // command cannot slip between send and subscribe.
  const cleanups: Array<() => void> = [];
  const signals: Array<Promise<FinishReason>> = [];

  signals.push(
    new Promise<FinishReason>((resolve) => {
      cleanups.push(
        session.onCommandFinished((info) =>
          resolve({ kind: "command-finished", exitCode: info.exitCode }),
        ),
      );
    }),
  );

  signals.push(
    new Promise<FinishReason>((resolve) => {
      // The terminal echoes the command itself, so every run produces at
      // least one output event and the quiet fallback always arms.
      let quietTimer: NodeJS.Timeout | null = null;
      cleanups.push(
        session.subscribe((msg) => {
          if (msg.type !== "output") {
            return;
          }
          if (quietTimer) {
            clearTimeout(quietTimer);
          }
          quietTimer = setTimeout(() => resolve({ kind: "quiet" }), input.quietMs);
        }),
      );
      cleanups.push(() => {
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
      });
    }),
  );

  signals.push(
    new Promise<FinishReason>((resolve) => {
      cleanups.push(session.onExit(() => resolve({ kind: "exit" })));
    }),
  );

  signals.push(
    new Promise<FinishReason>((resolve) => {
      const timeoutTimer = setTimeout(() => resolve({ kind: "timeout" }), input.timeoutMs);
      cleanups.push(() => clearTimeout(timeoutTimer));
    }),
  );

  const signal = options?.signal;
  if (signal) {
    signals.push(
      new Promise<FinishReason>((resolve) => {
        if (signal.aborted) {
          resolve({ kind: "abort" });
          return;
        }
        const onAbort = (): void => resolve({ kind: "abort" });
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }),
    );
  }

  let reason: FinishReason;
  try {
    // \r is Enter on a pty; normalize embedded newlines so multi-line snippets
    // execute instead of sitting in the input buffer.
    session.send({
      type: "input",
      data: `${input.command.replace(/\r?\n/g, "\r")}\r`,
    });
    reason = await Promise.race(signals);
  } finally {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // listener teardown is best-effort
      }
    }
  }

  const after = await terminalManager.captureTerminal(input.terminalId, { stripAnsi: true });

  // Captured lines always include the full visible grid, so the line COUNT
  // barely moves for short outputs — new content overwrites blank grid rows
  // instead of appending. Diff by content instead: everything past the longest
  // common line prefix is what the command changed, starting at the prompt
  // line the command was typed into.
  const output = diffCapturedLines(baseline.lines, after.lines);

  // Conservative eviction check: once the combined buffer (scrollback ring +
  // visible grid) is at capacity, older lines have started falling off and the
  // prefix diff can no longer see where the command started — the output then
  // holds only the most recent content.
  const capacity = SCROLLBACK_LINE_LIMIT + session.getSize().rows;
  const truncated = after.totalLines >= capacity;

  return {
    terminalId: input.terminalId,
    completed: reason.kind === "command-finished",
    exitCode: reason.kind === "command-finished" ? reason.exitCode : null,
    output,
    totalLines: after.totalLines,
    truncated,
    durationMs: Date.now() - startedAt,
  };
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

function diffCapturedLines(baselineLines: string[], afterLines: string[]): string[] {
  const baseline = trimTrailingBlankLines(baselineLines);
  const after = trimTrailingBlankLines(afterLines);
  let divergeIndex = 0;
  while (divergeIndex < baseline.length && baseline[divergeIndex] === after[divergeIndex]) {
    divergeIndex += 1;
  }
  return after.slice(divergeIndex);
}
