import { describe, expect, test } from "vitest";
import {
  buildClaudeFeatures,
  CLAUDE_ADVISOR_FEATURE_ID,
  CLAUDE_ADVISOR_OFF_OPTION_ID,
  claudeModelSupportsAdvisor,
  isClaudeAdvisorPairingValid,
  listClaudeAdvisorModelOptionsForBase,
  normalizeClaudeAdvisorFeatureValue,
} from "./feature-definitions.js";

describe("Claude advisor feature", () => {
  test("supports public Claude aliases and model families", () => {
    expect(claudeModelSupportsAdvisor("opus")).toBe(true);
    expect(claudeModelSupportsAdvisor("sonnet")).toBe(true);
    expect(claudeModelSupportsAdvisor("claude-opus-4-8")).toBe(true);
    expect(claudeModelSupportsAdvisor("claude-sonnet-4-6")).toBe(true);
    expect(claudeModelSupportsAdvisor("haiku")).toBe(false);
  });

  test("filters advisor options so advisor rank is >= base rank", () => {
    expect(listClaudeAdvisorModelOptionsForBase("sonnet").map((option) => option.id)).toEqual([
      "sonnet",
      "opus",
      "fable",
    ]);
    expect(listClaudeAdvisorModelOptionsForBase("opus").map((option) => option.id)).toEqual([
      "opus",
      "fable",
    ]);
  });

  test("rejects weaker advisor pairings", () => {
    expect(isClaudeAdvisorPairingValid({ baseModelId: "opus", advisorModelId: "sonnet" })).toBe(
      false,
    );
    expect(isClaudeAdvisorPairingValid({ baseModelId: "sonnet", advisorModelId: "opus" })).toBe(
      true,
    );
    expect(isClaudeAdvisorPairingValid({ baseModelId: "opus", advisorModelId: "off" })).toBe(true);
  });

  test("normalizes feature values", () => {
    expect(normalizeClaudeAdvisorFeatureValue(undefined)).toBe(CLAUDE_ADVISOR_OFF_OPTION_ID);
    expect(normalizeClaudeAdvisorFeatureValue("OPUS")).toBe("opus");
    expect(normalizeClaudeAdvisorFeatureValue("nope")).toBeNull();
  });

  test("includes advisor select feature for supported models", () => {
    const features = buildClaudeFeatures({
      modelId: "opus",
      fastModeEnabled: false,
      ultracodeEnabled: false,
      advisorModel: "opus",
    });
    const advisor = features.find((feature) => feature.id === CLAUDE_ADVISOR_FEATURE_ID);
    expect(advisor).toMatchObject({
      type: "select",
      id: CLAUDE_ADVISOR_FEATURE_ID,
      value: "opus",
    });
    expect(advisor?.type === "select" && advisor.options.map((option) => option.id)).toEqual([
      "off",
      "opus",
      "fable",
    ]);
  });

  test("clamps invalid advisor selection back to off", () => {
    const features = buildClaudeFeatures({
      modelId: "opus",
      fastModeEnabled: false,
      ultracodeEnabled: false,
      advisorModel: "sonnet",
    });
    const advisor = features.find((feature) => feature.id === CLAUDE_ADVISOR_FEATURE_ID);
    expect(advisor).toMatchObject({
      type: "select",
      value: CLAUDE_ADVISOR_OFF_OPTION_ID,
    });
  });
});
