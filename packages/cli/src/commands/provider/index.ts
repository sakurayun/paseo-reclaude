import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runModelsCommand } from "./models.js";
import { runFeaturesCommand } from "./features.js";
import { withOutput } from "../../output/index.js";
import { collectMultiple } from "../../utils/command-options.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";

export function createProviderCommand(): Command {
  const provider = new Command("provider").description("Manage agent providers");

  addJsonAndDaemonHostOptions(
    provider.command("ls").description("List available providers and status"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("models")
      .description("List models for a provider")
      .argument("<provider>", "Provider name (claude, codex, opencode)")
      .option("--thinking", "Include thinking option IDs for each model"),
  ).action(withOutput(runModelsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("features")
      .description("List configurable features for a provider/model")
      .argument("<provider>", "Provider name, or provider/model (e.g. claude or claude/opus)")
      .option("--model <model>", "Model to inspect")
      .option("--mode <mode>", "Mode to inspect")
      .option("--thinking <id>", "Thinking option ID to inspect")
      .option("--cwd <path>", "Working directory (default: current)")
      .option(
        "--feature <id[=value]>",
        "Set draft feature value(s) before listing (can be used multiple times)",
        collectMultiple,
        [],
      ),
  ).action(withOutput(runFeaturesCommand));

  return provider;
}
