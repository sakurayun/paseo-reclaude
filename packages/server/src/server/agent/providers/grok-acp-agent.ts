import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type { AgentModelDefinition, AgentSelectOption } from "../agent-sdk-types.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface GrokACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

/**
 * Grok Build ACP adapter.
 *
 * Grok's agent mode exposes:
 * - Models via standard ACP `models` (with `_meta.reasoningEfforts` + `totalContextTokens`)
 * - Reasoning effort via `session/set_mode` with ids `high` | `medium` | `low`
 *   (not `session/set_config_option` / thought_level)
 * - Auth via `authenticate` with `cached_token` (or grok.com) before session/new
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
      modelTransformer: transformGrokModels,
      thinkingOptionWriter: writeGrokThinkingOption,
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

/**
 * Map Grok model `_meta.reasoningEfforts` into Paseo thinking options so the
 * composer effort control appears under the input box (same UX as Claude).
 */
export function transformGrokModels(models: AgentModelDefinition[]): AgentModelDefinition[] {
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

    const contextWindowMaxTokens =
      typeof meta?.totalContextTokens === "number" && Number.isFinite(meta.totalContextTokens)
        ? meta.totalContextTokens
        : model.contextWindowMaxTokens;

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
