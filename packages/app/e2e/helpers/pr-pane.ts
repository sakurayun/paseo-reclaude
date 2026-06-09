import { expect, type Page } from "@playwright/test";

// English PR-state labels, kept local so this e2e helper doesn't import the i18n runtime.
// Must match the en `git:pr.state.*` catalog.
const PR_STATE_LABELS: Record<"open" | "merged" | "closed" | "draft", string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
  draft: "Draft",
};

export async function openPrPane(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open explorer" }).click();
  await page.getByTestId("explorer-tab-pr").click();
  await expect(page.getByTestId("pr-pane")).toBeVisible({ timeout: 15_000 });
}

export async function expectPrPaneTitle(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId("pr-pane-title")).toContainText(title, { timeout: 15_000 });
}

export async function expectPrPaneState(
  page: Page,
  state: "open" | "merged" | "closed" | "draft",
): Promise<void> {
  await expect(page.getByTestId("pr-pane-state")).toHaveText(PR_STATE_LABELS[state], {
    timeout: 15_000,
  });
}

async function assertCheckPill(page: Page, testId: string, count: number): Promise<void> {
  const locator = page.getByTestId(testId);
  await expect(locator).toHaveCount(count > 0 ? 1 : 0, { timeout: 15_000 });
  if (count > 0) {
    await expect(locator).toContainText(String(count));
  }
}

export async function expectPrPaneCheckSummary(
  page: Page,
  counts: { passed: number; failed: number; pending: number },
): Promise<void> {
  await assertCheckPill(page, "pr-pane-check-passed", counts.passed);
  await assertCheckPill(page, "pr-pane-check-failed", counts.failed);
  await assertCheckPill(page, "pr-pane-check-pending", counts.pending);
}

export async function expectPrPaneActivityCount(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId("pr-pane-activity-row")).toHaveCount(count, { timeout: 15_000 });
}
