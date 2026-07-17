import type { EditorTarget, EditorTargetLaunchInput, EditorTargetRuntime } from "../target.js";
import { isMacEditorInstalled, macElectronAppCommandCandidates } from "../mac-app-commands.js";

const MAC_APP_NAME = "Visual Studio Code - Insiders";

function commands(runtime: EditorTargetRuntime): string[] {
  const candidates = [
    "code-insiders",
    ...macElectronAppCommandCandidates(runtime, MAC_APP_NAME, "code"),
  ];
  if (runtime.platform === "win32") {
    if (runtime.env.LOCALAPPDATA) {
      candidates.push(
        `${runtime.env.LOCALAPPDATA}/Programs/Microsoft VS Code Insiders/bin/code-insiders.cmd`,
      );
    }
    if (runtime.env.ProgramFiles) {
      candidates.push(
        `${runtime.env.ProgramFiles}/Microsoft VS Code Insiders/bin/code-insiders.cmd`,
      );
    }
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

export const vscodeInsidersTarget: EditorTarget = {
  id: "vscode-insiders",
  async describe() {
    return {
      id: this.id,
      label: "VS Code Insiders",
      kind: "editor",
      icon: { kind: "symbol", name: "terminal" },
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
    throw new Error("VS Code Insiders is not installed");
  },
};
