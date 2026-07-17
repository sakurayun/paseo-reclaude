import type { EditorTargetRuntime } from "./target.js";

/**
 * Absolute launcher paths for a macOS .app that ships a CLI under
 * Contents/Resources/app/bin (Electron/VS Code family).
 */
export function macElectronAppCommandCandidates(
  runtime: EditorTargetRuntime,
  applicationName: string,
  binaryName: string,
): string[] {
  if (runtime.platform !== "darwin") return [];
  const home = runtime.homeDirectory || runtime.env.HOME || "";
  const candidates = [
    `/Applications/${applicationName}.app/Contents/Resources/app/bin/${binaryName}`,
  ];
  if (home) {
    candidates.push(
      `${home}/Applications/${applicationName}.app/Contents/Resources/app/bin/${binaryName}`,
    );
  }
  return candidates;
}

export function isMacEditorInstalled(
  runtime: EditorTargetRuntime,
  input: {
    commands: readonly string[];
    applicationNames?: readonly string[];
  },
): boolean {
  if (runtime.resolveCommand(input.commands) !== null) {
    return true;
  }
  if (runtime.platform !== "darwin") {
    return false;
  }
  return (input.applicationNames ?? []).some((name) => runtime.hasMacApplication(name));
}
