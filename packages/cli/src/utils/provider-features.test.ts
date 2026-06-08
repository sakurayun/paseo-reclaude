import { describe, expect, test } from "vitest";

import {
  formatFeatureOptions,
  formatFeatureValue,
  parseFeatureFlagValues,
  parseSingleFeatureValue,
  validateFeatureValuesForFeatures,
} from "./provider-features.js";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";

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
  value: "default",
  options: [
    { id: "default", label: "Default" },
    { id: "review", label: "Review" },
  ],
};

describe("provider feature CLI helpers", () => {
  test("parses repeated feature flags with boolean shorthand", () => {
    expect(parseFeatureFlagValues(["ultracode", "fast_mode=false", "profile=review"])).toEqual({
      ultracode: true,
      fast_mode: false,
      profile: "review",
    });
  });

  test("parses explicit booleans case-insensitively", () => {
    expect(parseFeatureFlagValues(["ultracode=TRUE", "fast_mode=False"])).toEqual({
      ultracode: true,
      fast_mode: false,
    });
  });

  test("rejects invalid feature flag shapes", () => {
    expect(() => parseFeatureFlagValues(["=true"])).toThrow(/non-empty feature id/);
    expect(() => parseFeatureFlagValues(["ultracode="])).toThrow(/non-empty value/);
  });

  test("validates values against advertised features", () => {
    expect(
      validateFeatureValuesForFeatures(
        { ultracode: true, profile: "review" },
        [toggleFeature, selectFeature],
        { source: "--feature" },
      ),
    ).toEqual({ ultracode: true, profile: "review" });
  });

  test("rejects unknown feature ids", () => {
    expect(() =>
      validateFeatureValuesForFeatures({ missing: true }, [toggleFeature], {
        source: "--feature",
      }),
    ).toThrow(/Unknown provider feature: missing/);
  });

  test("rejects string booleans for toggle features", () => {
    expect(() =>
      validateFeatureValuesForFeatures({ ultracode: "false" }, [toggleFeature], {
        source: "--feature",
      }),
    ).toThrow(/expects a boolean/);
  });

  test("rejects select values outside the advertised options", () => {
    expect(() =>
      validateFeatureValuesForFeatures({ profile: "unknown" }, [selectFeature], {
        source: "--feature",
      }),
    ).toThrow(/Invalid value for provider feature profile/);
  });

  test("parses one runtime value with boolean shorthand", () => {
    expect(parseSingleFeatureValue(undefined)).toBe(true);
    expect(parseSingleFeatureValue("false")).toBe(false);
    expect(parseSingleFeatureValue("review")).toBe("review");
  });

  test("formats feature values and options for table output", () => {
    expect(formatFeatureValue(true)).toBe("true");
    expect(formatFeatureValue(null)).toBe("none");
    expect(formatFeatureOptions(toggleFeature)).toBe("true, false");
    expect(formatFeatureOptions(selectFeature)).toBe("default, review");
  });
});
