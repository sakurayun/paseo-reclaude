import type { Logger } from "pino";

import type {
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { GenericACPAgentClient } from "../generic-acp-agent.js";
import { resolveClaudeBinary } from "./agent.js";

/**
 * Claude Code over the Agent Client Protocol, via the maintained
 * `@agentclientprotocol/claude-agent-acp` shim. This is the mutually exclusive
 * alternative to the default Claude Agent SDK transport (`ClaudeAgentClient`);
 * the provider registry's `claude` factory selects between them based on
 * `providers.claude.transport` in the daemon config.
 */
const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";
// Pinned to the version exercised by acp-wrapper-smoke.test.ts.
const CLAUDE_ACP_VERSION = "0.31.4";
const CLAUDE_ACP_COMMAND: [string, ...string[]] = [
  "npx",
  "--yes",
  `${CLAUDE_ACP_PACKAGE}@${CLAUDE_ACP_VERSION}`,
];

interface ClaudeACPAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
}

export class ClaudeACPAgentClient extends GenericACPAgentClient {
  constructor(options: ClaudeACPAgentClientOptions) {
    super({
      logger: options.logger,
      // Report as "claude" so timelines, persistence handles, and the provider
      // registry treat ACP-backed Claude agents identically to SDK-backed ones.
      provider: "claude",
      // Fixed shim command. The SDK-only reclaude/binary override (carried on
      // runtimeSettings.command) is intentionally NOT forwarded here: GenericACP
      // only passes env to the session, so the launch command stays the shim.
      command: [...CLAUDE_ACP_COMMAND],
      env: options.runtimeSettings?.env,
      providerId: "claude",
      label: "Claude (ACP)",
      providerParams: { supportsMcpServers: true },
    });
  }

  override async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return super.createSession(config, await this.withClaudeExecutable(launchContext));
  }

  override async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return super.resumeSession(handle, overrides, await this.withClaudeExecutable(launchContext));
  }

  /**
   * Point the shim at the same Claude binary Paseo would otherwise launch through
   * the SDK, so ACP mode reuses the existing install and subscription login
   * (~/.claude) without requiring an API key. If the binary can't be resolved
   * here, fall back to letting the shim find `claude` on PATH itself.
   */
  private async withClaudeExecutable(
    launchContext?: AgentLaunchContext,
  ): Promise<AgentLaunchContext | undefined> {
    let executable: string;
    try {
      executable = await resolveClaudeBinary();
    } catch {
      return launchContext;
    }
    return {
      ...launchContext,
      env: {
        CLAUDE_CODE_EXECUTABLE: executable,
        ...launchContext?.env,
      },
    };
  }
}
