/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  KittyNotificationAccumulator,
  buildKittyOsc99ActivationReport,
  buildKittyOsc99CloseReport,
  isKittyOsc99Done,
  parseKittyOsc99,
  parseOsc7,
  parseOsc9,
  parseOsc22,
} from "./terminal-kitty-protocols";

describe("parseKittyOsc99", () => {
  it("answers capability queries", () => {
    const result = parseKittyOsc99("i=probe:p=?;");
    expect(result.handled).toBe(true);
    expect(result.responses?.[0]).toContain("p=?");
    expect(result.responses?.[0]).toContain("a=report,focus");
  });

  it("parses a simple title notification", () => {
    const result = parseKittyOsc99(";Hello world");
    expect(result.notification).toMatchObject({
      id: "0",
      title: "Hello world",
      body: "",
      focus: true,
      report: false,
    });
    expect(isKittyOsc99Done(";Hello world")).toBe(true);
  });

  it("parses report/focus actions and body chunks", () => {
    const title = parseKittyOsc99("i=1:d=0:a=report,focus;Build done");
    expect(isKittyOsc99Done("i=1:d=0:a=report,focus;Build done")).toBe(false);
    expect(title.notification?.title).toBe("Build done");

    const body = parseKittyOsc99("i=1:p=body:a=report;All green");
    expect(body.notification?.body).toBe("All green");
    expect(body.notification?.report).toBe(true);
  });

  it("accumulates chunked title/body until done", () => {
    const acc = new KittyNotificationAccumulator();
    expect(
      acc.ingest(
        {
          id: "job",
          title: "Hello ",
          body: "",
          report: true,
          focus: true,
          reportClose: false,
          urgency: null,
          appName: null,
        },
        false,
      ),
    ).toBeNull();

    const complete = acc.ingest(
      {
        id: "job",
        title: "world",
        body: "body text",
        report: true,
        focus: false,
        reportClose: true,
        urgency: "critical",
        appName: null,
      },
      true,
    );
    expect(complete).toEqual({
      id: "job",
      title: "Hello world",
      body: "body text",
      report: true,
      focus: false,
      reportClose: true,
      urgency: "critical",
      appName: null,
    });
  });

  it("builds activation and close reports", () => {
    expect(buildKittyOsc99ActivationReport("job")).toBe("\x1b]99;i=job;\x1b\\");
    expect(buildKittyOsc99CloseReport("job")).toBe("\x1b]99;i=job:p=close;\x1b\\");
  });

  it("parses close payload type", () => {
    expect(parseKittyOsc99("i=job:p=close;").closeNotificationId).toBe("job");
  });
});

describe("parseOsc9", () => {
  it("parses legacy text notifications", () => {
    const result = parseOsc9("Hello from OSC 9");
    expect(result.notification?.title).toBe("Hello from OSC 9");
  });

  it("parses ConEmu progress states", () => {
    expect(parseOsc9("4;0").progress).toEqual({ kind: "hidden" });
    expect(parseOsc9("4;1;42").progress).toEqual({ kind: "normal", percent: 42 });
    expect(parseOsc9("4;2;80").progress).toEqual({ kind: "error", percent: 80 });
    expect(parseOsc9("4;3").progress).toEqual({ kind: "indeterminate" });
    expect(parseOsc9("4;4;10").progress).toEqual({ kind: "paused", percent: 10 });
  });
});

describe("parseOsc7", () => {
  it("parses file URLs and plain paths", () => {
    expect(parseOsc7("file:///Users/me/proj").cwd).toBe("/Users/me/proj");
    expect(parseOsc7("kitty-shell-cwd://host/tmp/work").cwd).toBe("/tmp/work");
    expect(parseOsc7("/var/log").cwd).toBe("/var/log");
  });
});

describe("parseOsc22", () => {
  it("accepts known cursor shapes and rejects unknown ones", () => {
    expect(parseOsc22("pointer").pointerShape).toBe("pointer");
    expect(parseOsc22("not-a-real-cursor").pointerShape).toBeNull();
    expect(parseOsc22("default").pointerShape).toBeNull();
  });
});
