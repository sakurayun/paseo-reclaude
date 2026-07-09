import { describe, expect, it } from "vitest";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { buildFallbackSshArgv } from "./ssh-fallback.js";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";

function deps(hosts: Record<string, SshHostInfo> = {}) {
  return {
    hostStore: {
      getHost: (id: string) => hosts[id],
    } as unknown as SshHostStore,
    keyStore: {
      getMaterial: () => undefined,
    } as unknown as SshKeyStore,
    sshHome: "/tmp/paseo-ssh-test",
  };
}

function host(overrides: Partial<SshHostInfo>): SshHostInfo {
  return { id: "h1", label: "Box", address: "10.0.0.1", ...overrides };
}

describe("buildFallbackSshArgv", () => {
  it("builds a plain ssh argv with user@host", () => {
    const result = buildFallbackSshArgv(host({ username: "root" }), deps());
    expect(result.command).toBe("ssh");
    expect(result.args).toEqual(["root@10.0.0.1"]);
  });

  it("adds -p only for a non-default port", () => {
    expect(buildFallbackSshArgv(host({ port: 22 }), deps()).args).toEqual(["10.0.0.1"]);
    expect(buildFallbackSshArgv(host({ port: 2222 }), deps()).args).toEqual([
      "-p",
      "2222",
      "10.0.0.1",
    ]);
  });

  it("renders SetEnv and agent forwarding options", () => {
    const result = buildFallbackSshArgv(
      host({ env: { FOO: "bar" }, agentForwarding: true }),
      deps(),
    );
    expect(result.args).toContain("-o");
    expect(result.args).toContain("SetEnv=FOO=bar");
    expect(result.args).toContain("-A");
  });

  it("builds a ProxyJump spec from chained hosts", () => {
    const jump = host({ id: "jump", address: "jump.local", username: "j", port: 2200 });
    const result = buildFallbackSshArgv(
      host({ chainHostIds: ["jump"], username: "root" }),
      deps({ jump }),
    );
    expect(result.args).toContain("-J");
    expect(result.args).toContain("j@jump.local:2200");
  });

  it("wraps ssh in mosh --ssh when Mosh is enabled", () => {
    const result = buildFallbackSshArgv(
      host({ username: "root", port: 2222, mosh: { enabled: true } }),
      deps(),
    );
    expect(result.command).toBe("mosh");
    expect(result.args[0]).toBe("--ssh=ssh -p 2222");
    expect(result.args.at(-1)).toBe("root@10.0.0.1");
  });
});
