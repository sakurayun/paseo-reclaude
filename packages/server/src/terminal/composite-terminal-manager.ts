import type { CaptureTerminalLinesResult } from "./terminal-capture.js";
import type {
  TerminalActivityListener,
  TerminalManager,
  TerminalsChangedListener,
  TerminalWorkspaceContributionChangedListener,
} from "./terminal-manager.js";
import type { TerminalActivityState } from "@getpaseo/protocol/terminal-activity";
import type {
  TerminalSession,
  TerminalStateSnapshot,
  TerminalStateSnapshotOptions,
} from "./terminal.js";

// Fork-owned wrapper that fronts the primary (worker-backed) terminal manager
// with a secondary in-process manager for SSH sessions. Reads and lifecycle
// calls route to whichever manager owns the terminal id; createTerminal always
// goes to primary (SSH terminals are created out-of-band by the SSH connect
// service, which calls the ssh manager directly). This keeps subscribe/kill/
// capture over the existing terminal RPCs working for SSH terminals with no
// transport changes.
export function createCompositeTerminalManager(
  primary: TerminalManager,
  ssh: TerminalManager,
): TerminalManager {
  function managerFor(id: string): TerminalManager | undefined {
    if (primary.getTerminal(id)) {
      return primary;
    }
    if (ssh.getTerminal(id)) {
      return ssh;
    }
    return undefined;
  }

  return {
    async getTerminals(cwd, options): Promise<TerminalSession[]> {
      const [primaryTerminals, sshTerminals] = await Promise.all([
        primary.getTerminals(cwd, options),
        ssh.getTerminals(cwd, options),
      ]);
      return [...primaryTerminals, ...sshTerminals];
    },

    createTerminal(options): Promise<TerminalSession> {
      return primary.createTerminal(options);
    },

    registerCwdEnv(options): void {
      primary.registerCwdEnv(options);
    },

    validateTerminalActivityToken(terminalId, token): "valid" | "unknown" | "invalid" {
      const primaryResult = primary.validateTerminalActivityToken(terminalId, token);
      if (primaryResult !== "unknown") {
        return primaryResult;
      }
      return ssh.validateTerminalActivityToken(terminalId, token);
    },

    getTerminal(id): TerminalSession | undefined {
      return primary.getTerminal(id) ?? ssh.getTerminal(id);
    },

    getTerminalState(
      id,
      options?: TerminalStateSnapshotOptions,
    ): Promise<TerminalStateSnapshot | null> {
      return (managerFor(id) ?? primary).getTerminalState(id, options);
    },

    setTerminalTitle(id, title): boolean {
      return (managerFor(id) ?? primary).setTerminalTitle(id, title);
    },

    setTerminalActivity(id, state: TerminalActivityState): Promise<boolean> {
      return (managerFor(id) ?? primary).setTerminalActivity(id, state);
    },

    clearTerminalAttention(id): Promise<boolean> {
      return (managerFor(id) ?? primary).clearTerminalAttention(id);
    },

    killTerminal(id): void {
      (managerFor(id) ?? primary).killTerminal(id);
    },

    killTerminalAndWait(id, options): Promise<void> {
      return (managerFor(id) ?? primary).killTerminalAndWait(id, options);
    },

    captureTerminal(id, options): Promise<CaptureTerminalLinesResult> {
      return (managerFor(id) ?? primary).captureTerminal(id, options);
    },

    listDirectories(): string[] {
      return [...new Set([...primary.listDirectories(), ...ssh.listDirectories()])];
    },

    killAll(): void {
      primary.killAll();
      ssh.killAll();
    },

    subscribeTerminalsChanged(listener: TerminalsChangedListener): () => void {
      const unsubscribePrimary = primary.subscribeTerminalsChanged(listener);
      const unsubscribeSsh = ssh.subscribeTerminalsChanged(listener);
      return () => {
        unsubscribePrimary();
        unsubscribeSsh();
      };
    },

    subscribeTerminalActivity(listener: TerminalActivityListener): () => void {
      const unsubscribePrimary = primary.subscribeTerminalActivity(listener);
      const unsubscribeSsh = ssh.subscribeTerminalActivity(listener);
      return () => {
        unsubscribePrimary();
        unsubscribeSsh();
      };
    },

    subscribeTerminalWorkspaceContributionChanged(
      listener: TerminalWorkspaceContributionChangedListener,
    ): () => void {
      const unsubscribePrimary = primary.subscribeTerminalWorkspaceContributionChanged(listener);
      const unsubscribeSsh = ssh.subscribeTerminalWorkspaceContributionChanged(listener);
      return () => {
        unsubscribePrimary();
        unsubscribeSsh();
      };
    },
  };
}
