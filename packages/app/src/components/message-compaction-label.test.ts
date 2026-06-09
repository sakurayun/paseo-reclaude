import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { getCompactionMarkerLabel as getCompactionMarkerLabelRaw } from "./message-compaction-label";

// Real English translator so label assertions read the en timeline catalog.
const tTimeline = i18n.getFixedT("en", "timeline");
function getCompactionMarkerLabel(input: Parameters<typeof getCompactionMarkerLabelRaw>[0]) {
  return getCompactionMarkerLabelRaw(input, tTimeline);
}

describe("getCompactionMarkerLabel", () => {
  it("renders loading, automatic, manual, tokenized, and fallback labels", () => {
    expect(getCompactionMarkerLabel({ status: "loading" })).toBe("Compacting...");
    expect(getCompactionMarkerLabel({ status: "completed", trigger: "auto" })).toBe(
      "Context automatically compacted",
    );
    expect(getCompactionMarkerLabel({ status: "completed", trigger: "manual" })).toBe(
      "Context manually compacted",
    );
    expect(getCompactionMarkerLabel({ status: "completed", preTokens: 12_345 })).toBe(
      "Context compacted (12K tokens)",
    );
    expect(getCompactionMarkerLabel({ status: "completed" })).toBe("Context compacted");
  });
});
