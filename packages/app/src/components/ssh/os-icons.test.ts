import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjustBrandColorForBadge,
  getBuiltInOsIcon,
  getOsIcon,
  normalizeOsId,
  toSimpleIconsSlug,
} from "@/components/ssh/os-icons";
import {
  __resetRemoteOsIconCacheForTests,
  loadRemoteOsIcon,
  parseSimpleIconsSvg,
  peekRemoteOsIcon,
} from "@/components/ssh/remote-os-icons";

describe("built-in OS icons", () => {
  it("resolves common os-release IDs offline with path data", () => {
    const ubuntu = getBuiltInOsIcon("ubuntu");
    expect(ubuntu?.source).toBe("builtin");
    expect(ubuntu?.path.length).toBeGreaterThan(20);
    expect(ubuntu?.color).toBe("#E95420");
    expect(ubuntu?.label).toBe("Ubuntu");
  });

  it("normalizes case and aliases", () => {
    expect(getBuiltInOsIcon("Ubuntu")?.label).toBe("Ubuntu");
    expect(getBuiltInOsIcon("rhel")?.label).toBe("Red Hat");
    expect(getBuiltInOsIcon("pop_os")?.label).toBe("Pop!_OS");
    expect(getBuiltInOsIcon("darwin")?.label).toBe("macOS");
    expect(getBuiltInOsIcon("opensuse-tumbleweed")?.label).toBe("openSUSE");
  });

  it("returns null for unknown IDs (caller may fetch remote)", () => {
    expect(getBuiltInOsIcon("endeavouros")).toBeNull();
    expect(getBuiltInOsIcon(null)).toBeNull();
    expect(getBuiltInOsIcon(undefined)).toBeNull();
  });

  it("getOsIcon falls back for unknown platforms", () => {
    const fallback = getOsIcon("some-weird-distro");
    expect(fallback.source).toBe("fallback");
    expect(fallback.path).toBe("");
    expect(fallback.color).toBe("#6B7280");
  });
});

describe("Simple Icons slug mapping", () => {
  it("maps aliases to CDN slugs", () => {
    expect(toSimpleIconsSlug("arch")).toBe("archlinux");
    expect(toSimpleIconsSlug("pop_os")).toBe("popos");
    expect(toSimpleIconsSlug("endeavouros")).toBe("endeavouros");
    expect(toSimpleIconsSlug("OpenBSD")).toBe("openbsd");
  });

  it("normalizeOsId strips spaces", () => {
    expect(normalizeOsId("  Pop OS  ")).toBe("popos");
  });
});

describe("brand color contrast", () => {
  it("lifts near-black brands for white glyphs", () => {
    expect(adjustBrandColorForBadge("#000000")).toBe("#555555");
    expect(adjustBrandColorForBadge("#000")).toBe("#555555");
  });

  it("darkens very light brands", () => {
    const darkened = adjustBrandColorForBadge("#FCC624");
    expect(darkened).not.toBe("#FCC624");
    expect(darkened.startsWith("#")).toBe(true);
  });

  it("keeps mid-tone brand colors", () => {
    expect(adjustBrandColorForBadge("#E95420").toLowerCase()).toBe("#e95420");
  });
});

describe("parseSimpleIconsSvg", () => {
  it("extracts path, fill, and title from CDN SVG", () => {
    const svg = `<svg fill="#48B9C7" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Pop!_OS</title><path d="M12 0C5.372 0 0 5.373 0 12z"/></svg>`;
    const glyph = parseSimpleIconsSvg(svg, "popos");
    expect(glyph?.path).toBe("M12 0C5.372 0 0 5.373 0 12z");
    expect(glyph?.label).toBe("Pop!_OS");
    expect(glyph?.color.toLowerCase()).toBe("#48b9c7");
  });

  it("returns null when path is missing", () => {
    expect(parseSimpleIconsSvg("<svg></svg>", "x")).toBeNull();
  });
});

describe("loadRemoteOsIcon", () => {
  afterEach(() => {
    __resetRemoteOsIconCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches CDN SVG, caches glyph, and reuses memory", async () => {
    const svg = `<svg fill="#7F7FFF" role="img" viewBox="0 0 24 24"><title>EndeavourOS</title><path d="M1 2 3 4z"/></svg>`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => svg,
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadRemoteOsIcon("endeavouros");
    expect(first?.path).toBe("M1 2 3 4z");
    expect(first?.label).toBe("EndeavourOS");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await loadRemoteOsIcon("endeavouros");
    expect(second?.path).toBe("M1 2 3 4z");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekRemoteOsIcon("endeavouros")?.path).toBe("M1 2 3 4z");
  });

  it("caches 404 as missing so we do not thrash the CDN", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = "definitely-not-a-real-icon-xyz";
    expect(await loadRemoteOsIcon(id)).toBeNull();
    expect(await loadRemoteOsIcon(id)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekRemoteOsIcon(toSimpleIconsSlug(id))).toBeNull();
  });
});
