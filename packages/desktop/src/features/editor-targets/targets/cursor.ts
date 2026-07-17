import type { EditorTarget, EditorTargetLaunchInput, EditorTargetRuntime } from "../target.js";
import { isMacEditorInstalled, macElectronAppCommandCandidates } from "../mac-app-commands.js";

const MAC_APP_NAME = "Cursor";

function commands(runtime: EditorTargetRuntime): string[] {
  const candidates = [
    "cursor",
    ...macElectronAppCommandCandidates(runtime, MAC_APP_NAME, "cursor"),
  ];
  if (runtime.platform === "win32") {
    if (runtime.env.LOCALAPPDATA) {
      candidates.push(`${runtime.env.LOCALAPPDATA}/Programs/cursor/resources/app/bin/cursor.cmd`);
      candidates.push(`${runtime.env.LOCALAPPDATA}/Programs/cursor/Cursor.exe`);
    }
    if (runtime.env.ProgramFiles) {
      candidates.push(`${runtime.env.ProgramFiles}/Cursor/resources/app/bin/cursor.cmd`);
      candidates.push(`${runtime.env.ProgramFiles}/Cursor/Cursor.exe`);
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

export const cursorTarget: EditorTarget = {
  id: "cursor",
  async describe(runtime) {
    return {
      id: this.id,
      label: "Cursor",
      kind: "editor",
      icon: await runtime.loadIcon("cursor.png"),
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
    throw new Error("Cursor is not installed");
  },
};
