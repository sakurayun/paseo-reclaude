import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isCodexChatgptAuth,
  isOfficialAiHost,
  normalizeGatewayBaseUrl,
  resolveClaudeGatewayAuth,
  resolveCodexGatewayAuth,
} from "./resolve-auth.js";

describe("normalizeGatewayBaseUrl", () => {
  it("rejects official hosts", () => {
    expect(normalizeGatewayBaseUrl("https://api.anthropic.com")).toBeNull();
    expect(normalizeGatewayBaseUrl("https://api.openai.com/v1")).toBeNull();
  });

  it("keeps custom hosts and strips trailing slash", () => {
    expect(normalizeGatewayBaseUrl("https://relay.example.com/v1/")).toBe(
      "https://relay.example.com/v1",
    );
  });
});

describe("isOfficialAiHost", () => {
  it("recognizes first-party hosts", () => {
    expect(isOfficialAiHost("api.anthropic.com")).toBe(true);
    expect(isOfficialAiHost("api.openai.com")).toBe(true);
    expect(isOfficialAiHost("relay.example.com")).toBe(false);
  });
});

describe("resolveClaudeGatewayAuth", () => {
  it("reads base URL + key from settings.json env", async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-gateway-"));
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://newapi.example.com",
          ANTHROPIC_API_KEY: "sk-claude",
        },
      }),
    );

    const auth = await resolveClaudeGatewayAuth({
      claudeHome: home,
      env: {},
    });

    expect(auth).toEqual({
      baseUrl: "https://newapi.example.com",
      apiKey: "sk-claude",
      source: "claude-settings",
    });
  });

  it("prefers paseo provider env over settings", async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-gateway-"));
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://settings.example.com",
          ANTHROPIC_API_KEY: "sk-settings",
        },
      }),
    );

    const auth = await resolveClaudeGatewayAuth({
      claudeHome: home,
      env: {},
      providerEnv: {
        ANTHROPIC_BASE_URL: "https://paseo.example.com/v1",
        ANTHROPIC_API_KEY: "sk-paseo",
      },
    });

    expect(auth?.baseUrl).toBe("https://paseo.example.com/v1");
    expect(auth?.apiKey).toBe("sk-paseo");
    expect(auth?.source).toBe("paseo-provider-env");
  });

  it("returns null for official Anthropic base URL", async () => {
    const auth = await resolveClaudeGatewayAuth({
      claudeHome: mkdtempSync(join(tmpdir(), "claude-gateway-")),
      env: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_API_KEY: "sk-official",
      },
    });
    expect(auth).toBeNull();
  });
});

describe("resolveCodexGatewayAuth", () => {
  it("combines config.toml base_url with auth.json key", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-gateway-"));
    writeFileSync(join(home, "config.toml"), 'base_url = "https://api.hlool.top/v1"\n');
    writeFileSync(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-hlo" }));

    const auth = await resolveCodexGatewayAuth({
      codexHome: home,
      env: {},
    });

    expect(auth).toEqual({
      baseUrl: "https://api.hlool.top/v1",
      apiKey: "sk-hlo",
      source: "codex-config",
    });
  });

  it("reads base_url from the active model_providers section", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-gateway-"));
    writeFileSync(
      join(home, "config.toml"),
      [
        'model_provider = "custom"',
        "",
        "[model_providers.custom]",
        'name = "custom"',
        'wire_api = "responses"',
        'base_url = "https://api.hlool.top/v1"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-hlo" }));

    const auth = await resolveCodexGatewayAuth({
      codexHome: home,
      env: {},
    });

    expect(auth?.baseUrl).toBe("https://api.hlool.top/v1");
    expect(auth?.apiKey).toBe("sk-hlo");
  });

  it("returns null when only key is present without base URL", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-gateway-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-only" }));

    const auth = await resolveCodexGatewayAuth({
      codexHome: home,
      env: {},
    });
    expect(auth).toBeNull();
  });
});

describe("isCodexChatgptAuth", () => {
  it("is false for API-key-only auth.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-auth-"));
    writeFileSync(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-only" }));
    expect(await isCodexChatgptAuth(home)).toBe(false);
  });

  it("is true when ChatGPT tokens are present", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-auth-"));
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: "at", refresh_token: "rt" } }),
    );
    expect(await isCodexChatgptAuth(home)).toBe(true);
  });
});
