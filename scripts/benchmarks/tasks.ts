export interface BenchmarkTaskDefinition {
  id: string;
  description: string;
  command: string;
  args: string[];
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

export const benchmarkTasks: BenchmarkTaskDefinition[] = [
  {
    id: "agent-stream-reducer",
    description: "Measure assistant chunk reduction across scheduled client reducer flushes",
    command: npxCommand,
    args: [
      "--no-install",
      "tsx",
      "--tsconfig",
      "packages/app/tsconfig.json",
      "packages/app/scripts/benchmark-agent-stream-reducer.ts",
    ],
  },
  {
    id: "desktop-interaction",
    description:
      "Measure heavy agent-tab switching, title/body consistency, render work, DOM, AX, and heap",
    command: npxCommand,
    args: [
      "--no-install",
      "cross-env",
      "E2E_DESKTOP_RUNTIME=1",
      "PASEO_DESKTOP_BENCHMARK=1",
      "playwright",
      "test",
      "--config",
      "packages/app/playwright.config.ts",
      "--project=Desktop Chrome",
      "desktop-interaction.benchmark.spec.ts",
    ],
  },
  {
    id: "desktop-streaming",
    description:
      "Measure live stream batching, reducer, React/Markdown, long tasks, frames, and feedback",
    command: npxCommand,
    args: [
      "--no-install",
      "cross-env",
      "E2E_DESKTOP_RUNTIME=1",
      "PASEO_DESKTOP_BENCHMARK=1",
      "playwright",
      "test",
      "--config",
      "packages/app/playwright.config.ts",
      "--project=Desktop Chrome",
      "desktop-streaming.benchmark.spec.ts",
    ],
  },
  {
    id: "desktop-markdown",
    description:
      "Measure representative live Markdown parsing, highlighting, React, DOM, AX, frames, and heap",
    command: npxCommand,
    args: [
      "--no-install",
      "cross-env",
      "E2E_DESKTOP_RUNTIME=1",
      "PASEO_DESKTOP_BENCHMARK=1",
      "PASEO_MARKDOWN_BENCHMARK=1",
      "playwright",
      "test",
      "--config",
      "packages/app/playwright.config.ts",
      "--project=Desktop Chrome",
      "desktop-streaming.benchmark.spec.ts",
    ],
  },
  {
    id: "draft-attachment-gc",
    description: "Measure history-scaled attachment GC work during ordinary draft typing",
    command: npxCommand,
    args: [
      "--no-install",
      "tsx",
      "--tsconfig",
      "packages/app/tsconfig.json",
      "packages/app/scripts/benchmark-draft-attachment-gc.ts",
    ],
  },
  {
    id: "desktop-css-interaction-audit",
    description: "Inventory Desktop-web hover/press behavior that depends on React or JS state",
    command: process.execPath,
    args: ["packages/app/scripts/audit-desktop-css-interactions.mjs"],
  },
  {
    id: "desktop-css-interactions",
    description:
      "Measure Desktop-web workspace-tab hover feedback, React commits, frames, DOM, and AX",
    command: npxCommand,
    args: [
      "--no-install",
      "cross-env",
      "E2E_DESKTOP_RUNTIME=1",
      "PASEO_DESKTOP_BENCHMARK=1",
      "playwright",
      "test",
      "--config",
      "packages/app/playwright.config.ts",
      "--project=Desktop Chrome",
      "desktop-css-interactions.benchmark.spec.ts",
    ],
  },
];
