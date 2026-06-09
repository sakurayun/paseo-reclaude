import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  buildWorktreeArchiveConfirmationMessage as buildWorktreeArchiveConfirmationMessageRaw,
  buildWorktreeArchiveRiskReasons as buildWorktreeArchiveRiskReasonsRaw,
} from "@/git/worktree-archive-warning";

// Real English translator so the risk-reason copy assertions read the en git catalog.
const tGit = i18n.getFixedT("en", "git");
function buildWorktreeArchiveConfirmationMessage(
  input: Parameters<typeof buildWorktreeArchiveConfirmationMessageRaw>[0],
) {
  return buildWorktreeArchiveConfirmationMessageRaw(input, tGit);
}
function buildWorktreeArchiveRiskReasons(
  input: Parameters<typeof buildWorktreeArchiveRiskReasonsRaw>[0],
) {
  return buildWorktreeArchiveRiskReasonsRaw(input, tGit);
}

describe("worktree archive warning", () => {
  it("does not require a confirmation for clean and pushed worktrees", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        worktreeName: "feature",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBeNull();
  });

  it("explains uncommitted line changes", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: { additions: 12, deletions: 1 },
      }),
    ).toEqual(["Uncommitted changes (12 added lines, 1 deleted line)"]);
  });

  it("treats nonzero diff stats as dirty when dirty state is missing", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: undefined,
        aheadOfOrigin: 0,
        diffStat: { additions: 4, deletions: 0 },
      }),
    ).toEqual(["Uncommitted changes (4 added lines)"]);
  });

  it("explains unpushed commits", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 2,
        diffStat: null,
      }),
    ).toEqual(["2 unpushed commits"]);
  });

  it("includes every archive risk in the confirmation copy", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        worktreeName: "risky-feature",
        isDirty: true,
        aheadOfOrigin: 1,
        diffStat: { additions: 1, deletions: 3 },
      }),
    ).toBe("Uncommitted changes (1 added line, 3 deleted lines)\n1 unpushed commit");
  });
});
