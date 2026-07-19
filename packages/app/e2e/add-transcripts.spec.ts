import { expect, test as base, type Page } from "./fixtures";
import { awaitAssistantMessage } from "./helpers/agent-stream";
import { expectComposerVisible, submitMessage } from "./helpers/composer";
import { clickNewChat } from "./helpers/launcher";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "./helpers/mock-agent";
import { getServerId } from "./helpers/server-id";

const SOURCE_TITLE = "Transcript source agent";
const SOURCE_PROMPT = "Keep this exact transcript context across the new-agent draft.";

const test = base.extend<{
  seedTranscriptWorkspace: (options: MockAgentOptions) => Promise<MockAgentWorkspace>;
}>({
  seedTranscriptWorkspace: async ({ browserName: _browserName }, provide) => {
    const sessions: MockAgentWorkspace[] = [];
    await provide(async (options) => {
      const session = await seedMockAgentWorkspace(options);
      sessions.push(session);
      return session;
    });
    await Promise.allSettled(sessions.map((session) => session.cleanup()));
  },
});

async function addSourceTranscript(page: Page, source: MockAgentWorkspace): Promise<void> {
  await page.getByTestId("composer-add-transcripts-pill").click();
  await expect(page.getByTestId("add-transcripts-sheet")).toBeVisible({ timeout: 30_000 });

  const sourceRow = page.getByTestId(`add-transcripts-source-${getServerId()}-${source.agentId}`);
  await expect(sourceRow).toBeVisible({ timeout: 30_000 });
  await expect(sourceRow).toContainText(SOURCE_TITLE);
  await sourceRow.click();
  await page.getByTestId("add-transcripts-confirm").click();

  const pill = page.getByTestId("composer-chat-history-attachment-pill").first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await expect(pill).toContainText(`Transcript · ${SOURCE_TITLE}`);
  await expect(pill).toContainText("localhost");
}

test.describe("Add transcripts", () => {
  test.describe.configure({ timeout: 180_000 });

  test("adds, previews, persists, and submits an immutable transcript snapshot", async ({
    page,
    seedTranscriptWorkspace,
  }) => {
    const source = await seedTranscriptWorkspace({
      repoPrefix: "add-transcripts-",
      title: SOURCE_TITLE,
      initialPrompt: SOURCE_PROMPT,
      model: "ten-second-stream",
    });

    await openAgentRoute(page, source);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await source.client.waitForFinish(source.agentId, 45_000);

    await clickNewChat(page);
    await expectComposerVisible(page);
    await addSourceTranscript(page, source);

    await page.getByTestId("composer-chat-history-attachment-pill").first().click();
    await expect(page.getByTestId("transcript-preview-sheet")).toBeVisible();
    await expect(page.getByTestId("transcript-preview-content")).toContainText(SOURCE_PROMPT);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("transcript-preview-sheet")).not.toBeVisible();

    await page.reload();
    await expectComposerVisible(page, { timeout: 30_000 });
    const restoredPill = page.getByTestId("composer-chat-history-attachment-pill").first();
    await expect(restoredPill).toBeVisible({ timeout: 30_000 });
    await expect(restoredPill).toContainText(`Transcript · ${SOURCE_TITLE}`);

    await submitMessage(page, "");

    const sentMessage = page
      .getByTestId("user-message")
      .filter({ hasText: `Transcript · ${SOURCE_TITLE}` })
      .last();
    await expect(sentMessage).toBeVisible({ timeout: 30_000 });
    await expect(sentMessage).not.toContainText(SOURCE_PROMPT);
  });
});
