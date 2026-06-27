import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { spawnProcess } from "../../../../utils/spawn.js";
import {
  buildCodexAppServerInitializeParams,
  findDefaultCodexBinary,
} from "../codex-app-server-agent.js";
import { CodexAppServerClient } from "./app-server-transport.js";

// Short-lived Codex app-server RPC helpers for ChatGPT account rate limits.
//
// The daemon spawns a throwaway `codex app-server`, runs `initialize` +
// `initialized`, issues one request, and disposes — mirroring the existing
// utility flows (model/list, thread/list) in codex-app-server-agent.ts. These
// account RPCs are global to the app server, so no thread/turn is involved.
//
// IMPORTANT: the live response shape drifts from the upstream README, so every
// schema here is `.passthrough()` with all fields optional/nullable. Codex
// 0.140.0 returns `rateLimits` + `rateLimitsByLimitId` (and omits the README's
// top-level `rateLimitResetCredits` when the backend grants no resets).

const APP_SERVER_REQUEST_TIMEOUT_MS = 20_000;

const RateWindowSchema = z
  .object({
    usedPercent: z.number().nullish(),
    windowDurationMins: z.number().nullish(),
    resetsAt: z.number().nullish(),
  })
  .passthrough();

const RateLimitsSchema = z
  .object({
    limitId: z.string().nullish(),
    limitName: z.string().nullish(),
    primary: RateWindowSchema.nullish(),
    secondary: RateWindowSchema.nullish(),
    credits: z
      .object({
        hasCredits: z.boolean().nullish(),
        unlimited: z.boolean().nullish(),
        balance: z.union([z.string(), z.number()]).nullish(),
      })
      .nullish(),
    planType: z.string().nullish(),
    rateLimitReachedType: z.string().nullish(),
  })
  .passthrough();

const RateLimitsReadResponseSchema = z
  .object({
    rateLimits: RateLimitsSchema.nullish(),
    rateLimitsByLimitId: z.record(z.string(), RateLimitsSchema).nullish(),
    rateLimitResetCredits: z.object({ availableCount: z.number().nullish() }).nullish(),
  })
  .passthrough();

const ConsumeResponseSchema = z.object({ outcome: z.string() }).passthrough();

type RateWindowRaw = z.infer<typeof RateWindowSchema>;
type RateLimitsRaw = z.infer<typeof RateLimitsSchema>;
type RateLimitsReadResponse = z.infer<typeof RateLimitsReadResponseSchema>;

export interface CodexRateWindow {
  usedPct: number | null;
  windowDurationMins: number | null;
  resetsAt: string | null;
}

export interface CodexAccountRateLimits {
  planType: string | null;
  rateLimitReached: boolean;
  rateLimitReachedType: string | null;
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  credits: {
    hasCredits: boolean | null;
    unlimited: boolean | null;
    balanceUsd: number | null;
  } | null;
  availableResetCredits: number | null;
}

export type CodexResetConsumeOutcome = "reset" | "nothingToReset" | "noCredit" | "unavailable";

export interface CodexAccountRpcOptions {
  logger: Logger;
  codexHome?: string;
}

// Cheap pre-check so we never spawn an app-server for users who have never
// logged Codex in. Existence-only (matches the legacy provider's candidate
// list); apiKey-mode auth still spawns and yields nulls, handled downstream.
export function codexAuthFileExists(codexHome?: string): boolean {
  const home = codexHome || process.env.CODEX_HOME || join(homedir(), ".codex");
  const candidates = [
    ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, "auth.json")] : []),
    join(homedir(), ".config", "codex", "auth.json"),
    join(home, "auth.json"),
  ];
  return candidates.some((path) => existsSync(path));
}

async function withCodexAppServer<T>(
  options: CodexAccountRpcOptions,
  fn: (client: CodexAppServerClient) => Promise<T>,
): Promise<T> {
  const binary = await findDefaultCodexBinary();
  if (!binary) {
    throw new Error("Codex binary not found");
  }
  const child = spawnProcess(binary, ["app-server"], {
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    envOverlay: options.codexHome ? { CODEX_HOME: options.codexHome } : undefined,
  });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Codex app-server did not expose stdio pipes");
  }
  const client = new CodexAppServerClient(child as ChildProcessWithoutNullStreams, options.logger);
  try {
    await client.request(
      "initialize",
      buildCodexAppServerInitializeParams(),
      APP_SERVER_REQUEST_TIMEOUT_MS,
    );
    client.notify("initialized", {});
    return await fn(client);
  } finally {
    await client.dispose();
  }
}

function parseUsdBalance(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(num) ? num : null;
}

function toWindow(window: RateWindowRaw | null | undefined): CodexRateWindow | null {
  if (!window) return null;
  return {
    usedPct: typeof window.usedPercent === "number" ? window.usedPercent : null,
    windowDurationMins:
      typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
    resetsAt:
      typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

// Prefer the top-level `rateLimits`; fall back to the per-limit map (the `codex`
// limit, else the first entry) so we survive either response shape.
function pickRateLimits(parsed: RateLimitsReadResponse): RateLimitsRaw | null {
  if (parsed.rateLimits) return parsed.rateLimits;
  const byId = parsed.rateLimitsByLimitId;
  if (byId) {
    return byId.codex ?? Object.values(byId)[0] ?? null;
  }
  return null;
}

export async function readCodexAccountRateLimits(
  options: CodexAccountRpcOptions,
): Promise<CodexAccountRateLimits> {
  const raw = await withCodexAppServer(options, (client) =>
    client.request("account/rateLimits/read", {}, APP_SERVER_REQUEST_TIMEOUT_MS),
  );
  const parsed = RateLimitsReadResponseSchema.parse(raw);
  const rl = pickRateLimits(parsed);

  return {
    planType: rl?.planType ?? null,
    rateLimitReached: rl?.rateLimitReachedType != null,
    rateLimitReachedType: rl?.rateLimitReachedType ?? null,
    primary: toWindow(rl?.primary),
    secondary: toWindow(rl?.secondary),
    credits: rl?.credits
      ? {
          hasCredits: rl.credits.hasCredits ?? null,
          unlimited: rl.credits.unlimited ?? null,
          balanceUsd: parseUsdBalance(rl.credits.balance),
        }
      : null,
    availableResetCredits:
      typeof parsed.rateLimitResetCredits?.availableCount === "number"
        ? parsed.rateLimitResetCredits.availableCount
        : null,
  };
}

export async function consumeCodexRateLimitResetCredit(
  options: CodexAccountRpcOptions & { idempotencyKey: string },
): Promise<CodexResetConsumeOutcome> {
  const raw = await withCodexAppServer(options, (client) =>
    client.request(
      "account/rateLimitResetCredit/consume",
      { idempotencyKey: options.idempotencyKey },
      APP_SERVER_REQUEST_TIMEOUT_MS,
    ),
  );
  const outcome = ConsumeResponseSchema.parse(raw).outcome;
  if (outcome === "reset" || outcome === "nothingToReset" || outcome === "noCredit") {
    return outcome;
  }
  // Unknown outcome string — don't guess; report as unavailable.
  return "unavailable";
}
