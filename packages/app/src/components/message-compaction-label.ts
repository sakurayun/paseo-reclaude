import type { TFunction } from "i18next";

export interface CompactionMarkerLabelInput {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export function getCompactionMarkerLabel(
  { status, trigger, preTokens }: CompactionMarkerLabelInput,
  t: TFunction<"timeline">,
): string {
  if (status === "loading") return t("compaction.compacting");
  if (trigger === "auto") return t("compaction.automatic");
  if (trigger === "manual") return t("compaction.manual");
  if (preTokens) return t("compaction.compactedTokens", { count: Math.round(preTokens / 1000) });
  return t("compaction.compacted");
}
