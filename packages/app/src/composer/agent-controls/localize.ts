import type { TFunction } from "i18next";

import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { formatThinkingOptionLabel } from "./utils";

/**
 * Server-provided agent features and thinking options carry English labels.
 * For the well-known IDs we override label/description/tooltip with localized
 * strings; unknown IDs fall back to whatever the daemon sent.
 */
const KNOWN_FEATURE_IDS = ["fast_mode", "ultracode"] as const;
type KnownFeatureId = (typeof KNOWN_FEATURE_IDS)[number];

function isKnownFeatureId(id: string): id is KnownFeatureId {
  return (KNOWN_FEATURE_IDS as readonly string[]).includes(id);
}

export function localizeAgentFeature(
  t: TFunction<"composer">,
  feature: AgentFeature,
): AgentFeature {
  if (!isKnownFeatureId(feature.id)) {
    return feature;
  }
  return {
    ...feature,
    label: t(`controls.features.known.${feature.id}.label`),
    description: t(`controls.features.known.${feature.id}.description`),
    tooltip: t(`controls.features.known.${feature.id}.tooltip`),
  };
}

const THINKING_LEVEL_IDS = ["low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevelId = (typeof THINKING_LEVEL_IDS)[number];

function asThinkingLevelId(value: string): ThinkingLevelId | null {
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  return (THINKING_LEVEL_IDS as readonly string[]).includes(compact)
    ? (compact as ThinkingLevelId)
    : null;
}

export function localizeThinkingOptionLabel(
  t: TFunction<"composer">,
  option: { id: string; label?: string | null },
): string {
  const level = asThinkingLevelId(option.id);
  if (level) {
    return t(`controls.thinking.levels.${level}`);
  }
  return formatThinkingOptionLabel(option);
}
