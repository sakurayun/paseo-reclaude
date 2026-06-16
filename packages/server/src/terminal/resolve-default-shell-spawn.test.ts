import { describe, expect, it, vi } from "vitest";
import { resolveDefaultShellSpawn } from "./terminal.js";

function fakeResolver(available: Record<string, string>) {
  return async (name: string): Promise<string | null> => available[name] ?? null;
}

const WIN_ENV = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };

describe("resolveDefaultShellSpawn", () => {
  it("returns the login shell on non-Windows", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "linux",
      env: { SHELL: "/bin/zsh" },
    });
    expect(result).toEqual({ command: "/bin/zsh", args: [] });
  });

  it("honors an explicit shell override on non-Windows", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "darwin",
      shell: "/opt/homebrew/bin/fish",
      env: { SHELL: "/bin/zsh" },
    });
    expect(result).toEqual({ command: "/opt/homebrew/bin/fish", args: [] });
  });

  it("defaults to cmd.exe on Windows when no preference is set", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      resolveExecutable: fakeResolver({}),
    });
    expect(result).toEqual({ command: "C:\\Windows\\System32\\cmd.exe", args: [] });
  });

  it("prefers pwsh when preferPowerShell7 is set and pwsh is installed", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      windowsShell: { preferPowerShell7: true },
      resolveExecutable: fakeResolver({ pwsh: "C:\\pwsh\\pwsh.exe" }),
    });
    expect(result).toEqual({ command: "C:\\pwsh\\pwsh.exe", args: ["-NoLogo"] });
  });

  it("falls back to Windows PowerShell when pwsh is missing", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      windowsShell: { preferPowerShell7: true },
      resolveExecutable: fakeResolver({
        powershell: "C:\\WinPS\\powershell.exe",
      }),
    });
    expect(result).toEqual({ command: "C:\\WinPS\\powershell.exe", args: ["-NoLogo"] });
  });

  it("falls back to cmd.exe when neither PowerShell is installed", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      windowsShell: { preferPowerShell7: true },
      resolveExecutable: fakeResolver({}),
    });
    expect(result).toEqual({ command: "C:\\Windows\\System32\\cmd.exe", args: [] });
  });

  it("wraps the resolved shell in gsudo when runAsAdmin is set and gsudo exists", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      windowsShell: { preferPowerShell7: true, runAsAdmin: true },
      resolveExecutable: fakeResolver({
        pwsh: "C:\\pwsh\\pwsh.exe",
        gsudo: "C:\\gsudo\\gsudo.exe",
      }),
    });
    expect(result).toEqual({
      command: "C:\\gsudo\\gsudo.exe",
      args: ["C:\\pwsh\\pwsh.exe", "-NoLogo"],
    });
  });

  it("launches unelevated and warns when admin is requested but gsudo is missing", async () => {
    const onWarn = vi.fn();
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      windowsShell: { runAsAdmin: true },
      resolveExecutable: fakeResolver({}),
      onWarn,
    });
    expect(result).toEqual({ command: "C:\\Windows\\System32\\cmd.exe", args: [] });
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]?.[0]).toContain("gsudo");
  });

  it("ignores pwsh preference when an explicit shell is provided on Windows", async () => {
    const result = await resolveDefaultShellSpawn({
      platform: "win32",
      env: WIN_ENV,
      shell: "C:\\custom\\nu.exe",
      windowsShell: { preferPowerShell7: true },
      resolveExecutable: fakeResolver({ pwsh: "C:\\pwsh\\pwsh.exe" }),
    });
    expect(result).toEqual({ command: "C:\\custom\\nu.exe", args: [] });
  });
});
