import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type {
  AgentMode,
  AgentModelDefinition,
  AgentSelectOption,
  ImportableProviderSession,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ListImportableSessionsOptions,
} from "../agent-sdk-types.js";
import { importSessionFromPersistence } from "../provider-session-import.js";
import type {
  ACPProviderModeWriteResult,
  ACPProviderModeWriterContext,
  SessionStateResponse,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
import {
  isGrokHiddenFromScrollbackUserChunk,
  mapGrokExtensionNotificationToTimelineItems,
} from "./grok-background-tasks.js";
import {
  getGrokLocalContextWindows,
  resolveGrokContextWindowMaxTokens,
} from "./grok-model-context.js";
import {
  listGrokImportableSessions,
  readGrokImportSessionConfig,
} from "./grok-session-descriptor.js";

interface GrokACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

/** Ask before non-safe tool runs (default Grok permission policy). */
export const GROK_DEFAULT_MODE_ID = "default";
/**
 * Skip permission prompts (Grok always-approve / YOLO).
 * Matches Claude's bypassPermissions id so unattended flows stay consistent.
 *
 * Upstream getpaseo/paseo#2177 uses id `always-approve` / label "Always Approve".
 * This fork keeps `bypassPermissions` for Claude-style unattended inheritance while
 * driving the same Grok native launch path (`--always-approve`).
 */
export const GROK_BYPASS_MODE_ID = "bypassPermissions";

/** Alias used in docs / upstream PR naming (same runtime mode as Bypass). */
export const GROK_ALWAYS_APPROVE_MODE_ID = GROK_BYPASS_MODE_ID;
/** Alias used in docs / upstream PR naming (same runtime mode as Always Ask). */
export const GROK_ASK_MODE_ID = GROK_DEFAULT_MODE_ID;

/**
 * Paseo-facing permission modes for Grok Build.
 *
 * Grok ACP also uses `session/set_mode` for reasoning effort (high/medium/low);
 * those are handled via thinking options, not this list. Permission modes are
 * enforced by Paseo (launch `--always-approve` for new sessions, local mode
 * state, and unattended auto-approve fallback).
 */
export const GROK_MODES: AgentMode[] = [
  {
    id: GROK_DEFAULT_MODE_ID,
    label: "Always Ask",
    description: "Prompts for permission before shell commands and file edits",
    icon: "ShieldCheck",
    colorTier: "safe",
  },
  {
    id: GROK_BYPASS_MODE_ID,
    label: "Always Approve",
    description:
      "Auto-approve all tool executions for this session via Grok's native always-approve mode. Allows potentially destructive shell commands and file operations.",
    icon: "ShieldOff",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

/**
 * Grok Build ACP adapter.
 *
 * Grok's agent mode exposes:
 * - Models via standard ACP `models` (with `_meta.reasoningEfforts` + `totalContextTokens`)
 * - Reasoning effort via `session/set_mode` with ids `high` | `medium` | `low`
 *   (not `session/set_config_option` / thought_level)
 * - Auth via `authenticate` with `cached_token` (or grok.com) before session/new
 * - Permission modes via:
 *   - `grok agent --always-approve stdio` (session launch when Always Approve)
 *   - Paseo-local mode state (providerModeWriter does not send a slash prompt —
 *     a blocking `connection.prompt` freezes create_agent / draft send)
 *   - Paseo unattended auto-approve fallback if Grok still emits request_permission
 *
 * Background-task UX (upstream #2182 / #2198): suppress model-only wake-up chunks
 * marked `_meta.hideFromScrollback === true`, and map `_x.ai/session/update` task
 * events to synthetic `tool_call` timeline items keyed by `task_id`.
 *
 * Session import: Grok ACP advertises `loadSession` but not `session/list`, so
 * import discovery reads `~/.grok/sessions/<encoded-cwd>/<id>/summary.json` and
 * resume still goes through ACP `session/load`.
 *
 * Docs: https://docs.x.ai/build/overview and local `~/.grok/docs/user-guide/15-agent-mode.md`.
 */
export class GrokACPAgentClient extends GenericACPAgentClient {
  constructor(options: GrokACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      provider: options.providerId ?? "grok",
      providerId: options.providerId ?? "grok",
      label: options.label ?? "Grok",
      // Grok CLI requires authenticate(cached_token) before session/new when using
      // interactive OIDC login stored in ~/.grok/auth.json.
      authenticateMethodId: "cached_token",
      defaultModes: GROK_MODES,
      modelTransformer: transformGrokModels,
      thinkingOptionWriter: writeGrokThinkingOption,
      sessionResponseTransformer: transformGrokSessionResponse,
      modeIdTransformer: transformGrokModeId,
      providerModeWriter: writeGrokProviderMode,
      launchArgsTransformer: transformGrokLaunchArgs,
      shouldSuppressUserMessageChunk: isGrokHiddenFromScrollbackUserChunk,
      extensionNotificationHandler: mapGrokExtensionNotificationToTimelineItems,
      providerParams: {
        supportsMcpServers: true,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
        },
        ...(options.providerParams && typeof options.providerParams === "object"
          ? (options.providerParams as Record<string, unknown>)
          : {}),
      },
    });
  }

  /**
   * List terminal-started Grok sessions from disk. Shared ACP `session/list`
   * is not implemented by Grok Build (returns Method not found).
   */
  override async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    return listGrokImportableSessions(options);
  }

  /**
   * Resume a Grok native session via ACP `session/load`, restoring model and
   * reasoning effort recorded in `summary.json` when present.
   */
  override async importSession(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ) {
    const importConfig = await readGrokImportSessionConfig(input.providerHandleId, {
      cwd: input.cwd,
    });
    return importSessionFromPersistence({
      provider: this.provider,
      request: input,
      context,
      resumeSession: this.resumeSession.bind(this),
      config: importConfig,
    });
  }
}

interface GrokReasoningEffort {
  id?: unknown;
  value?: unknown;
  label?: unknown;
  description?: unknown;
  default?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isGrokBypassModeId(modeId: string | null | undefined): boolean {
  return modeId === GROK_BYPASS_MODE_ID;
}

/**
 * Insert `--always-approve` before the `stdio` subcommand (or after `agent`)
 * so `grok agent --always-approve stdio` matches official ACP docs.
 */
export function injectGrokAlwaysApproveArgs(args: string[]): string[] {
  if (args.includes("--always-approve") || args.includes("--yolo")) {
    return args;
  }
  const stdioIdx = args.lastIndexOf("stdio");
  if (stdioIdx >= 0) {
    return [...args.slice(0, stdioIdx), "--always-approve", ...args.slice(stdioIdx)];
  }
  const agentIdx = args.indexOf("agent");
  if (agentIdx >= 0) {
    return [...args.slice(0, agentIdx + 1), "--always-approve", ...args.slice(agentIdx + 1)];
  }
  return ["--always-approve", ...args];
}

export function transformGrokLaunchArgs(args: string[], modeId: string | null): string[] {
  return isGrokBypassModeId(modeId) ? injectGrokAlwaysApproveArgs(args) : args;
}

/**
 * Keep Paseo permission modes as the source of truth. Grok ACP may advertise
 * reasoning-effort ids as session modes; those must not replace Bypass/Ask.
 */
export function transformGrokSessionResponse(response: SessionStateResponse): SessionStateResponse {
  const requestedBypass = isGrokBypassModeId(response.modes?.currentModeId ?? null);
  // Prefer any previously applied Paseo mode carried only via client config —
  // session/new from Grok typically has effort as currentModeId, so default to Ask.
  const currentModeId = requestedBypass ? GROK_BYPASS_MODE_ID : GROK_DEFAULT_MODE_ID;

  return {
    ...response,
    modes: {
      currentModeId,
      availableModes: GROK_MODES.map((mode) => ({
        id: mode.id,
        name: mode.label,
        description: mode.description ?? null,
      })),
    },
  };
}

/**
 * Ignore Grok effort-level ids when they arrive as current_mode_update so they
 * do not overwrite Always Ask / Always Approve in Paseo's mode picker.
 */
export function transformGrokModeId(modeId: string): string | null {
  if (modeId === GROK_DEFAULT_MODE_ID || modeId === GROK_BYPASS_MODE_ID) {
    return modeId;
  }
  return null;
}

/**
 * Permission modes are local to Paseo for Grok.
 *
 * Native always-approve is applied only at process launch via
 * `transformGrokLaunchArgs` (`--always-approve`). Do **not** call
 * `connection.prompt("/always-approve …")` here:
 *
 * - ACP `prompt()` starts a full agent turn and only resolves when that turn
 *   finishes.
 * - Session create runs `applyConfiguredOverrides` → `setMode` before the
 *   create_agent response returns. A blocking slash-command turn freezes the
 *   workspace draft composer (send on new conversation appears stuck).
 * - After session/new, `transformGrokSessionResponse` maps Grok effort ids to
 *   Always Ask even when the process already launched with `--always-approve`,
 *   so bootstrap always looks like "switch to Bypass" and would re-prompt.
 *
 * Mid-session Always Approve still sets `isUnattended` so Paseo auto-approves
 * `request_permission`. Do not use ACP `setSessionMode` for permission modes
 * either — that path is reserved for reasoning effort via thinkingOptionWriter.
 */
export async function writeGrokProviderMode(
  context: ACPProviderModeWriterContext,
): Promise<ACPProviderModeWriteResult> {
  if (
    context.requestedModeId === GROK_DEFAULT_MODE_ID ||
    context.requestedModeId === GROK_BYPASS_MODE_ID
  ) {
    return {
      handled: true,
      currentModeId: context.requestedModeId,
    };
  }

  return { handled: false };
}

/**
 * Map Grok model `_meta.reasoningEfforts` into Paseo thinking options so the
 * composer effort control appears under the input box (same UX as Claude).
 *
 * Context windows are resolved from config.toml first, then ACP `_meta`,
 * models_cache.json, then known-model defaults — see
 * `resolveGrokContextWindowMaxTokens`.
 */
export function transformGrokModels(models: AgentModelDefinition[]): AgentModelDefinition[] {
  const localWindows = getGrokLocalContextWindows();
  return models.map((model) => {
    const meta = isRecord(model.metadata) ? model.metadata : null;
    const rawEfforts = Array.isArray(meta?.reasoningEfforts)
      ? (meta.reasoningEfforts as GrokReasoningEffort[])
      : null;
    const thinkingOptions = rawEfforts
      ? rawEfforts
          .map((entry): AgentSelectOption | null => {
            const id = asNonEmptyString(entry.id) ?? asNonEmptyString(entry.value);
            if (!id) return null;
            const label = asNonEmptyString(entry.label) ?? id;
            const description = asNonEmptyString(entry.description) ?? undefined;
            return {
              id,
              label,
              description,
              isDefault: entry.default === true,
            };
          })
          .filter((option): option is AgentSelectOption => option !== null)
      : (model.thinkingOptions ?? undefined);

    const contextWindowMaxTokens = resolveGrokContextWindowMaxTokens({
      modelId: model.id,
      meta,
      existing: model.contextWindowMaxTokens,
      localWindows,
    });

    const defaultThinkingOptionId =
      thinkingOptions?.find((option) => option.isDefault)?.id ??
      model.defaultThinkingOptionId ??
      thinkingOptions?.[0]?.id;

    return {
      ...model,
      thinkingOptions: thinkingOptions && thinkingOptions.length > 0 ? thinkingOptions : undefined,
      defaultThinkingOptionId,
      contextWindowMaxTokens,
      metadata: {
        ...model.metadata,
        ...(contextWindowMaxTokens !== undefined
          ? { contextWindowMaxTokens, totalContextTokens: contextWindowMaxTokens }
          : {}),
      },
    };
  });
}

/**
 * Grok maps reasoning effort onto ACP session modes (high/medium/low).
 * Paseo treats those as thinking options and writes them via setSessionMode.
 */
export async function writeGrokThinkingOption(
  connection: ClientSideConnection,
  sessionId: string,
  thinkingOptionId: string,
): Promise<void> {
  await connection.setSessionMode({
    sessionId,
    modeId: thinkingOptionId,
  });
}
