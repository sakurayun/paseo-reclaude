import { describe, expect, it } from "vitest";
import { classifySshConnectError, shouldTrySystemSshFallback } from "./ssh-connect-error.js";

describe("classifySshConnectError", () => {
  it("classifies pre-handshake disconnects with VPN/TUN hints", () => {
    const classified = classifySshConnectError(new Error("Connection lost before handshake"));
    expect(classified.kind).toBe("handshake");
    expect(classified.hints.some((hint) => /VPN|TUN|198\.18/i.test(hint))).toBe(true);
    expect(shouldTrySystemSshFallback(classified.kind)).toBe(true);
  });

  it("classifies auth failures", () => {
    const error = Object.assign(new Error("All configured authentication methods failed"), {
      level: "client-authentication",
    });
    const classified = classifySshConnectError(error);
    expect(classified.kind).toBe("auth");
    expect(shouldTrySystemSshFallback(classified.kind)).toBe(false);
  });

  it("classifies connection refused", () => {
    const classified = classifySshConnectError(new Error("connect ECONNREFUSED 1.2.3.4:22"));
    expect(classified.kind).toBe("refused");
  });
});
