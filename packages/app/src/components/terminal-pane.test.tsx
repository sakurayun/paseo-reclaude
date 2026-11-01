/**
 * @vitest-environment jsdom
 */
import React, { act, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ toast: vi.fn(), showToast: vi.fn() }),
}));
vi.mock("@/plugins/registry", () => ({
  pluginRegistry: { getSnapshot: () => [], subscribe: () => () => {} },
}));
import { TerminalPane } from "@/components/terminal-pane";
import type { TerminalEmulatorHandle } from "@/components/terminal-emulator";
import {
  PaneFocusProvider,
  PaneProvider,
  createPaneFocusContextValue,
  type PaneContextValue,
} from "@/panels/pane-context";
interface FindResultChange {
  resultIndex: number;
  resultCount: number;
}

interface TerminalKeyInput {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

interface MockTerminalEmulatorProps {
  testId?: string;
  streamKey: string;
  onRendererReadyChange?: (change: { streamKey: string; isReady: boolean }) => void;
  onFindResult?: (result: FindResultChange & { limited: boolean; placement: "top" }) => void;
  onTerminalKey?: (input: TerminalKeyInput) => Promise<void> | void;
}

const { client, terminalProps, theme, terminalHandle, resetTerminalHandle } = vi.hoisted(() => {
  const handle = {
    replay: vi.fn(),
    paste: vi.fn(),
    copySelection: vi.fn(),
    claimSize: vi.fn(() => () => {}),
    showKeyboard: vi.fn(),
    writeOutput: vi.fn(),
    restoreOutput: vi.fn(),
    renderSnapshot: vi.fn(),
    clear: vi.fn(),
    blur: vi.fn(),
    find: { search: vi.fn(), clear: vi.fn(), setWidgetSize: vi.fn() },
  };
  return {
    client: {
      on: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn(),
    },
    terminalProps: {
      current: null as null | MockTerminalEmulatorProps,
    },
    terminalHandle: handle,
    resetTerminalHandle: () => {
      handle.writeOutput.mockClear();
      handle.renderSnapshot.mockClear();
      handle.clear.mockClear();
      handle.find.search.mockClear();
      handle.find.clear.mockClear();
      handle.find.setWidgetSize.mockClear();
    },
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
      fontSize: { xs: 11, sm: 13 },
      fontWeight: { medium: "500" as const },
      borderRadius: { md: 6 },
      colors: {
        background: "#000",
        border: "#333",
        destructive: "#f43f5e",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        primary: "#0a84ff",
        surface0: "#111",
        surface1: "#222",
        surface2: "#333",
        terminal: {
          background: "#000",
          foreground: "#fff",
          cursor: "#fff",
          cursorAccent: "#000",
          selectionBackground: "#444",
          selectionForeground: "#fff",
          black: "#000",
          red: "#f00",
          green: "#0f0",
          yellow: "#ff0",
          blue: "#00f",
          magenta: "#f0f",
          cyan: "#0ff",
          white: "#fff",
          brightBlack: "#555",
          brightRed: "#f55",
          brightGreen: "#5f5",
          brightYellow: "#ff5",
          brightBlue: "#55f",
          brightMagenta: "#f5f",
          brightCyan: "#5ff",
          brightWhite: "#fff",
        },
      },
    },
  };
});

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const MockView = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children);
  const MockText = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children);
  const MockPressable = ({
    children,
    disabled,
    accessibilityLabel,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    accessibilityLabel?: string;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        disabled,
        onClick: () => {
          if (!disabled) {
            onPress?.();
          }
        },
        type: "button",
      },
      children,
    );
  const MockTextInput = React.forwardRef<
    HTMLInputElement,
    {
      value?: string;
      onChangeText?: (text: string) => void;
      onKeyPress?: (event: {
        nativeEvent: { key: string; shiftKey?: boolean };
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
      testID?: string;
      placeholder?: string;
    }
  >(function TextInput({ value, onChangeText, onKeyPress, testID, placeholder }, ref) {
    return React.createElement("input", {
      "data-testid": testID,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onChangeText?.(event.currentTarget.value),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) =>
        onKeyPress?.({
          nativeEvent: { key: event.key, shiftKey: event.shiftKey },
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
        }),
      placeholder,
      ref,
      value,
    });
  });

  return {
    ...actual,
    ActivityIndicator: () => React.createElement("span", { "data-testid": "activity" }),
    Platform: {
      OS: "web",
      select: (options: Record<string, unknown>) => options.web ?? options.default,
    },
    Pressable: MockPressable,
    ScrollView: MockView,
    Text: MockText,
    TextInput: MockTextInput,
    View: MockView,
  };
});

vi.mock("react-native-reanimated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-reanimated")>()),
  default: {
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
  },
  runOnJS: (fn: () => void) => fn,
  useAnimatedReaction: vi.fn(),
}));

vi.mock("react-native-unistyles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-unistyles")>();
  const baseTheme = actual.useUnistyles().theme;
  const mergedTheme = {
    ...baseTheme,
    ...theme,
    colors: { ...baseTheme.colors, ...theme.colors, palette: { ...baseTheme.colors.palette } },
  };
  return {
    withUnistyles: (component: unknown) => component,
    StyleSheet: {
      absoluteFillObject: {},
      hairlineWidth: 1,
      create: (factory: unknown) =>
        Object.prototype.toString.call(factory) === "[object Function]"
          ? (factory as (value: unknown) => unknown)(mergedTheme)
          : factory,
    },
    useUnistyles: () => ({ theme: mergedTheme, rt: { breakpoint: "md" } }),
  };
});

vi.mock("lucide-react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react-native")>();
  const createIcon = (name: string) =>
    function Icon() {
      return React.createElement("span", { "data-icon": name });
    };
  return {
    ...actual,
    Maximize: createIcon("Maximize"),
    ArrowDown: createIcon("ArrowDown"),
    ChevronDown: createIcon("ChevronDown"),
    ChevronUp: createIcon("ChevronUp"),
    X: createIcon("X"),
  };
});

vi.mock("@/ssh/upload/use-ssh-terminal-file-drop", () => ({
  useSshTerminalFileDrop: () => ({ onFileDrop: undefined, sheet: null }),
}));

vi.mock("@/mobile-panels/provider", () => ({ useBlockMobilePanelOpenGestures: () => {} }));

vi.mock("@/hooks/use-is-local-daemon", () => ({ useIsLocalDaemon: () => true }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => client,
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/hooks/use-app-visible", () => ({
  useAppActivelyVisible: () => true,
  useAppVisible: () => true,
}));

vi.mock("@/keyboard/shift", () => ({
  useKeyboardShiftStyle: () => ({
    shift: { value: 0 },
    style: null,
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: {
      terminalScrollbackLines: 1000,
      monoFontFamily: "",
      terminalLigaturesEnabled: true,
      terminalPaddingTop: 0,
      terminalPaddingBottom: 0,
      terminalPaddingLeft: 0,
      terminalPaddingRight: 0,
    },
  }),
}));

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (
    selector: (state: {
      mobilePanel: { target: string };
      showMobileAgentList: () => void;
    }) => unknown,
  ) => selector({ mobilePanel: { target: "agent" }, showMobileAgentList: vi.fn() }),
}));

vi.mock("@/terminal/runtime/workspace-terminal-session", () => ({
  getWorkspaceTerminalSession: () => ({
    snapshots: {
      clear: vi.fn(),
      get: vi.fn(() => null),
      set: vi.fn(),
    },
  }),
}));

vi.mock("@/terminal/runtime/terminal-stream-controller", () => ({
  TerminalStreamController: class {
    dispose() {}
    setTerminal() {}
  },
}));

vi.mock("@/components/terminal-emulator", () => ({
  default: React.forwardRef<TerminalEmulatorHandle, MockTerminalEmulatorProps>(
    function TerminalEmulator(props, ref) {
      terminalProps.current = props;
      useImperativeHandle(ref, () => terminalHandle as unknown as TerminalEmulatorHandle);
      return React.createElement("div", {
        "data-testid": props.testId ?? "terminal-surface",
      });
    },
  ),
}));

const paneInstanceId = "server-a:workspace-a:left";
const paneContext: PaneContextValue = {
  host: "main",
  openPreferredTarget: vi.fn(),
  setCurrentTabState: vi.fn(),
  serverId: "server-a",
  workspaceId: "workspace-a",
  paneInstanceId,
  tabId: "terminal",
  target: { kind: "terminal", terminalId: "terminal-a" },
  openTab: () => {},
  closeCurrentTab: () => {},
  retargetCurrentTab: () => {},
  openFileInWorkspace: () => {},
  openImportSheet: () => {},
};
const paneFocus = createPaneFocusContextValue({
  isPaneFocused: true,
  isWorkspaceFocused: true,
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetTerminalHandle();
  client.sendTerminalInput.mockClear();
  client.on.mockClear();
  terminalProps.current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

function renderTerminalPane(): void {
  act(() => {
    root?.render(
      <PaneProvider value={paneContext}>
        <PaneFocusProvider value={paneFocus}>
          <TerminalPane
            serverId="server-a"
            cwd="/repo"
            terminalId="terminal-a"
            isWorkspaceFocused
            isPaneFocused
            onOpenFileExplorer={vi.fn()}
            onOpenWorkspaceFile={vi.fn()}
          />
        </PaneFocusProvider>
      </PaneProvider>,
    );
  });
  act(() => {
    const props = terminalProps.current;
    if (props) props.onRendererReadyChange?.({ streamKey: props.streamKey, isReady: true });
  });
}

function inputElement(): HTMLInputElement {
  const input = container?.querySelector("input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function changeInput(value: string): void {
  const input = inputElement();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function pressFindKey(key: string, shiftKey = false): void {
  act(() => {
    inputElement().dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

function click(testId: string): void {
  const element = container?.querySelector(`button[aria-label="${testId}"]`);
  expect(element).toBeInstanceOf(HTMLElement);
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function emitFindResults(event: FindResultChange): void {
  act(() => {
    terminalProps.current?.onFindResult?.({ ...event, limited: false, placement: "top" });
  });
}

describe("TerminalPane find", () => {
  it("searches through xterm, navigates matches, and clears decorations", () => {
    renderTerminalPane();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
      );
    });
    changeInput("needle");
    emitFindResults({ resultIndex: 2, resultCount: 7 });

    expect(terminalHandle.find.search).toHaveBeenCalledWith("needle");
    expect(container?.textContent).toContain("3 of 7");

    click("Next match");
    expect(terminalHandle.find.search).toHaveBeenLastCalledWith("needle", "next");
    emitFindResults({ resultIndex: 3, resultCount: 7 });

    click("Previous match");
    expect(terminalHandle.find.search).toHaveBeenLastCalledWith("needle", "previous");
    emitFindResults({ resultIndex: 2, resultCount: 7 });

    pressFindKey("Enter");
    expect(terminalHandle.find.search).toHaveBeenLastCalledWith("needle", "next");
    emitFindResults({ resultIndex: 3, resultCount: 7 });

    pressFindKey("Enter", true);
    expect(terminalHandle.find.search).toHaveBeenLastCalledWith("needle", "previous");

    changeInput("");
    expect(terminalHandle.find.search).toHaveBeenLastCalledWith("");

    changeInput("needle");
    click("Close Find");
    expect(terminalHandle.find.clear).toHaveBeenCalledTimes(1);
    expect(container?.querySelector("input")).toBeNull();
  });

  it("keeps terminal key input flowing while the find bar is open", async () => {
    renderTerminalPane();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
      );
    });
    await act(async () => {
      await terminalProps.current?.onTerminalKey?.({
        key: "c",
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });
    });

    expect(client.sendTerminalInput).toHaveBeenCalledWith("terminal-a", {
      type: "input",
      data: "\u0003",
    });
  });
});
