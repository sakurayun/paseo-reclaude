import type { EditorTarget, EditorTargetLaunchInput, EditorTargetRuntime } from "../target.js";
import { isMacEditorInstalled } from "../mac-app-commands.js";

const MAC_APP_NAME = "Antigravity";

function commands(runtime: EditorTargetRuntime): string[] {
  const candidates = ["agy", "antigravity"];
  const home = runtime.homeDirectory || runtime.env.HOME || "";
  if (home) {
    candidates.push(
      `${home}/.antigravity/antigravity/bin/agy`,
      `${home}/.antigravity/antigravity/bin/antigravity`,
    );
  }
  if (runtime.platform === "darwin") {
    candidates.push(
      `/Applications/${MAC_APP_NAME}.app/Contents/MacOS/${MAC_APP_NAME}`,
      ...(home ? [`${home}/Applications/${MAC_APP_NAME}.app/Contents/MacOS/${MAC_APP_NAME}`] : []),
    );
  }
  return candidates;
}

function location(input: EditorTargetLaunchInput): string {
  if (!input.line) return input.filePath!;
  return input.column
    ? `${input.filePath}:${input.line}:${input.column}`
    : `${input.filePath}:${input.line}`;
}

function launchArgs(input: EditorTargetLaunchInput): string[] {
  if (!input.filePath) return [input.workspacePath];
  if (!input.line) return [input.workspacePath, input.filePath];
  return [input.workspacePath, "--goto", location(input)];
}

export const antigravityTarget: EditorTarget = {
  id: "antigravity",
  async describe(runtime) {
    return {
      id: this.id,
      label: "Antigravity",
      kind: "editor",
      icon: await runtime.loadIcon("antigravity.png"),
    };
  },
  async isInstalled(runtime) {
    return isMacEditorInstalled(runtime, {
      commands: commands(runtime),
      applicationNames: [MAC_APP_NAME],
    });
  },
  async launch(input, runtime) {
    const command = runtime.resolveCommand(commands(runtime));
    if (command) {
      await runtime.spawnDetached({ command, args: launchArgs(input) });
      return;
    }
    if (runtime.hasMacApplication(MAC_APP_NAME)) {
      await runtime.openMacApplication({
        applicationName: MAC_APP_NAME,
        paths: input.filePath ? [input.workspacePath, input.filePath] : [input.workspacePath],
      });
      return;
    }
    throw new Error("Antigravity is not installed");
  },
};
