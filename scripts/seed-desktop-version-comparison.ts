/**
 * Seeds a persistent, isolated daemon with deterministic desktop performance data.
 *
 * The daemon lifecycle is intentionally separate from this script. Start one with
 * its own PASEO_HOME and loopback port, then point this script at that endpoint:
 *
 *   npx tsx scripts/seed-desktop-version-comparison.ts \
 *     --endpoint ws://127.0.0.1:17677/ws \
 *     --root .dev/desktop-version-comparison/repos \
 *     --output .dev/desktop-version-comparison/fixture-manifest.json
 *
 * The fixture mirrors the desktop interaction benchmark's H50/H100/H176 groups,
 * while adding long Markdown/code, large tool payloads, terminals, and dirty Git
 * worktrees for manual version-to-version comparison.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_FIXTURE_ROOT = path.join(REPO_ROOT, ".dev", "desktop-version-comparison", "repos");
const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  ".dev",
  "desktop-version-comparison",
  "fixture-manifest.json",
);
const ASSISTANT_CHUNKS_PER_TURN = 32;
const HISTORY_GROUPS = [
  {
    historyItems: 50,
    turns: 25,
    markdownBytes: 64 * 1024,
    markdownWorkload: "mixed_markdown",
    diffBytes: 128 * 1024,
  },
  {
    historyItems: 100,
    turns: 50,
    markdownBytes: 256 * 1024,
    markdownWorkload: "closed_typescript_fences",
    diffBytes: 512 * 1024,
  },
  {
    historyItems: 176,
    turns: 88,
    markdownBytes: 1024 * 1024,
    markdownWorkload: "open_typescript_fence",
    diffBytes: 1000 * 1000,
  },
] as const;
const AGENTS_PER_HISTORY_GROUP = 8;
const LIGHT_WORKSPACE_COUNT = 7;
const PRODUCTION_HISTORY_TARGETS = [
  { profile: "A1", items: 70, jsonBytes: 83_075, stringChars: 44_111, toolCalls: 2 },
  { profile: "A2", items: 2_071, jsonBytes: 1_769_588, stringChars: 1_084_160, toolCalls: 854 },
  { profile: "A3", items: 432, jsonBytes: 1_324_176, stringChars: 1_152_992, toolCalls: 208 },
  { profile: "A4", items: 1_568, jsonBytes: 2_345_187, stringChars: 1_876_617, toolCalls: 953 },
  { profile: "A5", items: 554, jsonBytes: 945_400, stringChars: 773_063, toolCalls: 476 },
  { profile: "A6", items: 39, jsonBytes: 273_496, stringChars: 255_978, toolCalls: 0 },
] as const;
const PRODUCTION_CALIBRATION = {
  rootTimelineItems: 4_734,
  providerTimelineItems: 660,
  totalTimelineItems: 5_394,
  rootJsonBytes: 6_740_922,
  providerJsonBytes: 861_669,
  totalJsonBytes: 7_602_591,
  toolCalls: 2_586,
  providerSubagents: 108,
  runningProviderSubagents: 10,
};

interface WorkspaceDescriptor {
  id: string;
  name: string;
  projectId: string;
  projectDisplayName: string;
  workspaceDirectory: string;
}

interface TimelinePayload {
  entries: Array<{ item: Record<string, unknown> & { type: string } }>;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
}

interface ProviderSubagentListPayload {
  subagents: Array<{
    id: string;
    title: string | null;
    status: "running" | "completed" | "failed" | "canceled";
  }>;
}

interface ProviderSubagentTimelinePayload {
  rows: Array<{ item: Record<string, unknown> & { type: string } }>;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
}

interface SeedClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  fetchAgents(options?: { scope?: "active" }): Promise<unknown>;
  createWorkspace(input: {
    source: { kind: "directory"; path: string };
    title?: string;
  }): Promise<{ workspace: WorkspaceDescriptor | null; error: string | null }>;
  createAgent(options: {
    provider: string;
    cwd: string;
    workspaceId: string;
    title: string;
    modeId: string;
    model: string;
  }): Promise<{ id: string; status: string }>;
  sendAgentMessage(agentId: string, text: string): Promise<void>;
  waitForFinish(
    agentId: string,
    timeout?: number,
  ): Promise<{ status: "idle" | "error" | "permission" | "timeout"; error?: string | null }>;
  fetchAgentTimeline(
    agentId: string,
    options: { direction: "tail"; limit: number; projection: "projected" },
  ): Promise<TimelinePayload>;
  listProviderSubagents(agentId: string): Promise<ProviderSubagentListPayload>;
  fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options: { direction: "tail"; limit: number },
  ): Promise<ProviderSubagentTimelinePayload>;
  createTerminal(
    cwd: string,
    name?: string,
    requestId?: string,
    options?: { workspaceId?: string; size?: { rows: number; cols: number } },
  ): Promise<{ terminal: { id: string; name: string } | null; error: string | null }>;
  getLastServerInfoMessage(): { serverId?: string } | null;
}

interface SeedClientConstructor {
  new (config: {
    url: string;
    clientId: string;
    clientType: "cli";
    appVersion: string;
    webSocketFactory: (url: string, options?: { headers?: Record<string, string> }) => unknown;
  }): SeedClient;
}

interface ParsedArguments {
  endpoint: string;
  fixtureRoot: string;
  manifestPath: string;
  profile: "smoke-v1" | "production-v2";
}

interface RepoFixture {
  path: string;
  trackedFiles: number;
  modifiedFiles: number;
  untrackedFiles: number;
}

interface AgentFixture {
  id: string;
  title: string;
  projectedItems: number;
  canonicalSeqCount: number;
  role: "history" | "markdown" | "markdown-cold" | "large-diff" | "light" | "production-history";
  sentinel?: string;
  oldestSentinel?: string;
  jsonBytes?: number;
  stringChars?: number;
  toolCalls?: number;
  maxItemBytes?: number;
}

interface WorkspaceFixture {
  id: string;
  title: string;
  projectId: string;
  repo: RepoFixture;
  terminalId: string | null;
  targetHistoryItems: number | null;
  agents: AgentFixture[];
  providerSubagentCount?: number;
  runningProviderSubagentCount?: number;
  providerSubagents?: Array<{
    parentAgentId: string;
    id: string;
    title: string;
    status: string;
    projectedItems: number;
    sentinel: string;
    oldestSentinel: string;
    jsonBytes: number;
    stringChars: number;
    toolCalls: number;
    maxItemBytes: number;
  }>;
}

function parseArguments(argv: string[]): ParsedArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key ?? "<missing>"}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const endpoint = values.get("--endpoint");
  if (!endpoint) {
    throw new Error("--endpoint is required");
  }
  const parsedEndpoint = new URL(endpoint);
  if (
    !["ws:", "wss:"].includes(parsedEndpoint.protocol) ||
    !["127.0.0.1", "localhost"].includes(parsedEndpoint.hostname)
  ) {
    throw new Error(`Refusing non-loopback benchmark endpoint: ${endpoint}`);
  }
  if (parsedEndpoint.port === "6767") {
    throw new Error("Refusing to seed the production daemon on port 6767");
  }
  const requestedProfile = values.get("--profile");
  if (requestedProfile && !["smoke-v1", "production-v2"].includes(requestedProfile)) {
    throw new Error(`Unsupported fixture profile: ${requestedProfile}`);
  }

  return {
    endpoint: parsedEndpoint.toString(),
    fixtureRoot: path.resolve(values.get("--root") ?? DEFAULT_FIXTURE_ROOT),
    manifestPath: path.resolve(values.get("--output") ?? DEFAULT_MANIFEST_PATH),
    profile: requestedProfile === "production-v2" ? "production-v2" : "smoke-v1",
  };
}

async function assertFreshManifest(manifestPath: string): Promise<void> {
  try {
    await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(
    `Fixture manifest already exists at ${manifestPath}; refusing to duplicate daemon data`,
  );
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

function trackedFileContent(workspaceIndex: number, fileIndex: number, revision: number): string {
  const line = `workspace=${workspaceIndex} file=${fileIndex} revision=${revision} deterministic desktop performance fixture\n`;
  return `// ${line}${line.repeat(12)}`;
}

async function writeInBatches(
  count: number,
  writer: (index: number) => Promise<void>,
): Promise<void> {
  const batchSize = 100;
  for (let start = 0; start < count; start += batchSize) {
    await Promise.all(
      Array.from({ length: Math.min(batchSize, count - start) }, (_, offset) =>
        writer(start + offset),
      ),
    );
  }
}

async function createRepoFixture(input: {
  root: string;
  slug: string;
  workspaceIndex: number;
  trackedFiles: number;
  modifiedFiles: number;
  untrackedFiles: number;
}): Promise<RepoFixture> {
  const repoPath = path.join(input.root, input.slug);
  const trackedDirectory = path.join(repoPath, "src", "fixture");
  const untrackedDirectory = path.join(repoPath, "generated");
  await mkdir(trackedDirectory, { recursive: true });
  await mkdir(untrackedDirectory, { recursive: true });

  await writeInBatches(input.trackedFiles, async (fileIndex) => {
    await writeFile(
      path.join(trackedDirectory, `file-${String(fileIndex).padStart(4, "0")}.ts`),
      trackedFileContent(input.workspaceIndex, fileIndex, 0),
    );
  });
  await writeFile(
    path.join(repoPath, "README.md"),
    `# Desktop version comparison ${input.workspaceIndex}\n\nDeterministic Paseo performance fixture.\n`,
  );
  await runGit(repoPath, ["init", "-q"]);
  await runGit(repoPath, ["config", "user.email", "desktop-perf@paseo.local"]);
  await runGit(repoPath, ["config", "user.name", "Paseo Desktop Perf"]);
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-q", "-m", "seed deterministic baseline"]);

  await writeInBatches(input.modifiedFiles, async (fileIndex) => {
    await writeFile(
      path.join(trackedDirectory, `file-${String(fileIndex).padStart(4, "0")}.ts`),
      trackedFileContent(input.workspaceIndex, fileIndex, 1),
    );
  });
  await writeInBatches(input.untrackedFiles, async (fileIndex) => {
    await writeFile(
      path.join(untrackedDirectory, `artifact-${String(fileIndex).padStart(4, "0")}.json`),
      `${JSON.stringify({ workspaceIndex: input.workspaceIndex, fileIndex, payload: "x".repeat(512) })}\n`,
    );
  });

  return {
    path: repoPath,
    trackedFiles: input.trackedFiles,
    modifiedFiles: input.modifiedFiles,
    untrackedFiles: input.untrackedFiles,
  };
}

async function loadClientConstructor(): Promise<SeedClientConstructor> {
  const moduleUrl = pathToFileURL(
    path.join(REPO_ROOT, "packages", "client", "dist", "daemon-client.js"),
  ).href;
  const module = (await import(moduleUrl)) as { DaemonClient: SeedClientConstructor };
  return module.DaemonClient;
}

async function loadAppVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(REPO_ROOT, "packages", "app", "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("packages/app/package.json has no version");
  }
  return packageJson.version;
}

async function connectClient(endpoint: string): Promise<SeedClient> {
  const Client = await loadClientConstructor();
  const client = new Client({
    url: endpoint,
    clientId: `desktop-version-seed-${randomUUID()}`,
    clientType: "cli",
    appVersion: await loadAppVersion(),
    webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
  });
  await client.connect();
  await client.fetchAgents({ scope: "active" });
  return client;
}

async function createAgent(
  client: SeedClient,
  workspace: WorkspaceDescriptor,
  repoPath: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const agent = await client.createAgent({
    provider: "mock",
    cwd: repoPath,
    workspaceId: workspace.id,
    title,
    modeId: "load-test",
    model: "ten-second-stream",
  });
  return { id: agent.id, title };
}

async function runPrompt(client: SeedClient, agentId: string, prompt: string): Promise<void> {
  await client.sendAgentMessage(agentId, prompt);
  const result = await client.waitForFinish(agentId, 60_000);
  if (result.status !== "idle") {
    throw new Error(
      `Agent ${agentId} did not finish prompt (${result.status}): ${result.error ?? ""}`,
    );
  }
}

async function inspectAgent(
  client: SeedClient,
  agent: { id: string; title: string },
  role: AgentFixture["role"],
): Promise<AgentFixture> {
  const timeline = await client.fetchAgentTimeline(agent.id, {
    direction: "tail",
    limit: 0,
    projection: "projected",
  });
  return {
    id: agent.id,
    title: agent.title,
    role,
    projectedItems: timeline.entries.length,
    canonicalSeqCount: timeline.window.nextSeq,
  };
}

function countStringChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countStringChars(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + countStringChars(item), 0);
  }
  return 0;
}

function summarizeTimelineItems(items: Array<Record<string, unknown> & { type: string }>) {
  const itemBytes = items.map((item) => Buffer.byteLength(JSON.stringify(item)));
  return {
    projectedItems: items.length,
    jsonBytes: itemBytes.reduce((sum, bytes) => sum + bytes, 0),
    stringChars: items.reduce((sum, item) => sum + countStringChars(item), 0),
    toolCalls: items.filter((item) => item.type === "tool_call").length,
    maxItemBytes: Math.max(0, ...itemBytes),
  };
}

async function inspectProductionAgent(
  client: SeedClient,
  agent: { id: string; title: string },
  profile: string,
): Promise<AgentFixture> {
  const timeline = await client.fetchAgentTimeline(agent.id, {
    direction: "tail",
    limit: 10_000,
    projection: "projected",
  });
  return {
    id: agent.id,
    title: agent.title,
    role: "production-history",
    canonicalSeqCount: timeline.window.nextSeq,
    sentinel: `desktop-production-${profile.toLowerCase()}-last`,
    oldestSentinel: `desktop-production-${profile.toLowerCase()}-message-0001`,
    ...summarizeTimelineItems(timeline.entries.map((entry) => entry.item)),
  };
}

async function createWorkspace(
  client: SeedClient,
  repo: RepoFixture,
  title: string,
): Promise<WorkspaceDescriptor> {
  const created = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
    title,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create workspace ${title}`);
  }
  return created.workspace;
}

async function seedProductionWorkspace(input: {
  client: SeedClient;
  fixtureRoot: string;
}): Promise<WorkspaceFixture> {
  const title = "Perf Production v2 — 8 heavy tabs";
  console.log(`[seed] preparing ${title}`);
  const repo = await createRepoFixture({
    root: input.fixtureRoot,
    slug: "production-heavy",
    workspaceIndex: 0,
    trackedFiles: 2_500,
    modifiedFiles: 400,
    untrackedFiles: 275,
  });
  const workspace = await createWorkspace(input.client, repo, title);
  const terminalResult = await input.client.createTerminal(
    repo.path,
    "Production-calibrated shell",
    undefined,
    { workspaceId: workspace.id, size: { rows: 50, cols: 160 } },
  );
  if (!terminalResult.terminal) {
    throw new Error(terminalResult.error ?? "Failed to create production fixture terminal");
  }

  const agents = await Promise.all(
    PRODUCTION_HISTORY_TARGETS.map((target) =>
      createAgent(
        input.client,
        workspace,
        repo.path,
        `Production heavy ${target.profile} — ${target.items} items`,
      ),
    ),
  );
  await Promise.all(
    agents.map((agent, index) =>
      runPrompt(
        input.client,
        agent.id,
        `emit production calibrated desktop fixture profile ${PRODUCTION_HISTORY_TARGETS[index]!.profile}`,
      ),
    ),
  );

  const inspectedAgents = await Promise.all(
    agents.map((agent, index) =>
      inspectProductionAgent(input.client, agent, PRODUCTION_HISTORY_TARGETS[index]!.profile),
    ),
  );
  for (let index = 0; index < inspectedAgents.length; index += 1) {
    const actual = inspectedAgents[index]!;
    const target = PRODUCTION_HISTORY_TARGETS[index]!;
    if (actual.projectedItems !== target.items || actual.toolCalls !== target.toolCalls) {
      throw new Error(
        `${target.profile} shape mismatch: ${actual.projectedItems} items/${actual.toolCalls} tools, expected ${target.items}/${target.toolCalls}`,
      );
    }
  }

  const parentAgent = inspectedAgents[1]!;
  const providerList = await input.client.listProviderSubagents(parentAgent.id);
  const runningProviderSubagents = providerList.subagents.filter(
    (subagent) => subagent.status === "running",
  ).length;
  if (
    providerList.subagents.length !== PRODUCTION_CALIBRATION.providerSubagents ||
    runningProviderSubagents !== PRODUCTION_CALIBRATION.runningProviderSubagents
  ) {
    throw new Error(
      `Provider subagent mismatch: ${providerList.subagents.length} total/${runningProviderSubagents} running`,
    );
  }

  const selectedProviderSubagents = providerList.subagents.slice(0, 2);
  const providerSubagents = await Promise.all(
    selectedProviderSubagents.map(async (subagent) => {
      const timeline = await input.client.fetchProviderSubagentTimeline(
        parentAgent.id,
        subagent.id,
        { direction: "tail", limit: 10_000 },
      );
      const stats = summarizeTimelineItems(timeline.rows.map((row) => row.item));
      return {
        parentAgentId: parentAgent.id,
        id: subagent.id,
        title: subagent.title ?? subagent.id,
        status: subagent.status,
        sentinel: `desktop-production-${subagent.id}-last`,
        oldestSentinel: `desktop-production-${subagent.id}-message-0001`,
        projectedItems: stats.projectedItems,
        jsonBytes: stats.jsonBytes,
        stringChars: stats.stringChars,
        toolCalls: stats.toolCalls,
        maxItemBytes: stats.maxItemBytes,
      };
    }),
  );

  return {
    id: workspace.id,
    title,
    projectId: workspace.projectId,
    repo,
    terminalId: terminalResult.terminal.id,
    targetHistoryItems: null,
    agents: inspectedAgents,
    providerSubagentCount: providerList.subagents.length,
    runningProviderSubagentCount: runningProviderSubagents,
    providerSubagents,
  };
}

async function seedProductionColdMarkdownWorkspace(input: {
  client: SeedClient;
  fixtureRoot: string;
}): Promise<WorkspaceFixture> {
  const title = "Perf Production v2 — cold Markdown";
  console.log(`[seed] preparing ${title}`);
  const repo = await createRepoFixture({
    root: input.fixtureRoot,
    slug: "production-cold-markdown",
    workspaceIndex: 1,
    trackedFiles: 50,
    modifiedFiles: 5,
    untrackedFiles: 5,
  });
  const workspace = await createWorkspace(input.client, repo, title);
  const agent = await createAgent(
    input.client,
    workspace,
    repo.path,
    "Markdown cold-only 1048576B open_typescript_fence",
  );
  await runPrompt(
    input.client,
    agent.id,
    "emit 1048576 byte markdown benchmark open_typescript_fence in 4096 byte chunks",
  );
  return {
    id: workspace.id,
    title,
    projectId: workspace.projectId,
    repo,
    terminalId: null,
    targetHistoryItems: null,
    agents: [await inspectAgent(input.client, agent, "markdown-cold")],
  };
}

function assertProductionCalibration(workspaces: WorkspaceFixture[]): void {
  const production = workspaces.find((workspace) => workspace.providerSubagents);
  if (!production) throw new Error("Production fixture workspace is missing");
  const providerSubagents = production.providerSubagents ?? [];
  const rootItems = production.agents.reduce((sum, agent) => sum + agent.projectedItems, 0);
  const providerItems = providerSubagents.reduce(
    (sum, subagent) => sum + subagent.projectedItems,
    0,
  );
  const rootBytes = production.agents.reduce((sum, agent) => sum + (agent.jsonBytes ?? 0), 0);
  const providerBytes = providerSubagents.reduce((sum, subagent) => sum + subagent.jsonBytes, 0);
  const toolCalls =
    production.agents.reduce((sum, agent) => sum + (agent.toolCalls ?? 0), 0) +
    providerSubagents.reduce((sum, subagent) => sum + subagent.toolCalls, 0);
  const ratio = (actual: number, target: number) => Math.abs(actual - target) / target;
  const errors = [
    ["root timeline items", rootItems, PRODUCTION_CALIBRATION.rootTimelineItems, 0],
    ["provider timeline items", providerItems, PRODUCTION_CALIBRATION.providerTimelineItems, 0],
    ["root JSON bytes", rootBytes, PRODUCTION_CALIBRATION.rootJsonBytes, 0.15],
    ["provider JSON bytes", providerBytes, PRODUCTION_CALIBRATION.providerJsonBytes, 0.15],
    ["tool calls", toolCalls, PRODUCTION_CALIBRATION.toolCalls, 0],
  ] as const;
  const failures = errors.filter(([, actual, target, tolerance]) =>
    tolerance === 0 ? actual !== target : ratio(actual, target) > tolerance,
  );
  console.log(
    `[seed] production calibration: ${errors
      .map(([label, actual, target]) => `${label}=${actual}/${target}`)
      .join(", ")}`,
  );
  if (failures.length > 0) {
    throw new Error(
      `Production calibration failed:\n${failures
        .map(([label, actual, target]) => `- ${label}: ${actual}, target ${target}`)
        .join("\n")}`,
    );
  }
}

async function seedHeavyWorkspace(input: {
  client: SeedClient;
  fixtureRoot: string;
  groupIndex: number;
  group: (typeof HISTORY_GROUPS)[number];
}): Promise<WorkspaceFixture> {
  const { client, group, groupIndex } = input;
  const title = `Perf H${group.historyItems} — 8 heavy agents`;
  console.log(`[seed] preparing ${title}`);
  const repo = await createRepoFixture({
    root: input.fixtureRoot,
    slug: `heavy-h${group.historyItems}`,
    workspaceIndex: groupIndex,
    trackedFiles: 600,
    modifiedFiles: 120,
    untrackedFiles: 80,
  });
  const workspace = await createWorkspace(client, repo, title);
  const terminalResult = await client.createTerminal(
    repo.path,
    `Perf shell H${group.historyItems}`,
    undefined,
    {
      workspaceId: workspace.id,
      size: { rows: 40, cols: 140 },
    },
  );
  if (!terminalResult.terminal) {
    throw new Error(terminalResult.error ?? `Failed to create terminal for ${title}`);
  }

  const historyAgents = await Promise.all(
    Array.from({ length: AGENTS_PER_HISTORY_GROUP }, (_, agentIndex) =>
      createAgent(
        client,
        workspace,
        repo.path,
        `Desktop perf H${group.historyItems} A${agentIndex + 1}`,
      ),
    ),
  );
  for (let turnIndex = 0; turnIndex < group.turns; turnIndex += 1) {
    await Promise.all(
      historyAgents.map((agent, agentIndex) =>
        runPrompt(
          client,
          agent.id,
          `desktop-version-h${group.historyItems}-a${agentIndex + 1}-turn-${turnIndex + 1}: emit ${ASSISTANT_CHUNKS_PER_TURN} coalesced agent stream updates`,
        ),
      ),
    );
    if ((turnIndex + 1) % 10 === 0 || turnIndex + 1 === group.turns) {
      console.log(`[seed] ${title}: ${turnIndex + 1}/${group.turns} turns per agent`);
    }
  }

  const markdownAgent = await createAgent(
    client,
    workspace,
    repo.path,
    `Markdown ${group.markdownBytes}B ${group.markdownWorkload}`,
  );
  await runPrompt(
    client,
    markdownAgent.id,
    `emit ${group.markdownBytes} byte markdown benchmark ${group.markdownWorkload} in 4096 byte chunks`,
  );
  const diffAgent = await createAgent(
    client,
    workspace,
    repo.path,
    `Tool payload ${group.diffBytes}B diff`,
  );
  await runPrompt(
    client,
    diffAgent.id,
    `emit ${group.diffBytes} byte large diff agent stream update`,
  );

  const inspectedHistoryAgents = await Promise.all(
    historyAgents.map((agent) => inspectAgent(client, agent, "history")),
  );
  for (const agent of inspectedHistoryAgents) {
    if (agent.projectedItems !== group.historyItems) {
      throw new Error(
        `${agent.title} has ${agent.projectedItems} projected items, expected ${group.historyItems}`,
      );
    }
  }

  return {
    id: workspace.id,
    title,
    projectId: workspace.projectId,
    repo,
    terminalId: terminalResult.terminal.id,
    targetHistoryItems: group.historyItems,
    agents: [
      ...inspectedHistoryAgents,
      await inspectAgent(client, markdownAgent, "markdown"),
      await inspectAgent(client, diffAgent, "large-diff"),
    ],
  };
}

async function seedLightWorkspace(input: {
  client: SeedClient;
  fixtureRoot: string;
  workspaceIndex: number;
}): Promise<WorkspaceFixture> {
  const label = String(input.workspaceIndex + 1).padStart(2, "0");
  const title = `Perf Light ${label}`;
  console.log(`[seed] preparing ${title}`);
  const repo = await createRepoFixture({
    root: input.fixtureRoot,
    slug: `light-${label}`,
    workspaceIndex: HISTORY_GROUPS.length + input.workspaceIndex,
    trackedFiles: 50,
    modifiedFiles: 5,
    untrackedFiles: 5,
  });
  const workspace = await createWorkspace(input.client, repo, title);
  const agent = await createAgent(input.client, workspace, repo.path, `${title} agent`);
  for (let turnIndex = 0; turnIndex < 5; turnIndex += 1) {
    await runPrompt(
      input.client,
      agent.id,
      `desktop-version-light-${label}-turn-${turnIndex + 1}: emit 8 coalesced agent stream updates`,
    );
  }
  const agents = [await inspectAgent(input.client, agent, "light")];
  if (input.workspaceIndex === 0) {
    const coldMarkdownAgent = await createAgent(
      input.client,
      workspace,
      repo.path,
      "Markdown cold-only 1048576B open_typescript_fence",
    );
    await runPrompt(
      input.client,
      coldMarkdownAgent.id,
      "emit 1048576 byte markdown benchmark open_typescript_fence in 4096 byte chunks",
    );
    agents.push(await inspectAgent(input.client, coldMarkdownAgent, "markdown-cold"));
  }
  return {
    id: workspace.id,
    title,
    projectId: workspace.projectId,
    repo,
    terminalId: null,
    targetHistoryItems: 10,
    agents,
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  await assertFreshManifest(args.manifestPath);
  await mkdir(args.fixtureRoot, { recursive: true });
  await mkdir(path.dirname(args.manifestPath), { recursive: true });

  console.log(`[seed] connecting to ${args.endpoint}`);
  const client = await connectClient(args.endpoint);
  try {
    const serverId = client.getLastServerInfoMessage()?.serverId ?? null;
    const workspaces: WorkspaceFixture[] = [];
    if (args.profile === "production-v2") {
      workspaces.push(
        await seedProductionWorkspace({ client, fixtureRoot: args.fixtureRoot }),
        await seedProductionColdMarkdownWorkspace({
          client,
          fixtureRoot: args.fixtureRoot,
        }),
      );
      assertProductionCalibration(workspaces);
    } else {
      for (let groupIndex = 0; groupIndex < HISTORY_GROUPS.length; groupIndex += 1) {
        workspaces.push(
          await seedHeavyWorkspace({
            client,
            fixtureRoot: args.fixtureRoot,
            groupIndex,
            group: HISTORY_GROUPS[groupIndex],
          }),
        );
      }
      for (let workspaceIndex = 0; workspaceIndex < LIGHT_WORKSPACE_COUNT; workspaceIndex += 1) {
        workspaces.push(
          await seedLightWorkspace({ client, fixtureRoot: args.fixtureRoot, workspaceIndex }),
        );
      }
    }

    const agents = workspaces.flatMap((workspace) => workspace.agents);
    const manifest = {
      schemaVersion: args.profile === "production-v2" ? 2 : 1,
      fixtureId:
        args.profile === "production-v2"
          ? "desktop-production-calibrated-v2"
          : "desktop-version-comparison-v1",
      status: args.profile === "production-v2" ? "production-calibrated" : "smoke-only",
      createdAt: new Date().toISOString(),
      endpoint: args.endpoint,
      serverId,
      ...(args.profile === "production-v2" ? { calibrationTargets: PRODUCTION_CALIBRATION } : {}),
      constants: {
        assistantChunksPerTurn: ASSISTANT_CHUNKS_PER_TURN,
        historyAgentsPerGroup: AGENTS_PER_HISTORY_GROUP,
      },
      totals: {
        workspaces: workspaces.length,
        agents: agents.length,
        terminals: workspaces.filter((workspace) => workspace.terminalId !== null).length,
        projectedTimelineItems: agents.reduce((sum, agent) => sum + agent.projectedItems, 0),
        canonicalTimelineSeqs: agents.reduce((sum, agent) => sum + agent.canonicalSeqCount, 0),
        trackedFiles: workspaces.reduce((sum, workspace) => sum + workspace.repo.trackedFiles, 0),
        modifiedFiles: workspaces.reduce((sum, workspace) => sum + workspace.repo.modifiedFiles, 0),
        untrackedFiles: workspaces.reduce(
          (sum, workspace) => sum + workspace.repo.untrackedFiles,
          0,
        ),
        providerSubagents: workspaces.reduce(
          (sum, workspace) => sum + (workspace.providerSubagentCount ?? 0),
          0,
        ),
      },
      workspaces,
    };
    await writeFile(args.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`[seed] complete: ${args.manifestPath}`);
    console.log(JSON.stringify(manifest.totals, null, 2));
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
