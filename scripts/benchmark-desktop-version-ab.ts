/**
 * Attach to a visible Dev Electron instance and measure the frozen Desktop A/B workload.
 *
 * The numeric pass never captures screenshots. A separate pass records an animated GIF so
 * compositor readback cannot contaminate the latency numbers.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import sharp from "sharp";
import { summarizeSamples } from "./benchmarks/stats";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_MANIFEST_PATH =
  process.env.PASEO_COMPARE_FIXTURE_MANIFEST ??
  path.join(REPOSITORY_ROOT, ".dev", "desktop-version-comparison", "fixture-manifest.json");
const CDP_ENDPOINT = process.env.PASEO_COMPARE_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const APP_ORIGIN = process.env.PASEO_COMPARE_APP_ORIGIN ?? "http://localhost:8082";
const SWITCH_CYCLES = 3;
const GIF_FRAME_DELAY_MS = 120;
const SWITCH_TIMEOUT_MS = 20_000;
const HISTORY_WARMUP_MODE =
  process.env.PASEO_COMPARE_HISTORY_WARMUP_MODE === "tail" ? "tail" : "full";

interface FixtureAgent {
  id: string;
  title: string;
  role: "history" | "markdown" | "markdown-cold" | "large-diff" | "light" | "production-history";
  projectedItems: number;
  sentinel?: string;
  oldestSentinel?: string;
  jsonBytes?: number;
  toolCalls?: number;
}

interface FixtureProviderSubagent {
  parentAgentId: string;
  id: string;
  title: string;
  status: string;
  projectedItems: number;
  sentinel: string;
  oldestSentinel?: string;
  jsonBytes: number;
  toolCalls: number;
}

interface FixtureWorkspace {
  id: string;
  title: string;
  targetHistoryItems: number | null;
  agents: FixtureAgent[];
  providerSubagentCount?: number;
  runningProviderSubagentCount?: number;
  providerSubagents?: FixtureProviderSubagent[];
}

interface FixtureManifest {
  fixtureId: string;
  endpoint: string;
  serverId: string;
  workspaces: FixtureWorkspace[];
  calibrationTargets?: Record<string, number>;
}

type FixtureTab =
  | (FixtureAgent & { kind: "agent" })
  | (FixtureProviderSubagent & { kind: "provider_subagent" });

interface RenderProfileSample {
  actualDuration: number;
  commitTime: number;
}

interface SwitchSample {
  targetAgentId: string;
  targetTitle: string;
  selectedMs: number;
  titleReadyMs: number;
  bodyConsistentMs: number;
  titleBodyMismatchMs: number;
  reactCommits: number;
  reactDurationMs: number;
  longTaskCount: number;
  longTaskDurationMs: number;
  droppedFrameCount: number;
  maxFrameGapMs: number;
  heapDeltaBytes: number;
}

interface FootprintSnapshot {
  domNodes: number;
  activeTimelineDomNodes: number;
  inactiveTimelineDomNodes: number;
  activeTimelineCount: number;
  inactiveTimelineCount: number;
  axNodes: number;
  axNonIgnoredNodes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapUsedBeforeGcBytes: number;
}

interface ProcessSample {
  atMs: number;
  rssBytes: number;
  cpuPercent: number;
}

interface MarkdownMeasurement {
  readyMs: number;
  longTaskCount: number;
  longTaskDurationMs: number;
  maxLongTaskMs: number;
  activeTimelineDomNodes: number;
  activeTimelineTextLength: number;
  heapUsedBytes: number;
}

interface InteractionMeasurement {
  readyMs: number;
  longTaskDurationMs: number;
  maxLongTaskMs: number;
}

interface SecondaryInteractionMeasurements {
  workspaceToCold: InteractionMeasurement[];
  workspaceToHeavy: InteractionMeasurement[];
  subagentExpand: InteractionMeasurement[];
  subagentCollapse: InteractionMeasurement[];
  toolExpand: InteractionMeasurement[];
  toolCollapse: InteractionMeasurement[];
}

interface BenchmarkWindow extends Window {
  __PASEO_RENDER_PROFILE__?: RenderProfileSample[];
  __PASEO_RESET_RENDER_PROFILE__?: () => void;
  __PASEO_DESKTOP_AB_SWITCH_RESULT__?: Promise<Omit<SwitchSample, "heapDeltaBytes">>;
  __PASEO_DESKTOP_AB_LONG_TASKS__?: number[];
  __PASEO_DESKTOP_AB_INTERACTION_LONG_TASKS__?: number[];
  __PASEO_DESKTOP_AB_INTERACTION_OBSERVER__?: PerformanceObserver;
}

function metricSummary(values: number[]) {
  const summary = summarizeSamples(values);
  return { p50: summary.p50, p95: summary.p95, samples: summary.samples };
}

function bytesToMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function tabSentinel(tab: FixtureTab, agentIndex?: number): string {
  if (tab.sentinel) return tab.sentinel;
  return `desktop-version-h176-a${(agentIndex ?? 0) + 1}-turn-88: emit 32 coalesced agent stream updates`;
}

function tabOldestSentinel(tab: FixtureTab, agentIndex?: number): string {
  if (tab.oldestSentinel) return tab.oldestSentinel;
  if (tab.kind === "provider_subagent") {
    return `desktop-production-${tab.id}-message-0001`;
  }
  if (tab.role === "production-history") {
    const profile = tab.title.match(/Production heavy (A[1-6])/i)?.[1]?.toLowerCase();
    if (profile) return `desktop-production-${profile}-message-0001`;
  }
  return `desktop-version-h176-a${(agentIndex ?? 0) + 1}-turn-1: emit 32 coalesced agent stream updates`;
}

function workspaceTabTestId(tab: FixtureTab): string {
  if (tab.kind === "agent") return `workspace-tab-agent_${tab.id}`;
  return `workspace-tab-provider_subagent_${tab.parentAgentId.length}_${tab.parentAgentId}_${tab.id.length}_${tab.id}`;
}

async function resolvePage(browser: Browser): Promise<Page> {
  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => page.url().startsWith(APP_ORIGIN));
  if (pages.length !== 1) {
    throw new Error(`Expected one ${APP_ORIGIN} page, found ${pages.length}`);
  }
  return pages[0];
}

async function initializeProfile(page: Page, manifest: FixtureManifest): Promise<void> {
  await page.route(/:(6767)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767)\b/, async (webSocket) => {
    await webSocket.close({
      code: 1008,
      reason: "Desktop version benchmark blocks the production daemon",
    });
  });
  // tsx/esbuild preserves nested function names with a `__name` helper. Playwright
  // serializes the callback body but not that Node-side helper, so provide the identity
  // implementation in the page before any measurement callback is evaluated.
  await page.addInitScript("globalThis.__name ??= (target) => target;");
  await page.evaluate("globalThis.__name ??= (target) => target;");
  if (!page.url().startsWith(APP_ORIGIN)) {
    await page.goto(APP_ORIGIN, { waitUntil: "domcontentloaded" });
  }
  await page.evaluate(
    ({ serverId, endpoint }) => {
      localStorage.clear();
      const now = new Date().toISOString();
      const connection = {
        id: `direct:${endpoint}`,
        type: "directTcp",
        endpoint,
      };
      localStorage.setItem(
        "@paseo:daemon-registry",
        JSON.stringify([
          {
            serverId,
            label: "Desktop perf fixture",
            connections: [connection],
            preferredConnectionId: connection.id,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      );
      localStorage.setItem("@paseo:e2e", "1");
    },
    {
      serverId: manifest.serverId,
      endpoint: new URL(manifest.endpoint).host,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function visibleTimeline(page: Page) {
  return page.locator('[data-testid="agent-chat-scroll"]:visible').first();
}

async function waitForVisibleTimelineText(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      for (const node of document.querySelectorAll<HTMLElement>(
        '[data-testid="agent-chat-scroll"]',
      )) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          node.offsetParent !== null &&
          (node.textContent ?? "").includes(expected)
        ) {
          return true;
        }
      }
      return false;
    },
    text,
    { timeout: 60_000 },
  );
}

async function scrollTimelineToBottom(page: Page): Promise<void> {
  const scroll = await visibleTimeline(page);
  await scroll.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("timeline is not HTMLElement");
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(80);
}

async function loadOldestHistory(page: Page, oldestPrompt: string): Promise<void> {
  const scroll = await visibleTimeline(page);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const isVisible = await page
      .getByText(oldestPrompt, { exact: true })
      .isVisible()
      .catch(() => false);
    if (isVisible) return;
    await scroll.hover();
    await page.mouse.wheel(0, -20_000);
    await scroll.evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("timeline is not HTMLElement");
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(300);
  }
  await waitForVisibleTimelineText(page, oldestPrompt);
}

async function clickWorkspaceTab(page: Page, target: FixtureTab): Promise<void> {
  const tab = page.getByTestId(workspaceTabTestId(target));
  await tab.scrollIntoViewIfNeeded();
  const bounds = await tab.boundingBox();
  if (!bounds) throw new Error(`Tab ${target.id} has no bounds`);
  await tab.click({ position: { x: Math.min(8, bounds.width / 4), y: bounds.height / 2 } });
}

async function openAgentFromCommandCenter(
  page: Page,
  serverId: string,
  agent: FixtureAgent,
): Promise<void> {
  await page.getByTestId("sidebar-command-center-search").click();
  const panel = page.getByTestId("command-center-panel");
  await panel.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByTestId("command-center-input").fill(agent.title);
  const row = panel.getByTestId(`command-center-agent-${serverId}:${agent.id}`);
  await row.waitFor({ state: "visible", timeout: 60_000 });
  await row.click();
}

async function closeAgentTab(page: Page, agentId: string): Promise<void> {
  const tab = page.getByTestId(`workspace-tab-agent_${agentId}`);
  if (!(await tab.isVisible().catch(() => false))) return;
  await tab.hover();
  const close = page.getByTestId(`workspace-agent-close-${agentId}`);
  await close.waitFor({ state: "visible", timeout: 30_000 });
  await close.click();
  await tab.waitFor({ state: "detached", timeout: 30_000 });
}

async function openHistoryTabs(
  page: Page,
  serverId: string,
  agents: FixtureAgent[],
  agentsToClose: FixtureAgent[],
): Promise<void> {
  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index];
    await openAgentFromCommandCenter(page, serverId, agent);
    await page.getByTestId(`workspace-tab-agent_${agent.id}`).waitFor({ timeout: 60_000 });
    await waitForVisibleTimelineText(page, tabSentinel({ ...agent, kind: "agent" }, index));
    if (index === 0) {
      for (const agentToClose of agentsToClose) {
        await closeAgentTab(page, agentToClose.id);
      }
    }
  }

  // Load the oldest stored page for each tab in the current SPA document, then return to tail.
  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index];
    await clickWorkspaceTab(page, { ...agent, kind: "agent" });
    await waitForVisibleTimelineText(page, tabSentinel({ ...agent, kind: "agent" }, index));
    await loadOldestHistory(page, tabOldestSentinel({ ...agent, kind: "agent" }, index));
    await scrollTimelineToBottom(page);
    await waitForVisibleTimelineText(page, tabSentinel({ ...agent, kind: "agent" }, index));
  }
}

async function openProductionTabs(
  page: Page,
  serverId: string,
  rootAgents: FixtureAgent[],
  providerSubagents: FixtureProviderSubagent[],
): Promise<FixtureTab[]> {
  for (const agent of rootAgents) {
    await openAgentFromCommandCenter(page, serverId, agent);
    const tab = { ...agent, kind: "agent" as const };
    await page.getByTestId(workspaceTabTestId(tab)).waitFor({ timeout: 60_000 });
    await waitForVisibleTimelineText(page, tabSentinel(tab));
  }

  for (const subagent of providerSubagents) {
    const parent = rootAgents.find((agent) => agent.id === subagent.parentAgentId);
    if (!parent) throw new Error(`Missing parent ${subagent.parentAgentId}`);
    await clickWorkspaceTab(page, { ...parent, kind: "agent" });
    await waitForVisibleTimelineText(page, tabSentinel({ ...parent, kind: "agent" }));
    await scrollTimelineToBottom(page);
    const row = page.getByTestId(`subagents-track-row-${subagent.id}`);
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByTestId("subagents-track-header").click();
    }
    await row.waitFor({ state: "visible", timeout: 60_000 });
    await row.click();
    const tab = { ...subagent, kind: "provider_subagent" as const };
    await page.getByTestId(workspaceTabTestId(tab)).waitFor({ timeout: 60_000 });
    await page
      .locator('[data-testid="provider-subagent-panel"]:visible')
      .first()
      .waitFor({ timeout: 60_000 });
    await waitForVisibleTimelineText(page, tabSentinel(tab));
  }

  const tabs: FixtureTab[] = [
    ...rootAgents.map((agent) => ({ ...agent, kind: "agent" as const })),
    ...providerSubagents.map((subagent) => ({ ...subagent, kind: "provider_subagent" as const })),
  ];
  for (const tab of tabs) {
    await clickWorkspaceTab(page, tab);
    await waitForVisibleTimelineText(page, tabSentinel(tab));
    if (HISTORY_WARMUP_MODE === "full") {
      await loadOldestHistory(page, tabOldestSentinel(tab));
    }
    await scrollTimelineToBottom(page);
    await waitForVisibleTimelineText(page, tabSentinel(tab));
  }
  return tabs;
}

async function enableRenderProfiling(
  page: Page,
  firstAgent: FixtureTab,
  lastAgent: FixtureTab,
): Promise<void> {
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("renderProfile", "1");
    window.history.replaceState(window.history.state, "", url);
  });
  await clickWorkspaceTab(page, firstAgent);
  await waitForVisibleTimelineText(page, tabSentinel(firstAgent, 0));
  await page.waitForFunction(() => {
    return typeof (window as BenchmarkWindow).__PASEO_RESET_RENDER_PROFILE__ === "function";
  });
  await clickWorkspaceTab(page, lastAgent);
  await waitForVisibleTimelineText(page, tabSentinel(lastAgent, 7));
}

async function readHeap(page: Page): Promise<{ used: number; total: number }> {
  return page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
      }
    ).memory;
    return {
      used: memory?.usedJSHeapSize ?? 0,
      total: memory?.totalJSHeapSize ?? 0,
    };
  });
}

async function armSwitchMeasurement(
  page: Page,
  input: {
    target: FixtureTab;
    targetPrompt: string;
    previousPrompt: string;
  },
): Promise<void> {
  await page.evaluate(
    ({ targetAgentId, targetTitle, targetPrompt, previousPrompt, targetTestId, timeoutMs }) => {
      const state = window as BenchmarkWindow;
      const target = document.querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`);
      if (!target) throw new Error(`Missing target tab ${targetAgentId}`);

      state.__PASEO_DESKTOP_AB_SWITCH_RESULT__ = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out switching to ${targetTitle}`));
        }, timeoutMs);
        const longTasks: PerformanceEntry[] = [];
        const observer =
          typeof PerformanceObserver === "undefined"
            ? null
            : new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
        try {
          observer?.observe({ type: "longtask" });
        } catch {
          observer?.disconnect();
        }

        let startedAt = 0;
        let selectedAt: number | null = null;
        let titleReadyAt: number | null = null;
        let bodyConsistentAt: number | null = null;
        let frameHandle = 0;
        let previousFrameAt = 0;
        const frameGaps: number[] = [];
        let renderProfileStart = 0;

        function visibleTimelineNode(): HTMLElement | null {
          for (const node of document.querySelectorAll<HTMLElement>(
            '[data-testid="agent-chat-scroll"]',
          )) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && node.offsetParent !== null) return node;
          }
          return null;
        }

        function cleanup() {
          window.clearTimeout(timeout);
          observer?.disconnect();
          if (frameHandle) window.cancelAnimationFrame(frameHandle);
          target.removeEventListener("pointerdown", onPointerDown, true);
        }

        function finish() {
          const now = performance.now();
          const samples = (state.__PASEO_RENDER_PROFILE__ ?? []).slice(renderProfileStart);
          const commitTimes = new Set(samples.map((sample) => sample.commitTime));
          cleanup();
          resolve({
            targetAgentId,
            targetTitle,
            selectedMs: (selectedAt ?? now) - startedAt,
            titleReadyMs: (titleReadyAt ?? now) - startedAt,
            bodyConsistentMs: (bodyConsistentAt ?? now) - startedAt,
            titleBodyMismatchMs:
              titleReadyAt === null || bodyConsistentAt === null
                ? 0
                : Math.max(0, bodyConsistentAt - titleReadyAt),
            reactCommits: commitTimes.size,
            reactDurationMs: samples.reduce((sum, sample) => sum + sample.actualDuration, 0),
            longTaskCount: longTasks.length,
            longTaskDurationMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
            droppedFrameCount: frameGaps.filter((gap) => gap > 20).length,
            maxFrameGapMs: Math.max(0, ...frameGaps),
          });
        }

        function inspect() {
          const now = performance.now();
          if (previousFrameAt > 0) frameGaps.push(now - previousFrameAt);
          previousFrameAt = now;
          if (selectedAt === null && target.getAttribute("aria-selected") === "true") {
            selectedAt = now;
          }
          if (titleReadyAt === null && document.title === targetTitle) titleReadyAt = now;
          const activeText = visibleTimelineNode()?.textContent ?? "";
          if (
            bodyConsistentAt === null &&
            activeText.includes(targetPrompt) &&
            !activeText.includes(previousPrompt)
          ) {
            bodyConsistentAt = now;
          }
          if (selectedAt !== null && titleReadyAt !== null && bodyConsistentAt !== null) {
            frameHandle = window.requestAnimationFrame(finish);
            return;
          }
          frameHandle = window.requestAnimationFrame(inspect);
        }

        function onPointerDown() {
          startedAt = performance.now();
          previousFrameAt = startedAt;
          renderProfileStart = state.__PASEO_RENDER_PROFILE__?.length ?? 0;
          frameHandle = window.requestAnimationFrame(inspect);
        }

        target.addEventListener("pointerdown", onPointerDown, true);
      });
    },
    {
      targetAgentId: input.target.id,
      targetTitle: input.target.title,
      targetPrompt: input.targetPrompt,
      previousPrompt: input.previousPrompt,
      targetTestId: workspaceTabTestId(input.target),
      timeoutMs: SWITCH_TIMEOUT_MS,
    },
  );
}

async function measureSwitch(
  page: Page,
  target: FixtureTab,
  targetPrompt: string,
  previousPrompt: string,
): Promise<SwitchSample> {
  const heapBefore = await readHeap(page);
  await armSwitchMeasurement(page, { target, targetPrompt, previousPrompt });
  await clickWorkspaceTab(page, target);
  const measured = await page.evaluate(async () => {
    const promise = (window as BenchmarkWindow).__PASEO_DESKTOP_AB_SWITCH_RESULT__;
    if (!promise) throw new Error("Switch measurement was not armed");
    return promise;
  });
  const heapAfter = await readHeap(page);
  return { ...measured, heapDeltaBytes: heapAfter.used - heapBefore.used };
}

async function readFootprint(page: Page, cdp: CDPSession): Promise<FootprintSnapshot> {
  const heapBeforeGc = await readHeap(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const dom = await page.evaluate(() => {
    const timelines = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="agent-chat-scroll"]'),
    );
    let activeTimelineDomNodes = 0;
    let inactiveTimelineDomNodes = 0;
    let activeTimelineCount = 0;
    let inactiveTimelineCount = 0;
    for (const timeline of timelines) {
      const nodeCount = timeline.querySelectorAll("*").length + 1;
      const rect = timeline.getBoundingClientRect();
      const active = rect.width > 0 && rect.height > 0 && timeline.offsetParent !== null;
      if (active) {
        activeTimelineCount += 1;
        activeTimelineDomNodes += nodeCount;
      } else {
        inactiveTimelineCount += 1;
        inactiveTimelineDomNodes += nodeCount;
      }
    }
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
      }
    ).memory;
    return {
      domNodes: document.querySelectorAll("*").length,
      activeTimelineDomNodes,
      inactiveTimelineDomNodes,
      activeTimelineCount,
      inactiveTimelineCount,
      heapUsedBytes: memory?.usedJSHeapSize ?? 0,
      heapTotalBytes: memory?.totalJSHeapSize ?? 0,
    };
  });
  await cdp.send("Accessibility.enable");
  const ax = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes?: Array<{ ignored?: boolean }>;
  };
  await cdp.send("Accessibility.disable");
  const axNodes = ax.nodes ?? [];
  return {
    ...dom,
    axNodes: axNodes.length,
    axNonIgnoredNodes: axNodes.filter((node) => node.ignored !== true).length,
    heapUsedBeforeGcBytes: heapBeforeGc.used,
  };
}

async function readRendererProcess(browser: Browser): Promise<{ pid: number; cpuTime: number }> {
  const session = await browser.newBrowserCDPSession();
  try {
    const result = (await session.send("SystemInfo.getProcessInfo")) as {
      processInfo: Array<{ type: string; id: number; cpuTime: number }>;
    };
    const renderers = result.processInfo
      .filter((entry) => entry.type === "renderer")
      .sort((left, right) => right.cpuTime - left.cpuTime);
    const renderer = renderers[0];
    if (!renderer) throw new Error("No renderer process found through CDP");
    return { pid: renderer.id, cpuTime: renderer.cpuTime };
  } finally {
    await session.detach();
  }
}

async function sampleProcess(pid: number, startedAt: number): Promise<ProcessSample> {
  const { stdout } = await execFileAsync("ps", ["-o", "rss=,%cpu=", "-p", String(pid)]);
  const [rssKbRaw, cpuRaw] = stdout.trim().split(/\s+/);
  return {
    atMs: Date.now() - startedAt,
    rssBytes: Number(rssKbRaw ?? 0) * 1024,
    cpuPercent: Number(cpuRaw ?? 0),
  };
}

async function startProcessSampler(pid: number): Promise<{
  samples: ProcessSample[];
  stop: () => Promise<void>;
}> {
  const startedAt = Date.now();
  const samples: ProcessSample[] = [];
  let active = true;
  const loop = (async () => {
    for (;;) {
      if (!active) break;
      samples.push(await sampleProcess(pid, startedAt));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  return {
    samples,
    stop: async () => {
      active = false;
      await loop;
    },
  };
}

function parseMemorySize(output: string, label: string): number {
  const match = new RegExp(`${label}:\\s+([0-9.]+)([KMG])`, "i").exec(output);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2]?.toUpperCase();
  let multiplier = 1;
  if (unit === "G") multiplier = 1024;
  if (unit === "K") multiplier = 1 / 1024;
  return value * multiplier;
}

async function readPhysicalFootprint(pid: number): Promise<{
  physicalMb: number;
  physicalPeakMb: number;
  swappedMb: number;
}> {
  const { stdout } = await execFileAsync("vmmap", ["-summary", String(pid)], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    physicalMb: parseMemorySize(stdout, "Physical footprint"),
    physicalPeakMb: parseMemorySize(stdout, "Physical footprint \\(peak\\)"),
    swappedMb: parseMemorySize(stdout, "Swapped out"),
  };
}

async function measureInteraction(
  page: Page,
  action: () => Promise<void>,
  waitUntilReady: () => Promise<void>,
): Promise<InteractionMeasurement> {
  await page.evaluate(() => {
    const state = window as BenchmarkWindow;
    state.__PASEO_DESKTOP_AB_INTERACTION_OBSERVER__?.disconnect();
    state.__PASEO_DESKTOP_AB_INTERACTION_LONG_TASKS__ = [];
    try {
      const observer = new PerformanceObserver((list) => {
        state.__PASEO_DESKTOP_AB_INTERACTION_LONG_TASKS__?.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      });
      observer.observe({ type: "longtask" });
      state.__PASEO_DESKTOP_AB_INTERACTION_OBSERVER__ = observer;
    } catch {
      // Readiness remains authoritative when Long Task observation is unavailable.
    }
  });
  const startedAt = performance.now();
  await action();
  await waitUntilReady();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const readyMs = performance.now() - startedAt;
  return page.evaluate((externalReadyMs) => {
    const state = window as BenchmarkWindow;
    state.__PASEO_DESKTOP_AB_INTERACTION_OBSERVER__?.disconnect();
    const longTasks = state.__PASEO_DESKTOP_AB_INTERACTION_LONG_TASKS__ ?? [];
    return {
      readyMs: externalReadyMs,
      longTaskDurationMs: longTasks.reduce((sum, duration) => sum + duration, 0),
      maxLongTaskMs: Math.max(0, ...longTasks),
    };
  }, readyMs);
}

async function measureSecondaryInteractions(input: {
  page: Page;
  heavyWorkspace: FixtureWorkspace;
  coldWorkspace: FixtureWorkspace;
  tabs: FixtureTab[];
  rootAgents: FixtureAgent[];
}): Promise<SecondaryInteractionMeasurements> {
  const measurements: SecondaryInteractionMeasurements = {
    workspaceToCold: [],
    workspaceToHeavy: [],
    subagentExpand: [],
    subagentCollapse: [],
    toolExpand: [],
    toolCollapse: [],
  };
  const lastTab = input.tabs[input.tabs.length - 1]!;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    measurements.workspaceToCold.push(
      await measureInteraction(
        input.page,
        () =>
          input.page.getByRole("button", { name: input.coldWorkspace.title, exact: true }).click(),
        () =>
          input.page.waitForFunction(
            (workspaceId) => window.location.pathname.includes(workspaceId),
            input.coldWorkspace.id,
          ),
      ),
    );
    measurements.workspaceToHeavy.push(
      await measureInteraction(
        input.page,
        () =>
          input.page.getByRole("button", { name: input.heavyWorkspace.title, exact: true }).click(),
        () => waitForVisibleTimelineText(input.page, tabSentinel(lastTab)),
      ),
    );
  }

  const parent = input.rootAgents[1]!;
  await clickWorkspaceTab(input.page, { ...parent, kind: "agent" });
  await waitForVisibleTimelineText(input.page, tabSentinel({ ...parent, kind: "agent" }));
  await scrollTimelineToBottom(input.page);
  const header = input.page.getByTestId("subagents-track-header");
  const lastSubagentRow = input.page.getByTestId(
    "subagents-track-row-desktop-provider-subagent-108",
  );
  if (await lastSubagentRow.isVisible().catch(() => false)) {
    await header.click();
    await lastSubagentRow.waitFor({ state: "hidden" });
  }
  for (let cycle = 0; cycle < 3; cycle += 1) {
    measurements.subagentExpand.push(
      await measureInteraction(
        input.page,
        () => header.click(),
        () => lastSubagentRow.waitFor({ state: "visible" }),
      ),
    );
    measurements.subagentCollapse.push(
      await measureInteraction(
        input.page,
        () => header.click(),
        () => lastSubagentRow.waitFor({ state: "hidden" }),
      ),
    );
  }

  const toolBadge = input.page.locator('[data-testid="tool-call-badge"]:visible').last();
  const toolButton = toolBadge.locator(":scope > button").first();
  await toolBadge.scrollIntoViewIfNeeded();
  if (await toolBadge.evaluate((badge) => badge.children.length > 1)) {
    await toolButton.click();
    await input.page.waitForFunction(() => {
      const badges = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="tool-call-badge"]'),
      ).filter((badge) => badge.offsetParent !== null);
      return (badges.at(-1)?.children.length ?? 0) <= 1;
    });
  }
  const waitForToolExpanded = (expanded: boolean) =>
    input.page.waitForFunction((expected) => {
      const badges = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="tool-call-badge"]'),
      ).filter((badge) => badge.offsetParent !== null);
      return (badges.at(-1)?.children.length ?? 0) > 1 === expected;
    }, expanded);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    measurements.toolExpand.push(
      await measureInteraction(
        input.page,
        () => toolButton.click(),
        () => waitForToolExpanded(true),
      ),
    );
    measurements.toolCollapse.push(
      await measureInteraction(
        input.page,
        () => toolButton.click(),
        () => waitForToolExpanded(false),
      ),
    );
  }
  return measurements;
}

async function measureMarkdownOpen(
  page: Page,
  serverId: string,
  markdownAgent: FixtureAgent,
): Promise<MarkdownMeasurement> {
  const prompt = "emit 1048576 byte markdown benchmark open_typescript_fence in 4096 byte chunks";
  await page.evaluate(() => {
    const state = window as BenchmarkWindow;
    state.__PASEO_DESKTOP_AB_LONG_TASKS__ = [];
    try {
      const observer = new PerformanceObserver((list) => {
        state.__PASEO_DESKTOP_AB_LONG_TASKS__?.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      });
      observer.observe({ type: "longtask" });
    } catch {
      // Long Task is a diagnostic metric; readiness remains authoritative if unavailable.
    }
  });
  await page.getByTestId("sidebar-command-center-search").click();
  const panel = page.getByTestId("command-center-panel");
  await panel.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByTestId("command-center-input").fill(markdownAgent.title);
  const row = panel.getByTestId(`command-center-agent-${serverId}:${markdownAgent.id}`);
  await row.waitFor({ state: "visible", timeout: 60_000 });
  const startedAt = performance.now();
  await row.click();
  await page.getByTestId(`workspace-tab-agent_${markdownAgent.id}`).waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    ({ expectedPrompt }) => {
      for (const node of document.querySelectorAll<HTMLElement>(
        '[data-testid="agent-chat-scroll"]',
      )) {
        const rect = node.getBoundingClientRect();
        const text = node.textContent ?? "";
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          node.offsetParent !== null &&
          text.includes(expectedPrompt) &&
          text.includes("const value = source.map")
        ) {
          return true;
        }
      }
      return false;
    },
    { expectedPrompt: prompt },
    { timeout: 60_000 },
  );
  const readyMs = performance.now() - startedAt;
  return page.evaluate((externalReadyMs) => {
    const state = window as BenchmarkWindow;
    const longTasks = state.__PASEO_DESKTOP_AB_LONG_TASKS__ ?? [];
    const active = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="agent-chat-scroll"]'),
    ).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && node.offsetParent !== null;
    });
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number };
      }
    ).memory;
    return {
      readyMs: externalReadyMs,
      longTaskCount: longTasks.length,
      longTaskDurationMs: longTasks.reduce((sum, duration) => sum + duration, 0),
      maxLongTaskMs: Math.max(0, ...longTasks),
      activeTimelineDomNodes: active ? active.querySelectorAll("*").length + 1 : 0,
      activeTimelineTextLength: active?.textContent?.length ?? 0,
      heapUsedBytes: memory?.usedJSHeapSize ?? 0,
    };
  }, readyMs);
}

async function createAnimatedGif(input: {
  page: Page;
  serverId: string;
  historyWorkspaceTitle: string;
  tabs: FixtureTab[];
  markdownAgent: FixtureAgent;
  outputPath: string;
}): Promise<{ frames: number; width: number; height: number; durationMs: number }> {
  const frames: Buffer[] = [];
  let capturing = true;
  const startedAt = Date.now();
  const captureLoop = (async () => {
    for (;;) {
      if (!capturing) break;
      const screenshot = await input.page.screenshot({ type: "png" });
      frames.push(await sharp(screenshot).resize({ width: 960 }).png().toBuffer());
      await input.page.waitForTimeout(GIF_FRAME_DELAY_MS);
    }
  })();

  await input.page.getByRole("button", { name: input.historyWorkspaceTitle, exact: true }).click();
  await input.page.getByTestId(workspaceTabTestId(input.tabs[0]!)).waitFor({
    timeout: 60_000,
  });
  for (const tab of input.tabs) {
    await clickWorkspaceTab(input.page, tab);
    await input.page.waitForTimeout(360);
  }
  await openAgentFromCommandCenter(input.page, input.serverId, input.markdownAgent);
  await input.page.getByTestId(`workspace-tab-agent_${input.markdownAgent.id}`).waitFor({
    timeout: 60_000,
  });
  await input.page.waitForTimeout(1_000);
  capturing = false;
  await captureLoop;

  const firstMetadata = await sharp(frames[0]).metadata();
  const width = firstMetadata.width ?? 960;
  const height = firstMetadata.height ?? 600;
  const strip = sharp({
    create: {
      width,
      height: height * frames.length,
      pageHeight: height,
      channels: 4,
      background: { r: 20, g: 20, b: 20, alpha: 1 },
    },
  }).composite(frames.map((frame, index) => ({ input: frame, left: 0, top: index * height })));
  await strip
    .gif({
      delay: GIF_FRAME_DELAY_MS,
      loop: 0,
      effort: 5,
      colours: 128,
      dither: 0.5,
    })
    .toFile(input.outputPath);
  return { frames: frames.length, width, height, durationMs: Date.now() - startedAt };
}

function resolveFixtureWorkload(manifest: FixtureManifest): {
  isProductionFixture: boolean;
  workspace: FixtureWorkspace;
  historyAgents: FixtureAgent[];
  providerSubagents: FixtureProviderSubagent[];
  markdownAgent: FixtureAgent;
  markdownWorkspace: FixtureWorkspace;
  nonHistoryAgents: FixtureAgent[];
} {
  const productionWorkspace = manifest.workspaces.find(
    (entry) => (entry.providerSubagentCount ?? 0) >= 108,
  );
  const workspace =
    productionWorkspace ?? manifest.workspaces.find((entry) => entry.targetHistoryItems === 176);
  if (!workspace) throw new Error("Fixture has no production or H176 workspace");
  const isProductionFixture = Boolean(productionWorkspace);
  const historyAgents = workspace.agents.filter((agent) =>
    isProductionFixture ? agent.role === "production-history" : agent.role === "history",
  );
  const providerSubagents = productionWorkspace?.providerSubagents ?? [];
  const markdownAgent = manifest.workspaces
    .flatMap((entry) => entry.agents)
    .find((agent) => agent.role === "markdown-cold");
  const markdownWorkspace = manifest.workspaces.find((entry) =>
    entry.agents.some((agent) => agent.id === markdownAgent?.id),
  );
  if (!markdownAgent || !markdownWorkspace) {
    throw new Error("Fixture must contain one cold Markdown agent");
  }
  if (
    (!isProductionFixture && historyAgents.length !== 8) ||
    (isProductionFixture && (historyAgents.length !== 6 || providerSubagents.length !== 2))
  ) {
    throw new Error("Fixture must contain 8 measured tabs");
  }
  return {
    isProductionFixture,
    workspace,
    historyAgents,
    providerSubagents,
    markdownAgent,
    markdownWorkspace,
    nonHistoryAgents: workspace.agents.filter((agent) => agent.role !== "history"),
  };
}

async function main(): Promise<void> {
  const runDirectory = process.env.LAB_RUN_DIR;
  if (!runDirectory) throw new Error("LAB_RUN_DIR is required; run through lab run");
  const variant = process.env.LAB_VARIANT ?? "unknown";
  const artifactDirectory = path.join(runDirectory, "artifacts");
  const sampleDirectory = path.join(runDirectory, "samples");
  await mkdir(artifactDirectory, { recursive: true });
  await mkdir(sampleDirectory, { recursive: true });

  const manifest = JSON.parse(await readFile(FIXTURE_MANIFEST_PATH, "utf8")) as FixtureManifest;
  const {
    isProductionFixture,
    workspace,
    historyAgents,
    providerSubagents,
    markdownAgent,
    markdownWorkspace,
    nonHistoryAgents,
  } = resolveFixtureWorkload(manifest);

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const page = await resolvePage(browser);
  await initializeProfile(page, manifest);
  const measuredTabs = isProductionFixture
    ? await openProductionTabs(page, manifest.serverId, historyAgents, providerSubagents)
    : (await openHistoryTabs(page, manifest.serverId, historyAgents, nonHistoryAgents),
      historyAgents.map((agent) => ({ ...agent, kind: "agent" as const })));
  await enableRenderProfiling(page, measuredTabs[0]!, measuredTabs[measuredTabs.length - 1]!);
  await page.evaluate(() => (window as BenchmarkWindow).__PASEO_RESET_RENDER_PROFILE__?.());

  const rendererBefore = await readRendererProcess(browser);
  const sampler = await startProcessSampler(rendererBefore.pid);
  const switchSamples: SwitchSample[] = [];
  let previousPrompt = tabSentinel(measuredTabs[measuredTabs.length - 1]!);
  for (let cycle = 0; cycle < SWITCH_CYCLES; cycle += 1) {
    for (let index = 0; index < measuredTabs.length; index += 1) {
      const tab = measuredTabs[index]!;
      const targetPrompt = tabSentinel(tab, index);
      switchSamples.push(await measureSwitch(page, tab, targetPrompt, previousPrompt));
      previousPrompt = targetPrompt;
    }
  }
  const secondary = isProductionFixture
    ? await measureSecondaryInteractions({
        page,
        heavyWorkspace: workspace,
        coldWorkspace: markdownWorkspace,
        tabs: measuredTabs,
        rootAgents: historyAgents,
      })
    : null;
  const pageCdp = await page.context().newCDPSession(page);
  const footprint = await readFootprint(page, pageCdp);
  await pageCdp.detach();
  const markdown = await measureMarkdownOpen(page, manifest.serverId, markdownAgent);
  await sampler.stop();
  const rendererAfter = await readRendererProcess(browser);
  const physical = await readPhysicalFootprint(rendererAfter.pid);

  // GIF pass: same visible controls, after all numeric observers have stopped.
  const gifPath = path.join(artifactDirectory, `${variant}-desktop-version-ab.gif`);
  const gif = await createAnimatedGif({
    page,
    serverId: manifest.serverId,
    historyWorkspaceTitle: workspace.title,
    tabs: measuredTabs,
    markdownAgent,
    outputPath: gifPath,
  });

  const body = metricSummary(switchSamples.map((sample) => sample.bodyConsistentMs));
  const selected = metricSummary(switchSamples.map((sample) => sample.selectedMs));
  const titleReady = metricSummary(switchSamples.map((sample) => sample.titleReadyMs));
  const mismatch = metricSummary(switchSamples.map((sample) => sample.titleBodyMismatchMs));
  const longTask = metricSummary(switchSamples.map((sample) => sample.longTaskDurationMs));
  const frameGap = metricSummary(switchSamples.map((sample) => sample.maxFrameGapMs));
  const droppedFrames = metricSummary(switchSamples.map((sample) => sample.droppedFrameCount));
  const reactCommits = metricSummary(switchSamples.map((sample) => sample.reactCommits));
  const reactDuration = metricSummary(switchSamples.map((sample) => sample.reactDurationMs));
  const heapDelta = metricSummary(switchSamples.map((sample) => sample.heapDeltaBytes));
  const rssSamples = sampler.samples.map((sample) => sample.rssBytes);
  const cpuSamples = sampler.samples.map((sample) => sample.cpuPercent);
  const secondaryReady = (key: keyof SecondaryInteractionMeasurements) =>
    metricSummary((secondary?.[key] ?? []).map((sample) => sample.readyMs));
  const secondaryLongTask = (key: keyof SecondaryInteractionMeasurements) =>
    metricSummary((secondary?.[key] ?? []).map((sample) => sample.longTaskDurationMs));

  const metrics = {
    switch_body_consistent_p50_ms: body.p50,
    switch_body_consistent_p95_ms: body.p95,
    switch_selected_p50_ms: selected.p50,
    switch_selected_p95_ms: selected.p95,
    switch_title_ready_p50_ms: titleReady.p50,
    switch_title_ready_p95_ms: titleReady.p95,
    switch_title_body_mismatch_p50_ms: mismatch.p50,
    switch_title_body_mismatch_p95_ms: mismatch.p95,
    switch_long_task_duration_p50_ms: longTask.p50,
    switch_long_task_duration_p95_ms: longTask.p95,
    switch_max_frame_gap_p50_ms: frameGap.p50,
    switch_max_frame_gap_p95_ms: frameGap.p95,
    switch_dropped_frames_p50: droppedFrames.p50,
    switch_dropped_frames_p95: droppedFrames.p95,
    switch_react_commits_p50: reactCommits.p50,
    switch_react_commits_p95: reactCommits.p95,
    switch_react_duration_p50_ms: reactDuration.p50,
    switch_react_duration_p95_ms: reactDuration.p95,
    switch_heap_delta_p50_mb: bytesToMb(heapDelta.p50),
    switch_heap_delta_p95_mb: bytesToMb(heapDelta.p95),
    ...(secondary
      ? {
          workspace_to_cold_p50_ms: secondaryReady("workspaceToCold").p50,
          workspace_to_cold_p95_ms: secondaryReady("workspaceToCold").p95,
          workspace_to_heavy_p50_ms: secondaryReady("workspaceToHeavy").p50,
          workspace_to_heavy_p95_ms: secondaryReady("workspaceToHeavy").p95,
          workspace_to_heavy_long_task_p95_ms: secondaryLongTask("workspaceToHeavy").p95,
          subagent_expand_p50_ms: secondaryReady("subagentExpand").p50,
          subagent_expand_p95_ms: secondaryReady("subagentExpand").p95,
          subagent_collapse_p50_ms: secondaryReady("subagentCollapse").p50,
          subagent_collapse_p95_ms: secondaryReady("subagentCollapse").p95,
          tool_expand_p50_ms: secondaryReady("toolExpand").p50,
          tool_expand_p95_ms: secondaryReady("toolExpand").p95,
          tool_collapse_p50_ms: secondaryReady("toolCollapse").p50,
          tool_collapse_p95_ms: secondaryReady("toolCollapse").p95,
        }
      : {}),
    markdown_ready_ms: Math.round(markdown.readyMs * 100) / 100,
    markdown_long_task_duration_ms: Math.round(markdown.longTaskDurationMs * 100) / 100,
    markdown_max_long_task_ms: Math.round(markdown.maxLongTaskMs * 100) / 100,
    markdown_active_timeline_dom_nodes: markdown.activeTimelineDomNodes,
    markdown_active_timeline_text_length: markdown.activeTimelineTextLength,
    markdown_heap_used_mb: bytesToMb(markdown.heapUsedBytes),
    dom_nodes_post_gc: footprint.domNodes,
    active_timeline_dom_nodes_post_gc: footprint.activeTimelineDomNodes,
    inactive_timeline_dom_nodes_post_gc: footprint.inactiveTimelineDomNodes,
    ax_nodes_post_gc: footprint.axNodes,
    ax_non_ignored_nodes_post_gc: footprint.axNonIgnoredNodes,
    heap_used_post_gc_mb: bytesToMb(footprint.heapUsedBytes),
    heap_used_before_gc_mb: bytesToMb(footprint.heapUsedBeforeGcBytes),
    renderer_rss_p50_mb: bytesToMb(metricSummary(rssSamples).p50),
    renderer_rss_peak_mb: bytesToMb(Math.max(0, ...rssSamples)),
    renderer_cpu_percent_p50: metricSummary(cpuSamples).p50,
    renderer_cpu_percent_p95: metricSummary(cpuSamples).p95,
    renderer_cpu_time_delta_seconds:
      Math.round(Math.max(0, rendererAfter.cpuTime - rendererBefore.cpuTime) * 1000) / 1000,
    renderer_physical_footprint_mb: physical.physicalMb,
    renderer_physical_footprint_peak_mb: physical.physicalPeakMb,
    renderer_swapped_out_mb: physical.swappedMb,
    gif_frames: gif.frames,
    gif_duration_ms: gif.durationMs,
  };
  const benchmark = {
    schemaVersion: isProductionFixture ? 2 : 1,
    experiment: "desktop_version_ab",
    benchmark: isProductionFixture
      ? "desktop_production_calibrated_fixture@v2"
      : "desktop_version_fixture@v1",
    variant,
    generatedAt: new Date().toISOString(),
    targetCommit: process.env.PASEO_COMPARE_TARGET_COMMIT ?? null,
    fixture: {
      id: manifest.fixtureId,
      serverId: manifest.serverId,
      endpoint: manifest.endpoint,
      workspaceId: workspace.id,
      measuredTabs: measuredTabs.map((tab) => ({ kind: tab.kind, id: tab.id })),
      markdownAgentId: markdownAgent.id,
    },
    workload: {
      status: isProductionFixture ? "production-calibrated" : "smoke-only",
      timelineItems: measuredTabs.reduce((sum, tab) => sum + tab.projectedItems, 0),
      timelineJsonBytes: measuredTabs.reduce((sum, tab) => sum + (tab.jsonBytes ?? 0), 0),
      toolCalls: measuredTabs.reduce((sum, tab) => sum + (tab.toolCalls ?? 0), 0),
      rootAgents: historyAgents.length,
      providerSubagentTabs: providerSubagents.length,
      providerSubagentDescriptors: workspace.providerSubagentCount ?? 0,
      runningProviderSubagents: workspace.runningProviderSubagentCount ?? 0,
      historyWarmupMode: HISTORY_WARMUP_MODE,
      switchCycles: SWITCH_CYCLES,
      measuredSwitches: switchSamples.length,
      markdownPayloadBytes: 1024 * 1024,
      gifFrameDelayMs: GIF_FRAME_DELAY_MS,
    },
    metrics,
    summaries: {
      body,
      selected,
      titleReady,
      mismatch,
      longTask,
      frameGap,
      droppedFrames,
      reactCommits,
      reactDuration,
      heapDelta,
    },
    footprint,
    markdown,
    secondary,
    physical,
    renderer: {
      pid: rendererAfter.pid,
      cpuTimeBefore: rendererBefore.cpuTime,
      cpuTimeAfter: rendererAfter.cpuTime,
      processSamples: sampler.samples,
    },
    gif: { path: gifPath, ...gif },
  };

  await Promise.all([
    writeFile(path.join(runDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
    writeFile(path.join(runDirectory, "benchmark.json"), `${JSON.stringify(benchmark, null, 2)}\n`),
    writeFile(
      path.join(sampleDirectory, "switches.json"),
      `${JSON.stringify(switchSamples, null, 2)}\n`,
    ),
  ]);
  process.stdout.write(`${JSON.stringify({ variant, metrics, gifPath }, null, 2)}\n`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
