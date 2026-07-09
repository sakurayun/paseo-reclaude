import { describe, expect, it } from "vitest";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { openSshHostForm, type SshHostFormSnapshot } from "./ssh-host-form-model";

function snapshot(overrides?: Partial<SshHostFormSnapshot>): SshHostFormSnapshot {
  return {
    mode: "create",
    groups: [],
    keys: [],
    chainCandidates: [],
    ...overrides,
  };
}

describe("openSshHostForm", () => {
  it("blocks submit until an address and valid port are present", () => {
    const model = openSshHostForm(snapshot());
    expect(model.getState().canSubmit).toBe(false);
    model.setAddress("10.0.0.1");
    expect(model.getState().canSubmit).toBe(true);
    model.setPort("70000");
    expect(model.getState().canSubmit).toBe(false);
    model.setPort("2222");
    expect(model.getState().canSubmit).toBe(true);
  });

  it("hides the password field and shows a notice when FIDO2 is enabled", () => {
    const model = openSshHostForm(snapshot());
    expect(model.getState().disclosure.showPasswordField).toBe(true);
    model.setUseFido2(true);
    expect(model.getState().disclosure.showPasswordField).toBe(false);
    expect(model.getState().disclosure.showFido2Notice).toBe(true);
  });

  it("reveals proxy fields and requires a proxy host once a type is chosen", () => {
    const model = openSshHostForm(snapshot());
    model.setAddress("10.0.0.1");
    model.setProxyType("socks5");
    expect(model.getState().disclosure.showProxyFields).toBe(true);
    expect(model.getState().canSubmit).toBe(false);
    model.setProxyHost("proxy.local");
    expect(model.getState().canSubmit).toBe(true);
  });

  it("only sends the password on create when it was entered", () => {
    const model = openSshHostForm(snapshot());
    model.setAddress("10.0.0.1");
    expect(model.buildSubmitPayload().password).toBeUndefined();
    model.setPassword("secret");
    expect(model.buildSubmitPayload().password).toBe("secret");
  });

  it("clears the password on edit when the field is emptied after editing", () => {
    const host: SshHostInfo = {
      id: "h1",
      label: "Box",
      address: "10.0.0.1",
      port: 22,
      hasPassword: true,
    };
    const model = openSshHostForm(snapshot({ mode: "edit", host }));
    // Untouched → password omitted (stored value preserved).
    expect(model.buildSubmitPayload().password).toBeUndefined();
    model.setPassword("");
    // Touched and emptied → explicit clear.
    expect(model.buildSubmitPayload().password).toBeNull();
    model.setPassword("new");
    expect(model.buildSubmitPayload().password).toBe("new");
  });

  it("seeds edit state from the host record including proxy and env", () => {
    const host: SshHostInfo = {
      id: "h1",
      label: "Box",
      address: "10.0.0.1",
      port: 2222,
      username: "root",
      tags: ["prod"],
      env: { FOO: "bar" },
      proxy: { proxyType: "http", host: "proxy.local", port: 8080 },
      charset: "gbk",
      mosh: { enabled: true },
    };
    const model = openSshHostForm(snapshot({ mode: "edit", host }));
    const state = model.getState();
    expect(state.port).toBe("2222");
    expect(state.username).toBe("root");
    expect(state.tags).toEqual(["prod"]);
    expect(state.env).toEqual([{ id: expect.any(String), key: "FOO", value: "bar" }]);
    expect(state.proxyType).toBe("http");
    expect(state.charset).toBe("gbk");
    expect(state.moshEnabled).toBe(true);
  });

  it("builds a submit payload with tags, env, and proxy", () => {
    const model = openSshHostForm(snapshot());
    model.setLabel("Box");
    model.setAddress("10.0.0.1");
    model.setPort("22");
    model.addTag("prod");
    model.addEnvVar();
    model.setEnvVar(0, { ...model.getState().env[0]!, key: "FOO", value: "bar" });
    model.setProxyType("socks5");
    model.setProxyHost("proxy.local");
    model.setProxyPort("1080");
    const payload = model.buildSubmitPayload();
    expect(payload.host.tags).toEqual(["prod"]);
    expect(payload.host.env).toEqual({ FOO: "bar" });
    expect(payload.host.proxy).toMatchObject({
      proxyType: "socks5",
      host: "proxy.local",
      port: 1080,
    });
  });

  it("dedupes tags and drops empty env keys", () => {
    const model = openSshHostForm(snapshot());
    model.setAddress("10.0.0.1");
    model.addTag("a");
    model.addTag("a");
    model.addEnvVar();
    model.setEnvVar(0, { ...model.getState().env[0]!, key: "  ", value: "ignored" });
    const payload = model.buildSubmitPayload();
    expect(payload.host.tags).toEqual(["a"]);
    expect(payload.host.env).toEqual({});
  });
});
