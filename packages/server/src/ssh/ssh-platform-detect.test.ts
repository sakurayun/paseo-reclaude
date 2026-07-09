import { describe, expect, it } from "vitest";

import type { SshConnection, SshExecResult } from "./ssh-connection.js";
import { detectRemotePlatform } from "./ssh-platform-detect.js";

function fakeConnection(result: SshExecResult | Error): SshConnection {
  return {
    exec: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  } as unknown as SshConnection;
}

describe("detectRemotePlatform", () => {
  it("parses os-release into os/name/version", async () => {
    const platform = await detectRemotePlatform(
      fakeConnection({
        stdout: [
          'PRETTY_NAME="Ubuntu 22.04.3 LTS"',
          'NAME="Ubuntu"',
          "ID=ubuntu",
          'VERSION_ID="22.04"',
        ].join("\n"),
        stderr: "",
        code: 0,
      }),
    );
    expect(platform.os).toBe("ubuntu");
    expect(platform.name).toBe("Ubuntu 22.04.3 LTS");
    expect(platform.version).toBe("22.04");
  });

  it("falls back to darwin from uname", async () => {
    const platform = await detectRemotePlatform(
      fakeConnection({ stdout: "Darwin\n", stderr: "", code: 0 }),
    );
    expect(platform.os).toBe("darwin");
    expect(platform.name).toBe("macOS");
  });

  it("returns unknown when the probe fails", async () => {
    const platform = await detectRemotePlatform(fakeConnection(new Error("channel closed")));
    expect(platform.os).toBe("unknown");
  });

  it("returns unknown when output is empty", async () => {
    const platform = await detectRemotePlatform(
      fakeConnection({ stdout: "  \n", stderr: "", code: 0 }),
    );
    expect(platform.os).toBe("unknown");
  });
});
