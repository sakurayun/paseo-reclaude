import { describe, expect, it } from "vitest";
import { buildWorkspaceDraftAgentConfig } from "./workspace-draft-agent-config";

describe("workspace-draft-agent-config", () => {
  it("builds chat-only config for workspace draft agents", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "codex",
        cwd: "/tmp/project",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        modelGateway: {
          type: "openai-compatible",
          label: "9Router local",
          baseUrl: "http://localhost:20128/v1",
        },
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/tmp/project",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
      modelGateway: {
        type: "openai-compatible",
        label: "9Router local",
        baseUrl: "http://localhost:20128/v1",
      },
    });
  });
});
