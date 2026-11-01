import { describe, expect, it } from "vitest";
import { getCanonicalRedirect } from "./canonical-url";

describe("getCanonicalRedirect", () => {
  it("does not redirect development requests addressed through the local network", () => {
    const url = new URL("http://192.168.1.71:8082/inspector/device");

    expect(getCanonicalRedirect(url, "development")).toBeNull();
  });

  it("redirects production requests to the canonical origin", () => {
    const url = new URL("http://www.paseo.sh/download");

    expect(getCanonicalRedirect(url, "production")).toBe("https://paseo.vup.im/download");
  });

  it("keeps the fork origin without a redirect loop", () => {
    expect(getCanonicalRedirect(new URL("https://paseo.vup.im/download"), "production")).toBeNull();
  });
});
