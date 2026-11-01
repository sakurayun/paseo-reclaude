import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  it("writes the selected key before returning and removes it on cleanup", async () => {
    const sshHome = await mkdtemp(path.join(tmpdir(), "paseo-fallback-key-"));
    try {
      const dependencies = deps();
      dependencies.sshHome = sshHome;
      dependencies.keyStore = {
        getMaterial: () => ({ privateKey: "selected-key" }),
      } as unknown as SshKeyStore;
      const command = await buildFallbackSshArgv(host({ keyId: "key" }), dependencies);
      const keyPath = command.args[command.args.indexOf("-i") + 1];
      expect(await readFile(keyPath, "utf8")).toBe("selected-key");
      await command.cleanup();
      await expect(stat(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(sshHome, { recursive: true, force: true });
    }
  });

  it("builds a plain ssh argv with user@host", async () => {
    const result = await buildFallbackSshArgv(host({ username: "root" }), deps());
    expect(result.command).toBe("ssh");
    // Default host config does not use the agent — pin IdentityAgent=none so
    // ambient keys are not offered unexpectedly.
    expect(result.args).toEqual(["-o", "IdentityAgent=none", "root@10.0.0.1"]);
  });

  it("adds -p only for a non-default port", async () => {
    expect((await buildFallbackSshArgv(host({ port: 22 }), deps())).args).toEqual([
      "-o",
      "IdentityAgent=none",
      "10.0.0.1",
    ]);
    expect((await buildFallbackSshArgv(host({ port: 2222 }), deps())).args).toEqual([
      "-p",
      "2222",
      "-o",
      "IdentityAgent=none",
      "10.0.0.1",
    ]);
  });

  it("renders SetEnv and agent forwarding options", async () => {
    const result = await buildFallbackSshArgv(
      host({ env: { FOO: "bar" }, agentForwarding: true }),
      deps(),
    );
    expect(result.args).toContain("-o");
    expect(result.args).toContain("SetEnv=FOO=bar");
    expect(result.args).toContain("-A");
    // Forwarding alone must not force IdentityAgent=none (agent is required for -A).
    expect(result.args).not.toContain("IdentityAgent=none");
  });

  it("disables the ambient agent when neither useAgent nor forwarding is set", async () => {
    const result = await buildFallbackSshArgv(host({ useAgent: false }), deps());
    expect(result.args).toContain("IdentityAgent=none");
    expect(result.args).not.toContain("-A");
  });

  it("keeps the ambient agent when useAgent is set", async () => {
    const result = await buildFallbackSshArgv(host({ useAgent: true }), deps());
    expect(result.args).not.toContain("IdentityAgent=none");
  });

  it("builds a ProxyJump spec from chained hosts", async () => {
    const jump = host({ id: "jump", address: "jump.local", username: "j", port: 2200 });
    const result = await buildFallbackSshArgv(
      host({ chainHostIds: ["jump"], username: "root" }),
      deps({ jump }),
    );
    expect(result.args).toContain("-J");
    expect(result.args).toContain("j@jump.local:2200");
  });

  it("wraps ssh in mosh --ssh when Mosh is enabled", async () => {
    const result = await buildFallbackSshArgv(
      host({ username: "root", port: 2222, mosh: { enabled: true } }),
      deps(),
    );
    expect(result.command).toBe("mosh");
    expect(result.args[0]).toBe("--ssh=ssh -p 2222 -o IdentityAgent=none");
    expect(result.args.at(-1)).toBe("root@10.0.0.1");
  });
});
