import { describe, expect, it, vi } from "vitest";

import { handleTerminalReveal, type HandleTerminalRevealDeps } from "./handle-terminal-reveal";

function createDeps(): HandleTerminalRevealDeps {
  return {
    serverId: "server-1",
    registerSshTerminal: vi.fn(),
    navigateToTerminalTab: vi.fn(),
  };
}

describe("handleTerminalReveal", () => {
  it("registers SSH metadata and navigates for the focus recipient", () => {
    const deps = createDeps();

    handleTerminalReveal(
      {
        terminalId: "term-1",
        workspaceId: "ws-1",
        cwd: "/tmp/ssh-home",
        sshHostId: "host-1",
        sshHostLabel: "Prod Box",
        shouldFocus: true,
      },
      deps,
    );

    expect(deps.registerSshTerminal).toHaveBeenCalledWith("term-1", {
      hostId: "host-1",
      label: "Prod Box",
      serverId: "server-1",
    });
    expect(deps.navigateToTerminalTab).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      terminalId: "term-1",
    });
  });

  it("registers metadata without navigating when shouldFocus is false", () => {
    const deps = createDeps();

    handleTerminalReveal(
      {
        terminalId: "term-1",
        workspaceId: "ws-1",
        sshHostId: "host-1",
        shouldFocus: false,
      },
      deps,
    );

    expect(deps.registerSshTerminal).toHaveBeenCalledWith("term-1", {
      hostId: "host-1",
      label: "host-1",
      serverId: "server-1",
    });
    expect(deps.navigateToTerminalTab).not.toHaveBeenCalled();
  });

  it("does not navigate into synthetic or missing workspaces", () => {
    const deps = createDeps();

    handleTerminalReveal({ terminalId: "term-1", shouldFocus: true }, deps);
    handleTerminalReveal(
      { terminalId: "term-1", workspaceId: "ssh:host-1", shouldFocus: true },
      deps,
    );
    handleTerminalReveal(
      { terminalId: "term-1", workspaceId: "standalone:/tmp", shouldFocus: true },
      deps,
    );

    expect(deps.navigateToTerminalTab).not.toHaveBeenCalled();
  });

  it("skips SSH registration for local terminals", () => {
    const deps = createDeps();

    handleTerminalReveal({ terminalId: "term-1", workspaceId: "ws-1", shouldFocus: true }, deps);

    expect(deps.registerSshTerminal).not.toHaveBeenCalled();
    expect(deps.navigateToTerminalTab).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      terminalId: "term-1",
    });
  });
});
