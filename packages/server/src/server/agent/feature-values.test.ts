import { describe, expect, test } from "vitest";

import type { AgentFeature } from "./agent-sdk-types.js";
import { validateAgentFeatureValues } from "./feature-values.js";

const toggleFeature: AgentFeature = {
  type: "toggle",
  id: "ultracode",
  label: "Ultracode",
  value: false,
};

const selectFeature: AgentFeature = {
  type: "select",
  id: "profile",
  label: "Profile",
  value: null,
  options: [
    { id: "default", label: "Default" },
    { id: "review", label: "Review" },
  ],
};

describe("validateAgentFeatureValues", () => {
  test("accepts advertised toggle and select feature values", () => {
    expect(
      validateAgentFeatureValues(
        { ultracode: true, profile: "review" },
        [toggleFeature, selectFeature],
        { provider: "claude" },
      ),
    ).toEqual({ ultracode: true, profile: "review" });
  });

  test("rejects unknown feature ids", () => {
    expect(() =>
      validateAgentFeatureValues({ missing: true }, [toggleFeature], { provider: "claude" }),
    ).toThrow(/Unknown feature 'missing'/);
  });

  test("rejects non-boolean toggle values", () => {
    expect(() =>
      validateAgentFeatureValues({ ultracode: "false" }, [toggleFeature], {
        provider: "claude",
      }),
    ).toThrow(/expects a boolean/);
  });

  test("rejects unknown select values", () => {
    expect(() =>
      validateAgentFeatureValues({ profile: "missing" }, [selectFeature], {
        provider: "claude",
      }),
    ).toThrow(/Invalid value 'missing'/);
  });
});
