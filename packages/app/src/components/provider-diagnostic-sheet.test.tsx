/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 8: 32 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { xs: 11, sm: 13, code: 12 },
    fontFamily: { mono: "monospace" },
    fontWeight: { medium: "500" },
    borderRadius: { lg: 8, full: 999 },
    colors: {
      surface2: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      destructive: "#f00",
    },
  },
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => React.createElement("span", { "data-testid": "spinner" }),
  Pressable: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: object | ((value: typeof theme) => object)) =>
      typeof factory === "function" ? factory(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => {
  const Icon = () => React.createElement("span");
  return {
    AlertTriangle: Icon,
    Copy: Icon,
    FileText: Icon,
    Plus: Icon,
    RotateCw: Icon,
    SquareTerminal: Icon,
    Trash2: Icon,
  };
});

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => undefined) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    children,
    footer,
    testID,
    visible,
  }: {
    children?: React.ReactNode;
    footer?: React.ReactNode;
    testID?: string;
    visible: boolean;
  }) => (visible ? React.createElement("div", { "data-testid": testID }, children, footer) : null),
  AdaptiveTextInput: () => React.createElement("input"),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, children),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span"),
}));

vi.mock("@/components/ui/scrollable-code-surface", () => ({
  ScrollableCodeSurface: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("pre", null, children),
  SurfaceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ copied: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: { providers: {} }, patchConfig: vi.fn() }),
}));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: [
      {
        provider: "grok",
        status: "ready",
        enabled: true,
        label: "Grok",
        description: "Grok CLI",
        defaultModeId: null,
        modes: [],
        models: [{ provider: "grok", id: "grok-code-fast-1", label: "Grok Code Fast 1" }],
      },
    ],
    refresh: vi.fn(async () => undefined),
    isRefreshing: false,
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("@/styles/code-surface", () => ({ CODE_SURFACE_DATASET: {} }));
vi.mock("@/styles/settings", () => ({
  settingsStyles: { cardSurface: {}, sectionHeaderTitle: {} },
}));
vi.mock("@/utils/provider-definitions", () => ({ resolveProviderLabel: () => "Grok" }));
vi.mock("@/utils/time", () => ({ formatTimeAgo: () => "now" }));

import { ProviderDiagnosticSheet } from "./provider-diagnostic-sheet";

describe("ProviderDiagnosticSheet", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders models returned by the Grok CLI provider", () => {
    act(() => {
      root.render(
        <ProviderDiagnosticSheet provider="grok" serverId="server-1" visible onClose={vi.fn()} />,
      );
    });

    expect(container.textContent).toContain("Grok Code Fast 1");
  });
});
