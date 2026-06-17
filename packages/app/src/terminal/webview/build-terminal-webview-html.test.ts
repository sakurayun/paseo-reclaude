import esbuild, { type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";

async function loadNodeBuiltinStubPlugin(): Promise<Plugin> {
  const scriptUrl = new URL("../../../scripts/build-terminal-webview-html.mjs", import.meta.url)
    .href;
  const buildScript = (await import(scriptUrl)) as {
    createNodeBuiltinStubPlugin: () => Plugin;
  };

  return buildScript.createNodeBuiltinStubPlugin();
}

describe("terminal webview build script", () => {
  it("stubs the diagnostics_channel exports used by xterm ligatures dependencies", async () => {
    const result = await esbuild.build({
      stdin: {
        contents: `
          import diagnosticsChannel, {
            channel,
            subscribe,
            tracingChannel,
            unsubscribe,
          } from "node:diagnostics_channel";

          const channelProbe = channel("paseo:test");
          const tracingProbe = tracingChannel("paseo:test");

          export const probes = {
            diagnosticsChannel,
            channelProbe,
            tracingProbe,
            subscribe,
            unsubscribe,
          };
        `,
        loader: "js",
        sourcefile: "diagnostics-channel-probe.js",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      plugins: [await loadNodeBuiltinStubPlugin()],
      logLevel: "silent",
    });

    expect(result.warnings).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
  });
});
