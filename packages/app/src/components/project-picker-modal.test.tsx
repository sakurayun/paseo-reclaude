/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, theme } = vi.hoisted(() => {
  const keyboardStore = {
    projectPickerOpen: true,
    setProjectPickerOpen: vi.fn((open: boolean) => {
      keyboardStore.projectPickerOpen = open;
    }),
  };

  return {
    mocks: {
      keyboardStore,
      recommendedPaths: { value: [] as string[] },
      getDirectorySuggestions: vi.fn(async () => ({
        requestId: "request-1",
        directories: [] as string[],
        entries: [] as Array<{ path: string; kind: "directory" | "file" }>,
        error: null as string | null,
      })),
      openProject: vi.fn(async () => true),
      textInput: {
        onChangeText: null as ((text: string) => void) | null,
        onSubmitEditing: null as (() => void) | null,
      },
    },
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 12: 48 },
      borderRadius: { lg: 8 },
      fontSize: { base: 15, lg: 18 },
      colors: {
        border: "#555",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        surface0: "#000",
        surface1: "#111",
      },
      shadow: { lg: {} },
    },
  };
});

vi.mock("@/constants/platform", () => ({
  isNative: true,
  isWeb: false,
}));

vi.mock("@/hooks/use-active-server-id", () => ({
  useActiveServerId: () => "server-1",
}));

vi.mock("@/hooks/use-open-project", () => ({
  useOpenProject: () => mocks.openProject,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    getDirectorySuggestions: mocks.getDirectorySuggestions,
  }),
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/stores/keyboard-shortcuts-store", () => ({
  useKeyboardShortcutsStore: <T,>(selector: (state: typeof mocks.keyboardStore) => T) =>
    selector(mocks.keyboardStore),
}));

vi.mock("@/stores/session-store-hooks", () => ({
  useRecommendedProjectPaths: () => mocks.recommendedPaths.value,
}));

vi.mock("lucide-react-native", () => ({
  Folder: (props: Record<string, unknown>) => React.createElement("span", props),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    absoluteFillObject: {},
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

interface NativeProps {
  children?: React.ReactNode | ((state: { hovered: boolean; pressed: boolean }) => React.ReactNode);
  editable?: boolean;
  onChangeText?: (text: string) => void;
  onPress?: () => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  testID?: string;
  value?: string;
  visible?: boolean;
}

vi.mock("react-native", () => {
  const renderStaticChildren = (children: NativeProps["children"]): React.ReactNode =>
    typeof children === "function" ? null : children;
  const renderPressableChildren = (children: NativeProps["children"]): React.ReactNode =>
    typeof children === "function" ? children({ hovered: false, pressed: false }) : children;

  const Modal = ({ children, visible = true }: NativeProps) =>
    visible
      ? React.createElement(
          "div",
          { "data-testid": "project-picker-modal" },
          renderStaticChildren(children),
        )
      : null;

  const Pressable = ({ children, onPress, testID }: NativeProps) =>
    React.createElement(
      "button",
      {
        "data-testid": testID,
        onClick: () => onPress?.(),
        type: "button",
      },
      renderPressableChildren(children),
    );

  const ScrollView = ({ children, testID }: NativeProps) =>
    React.createElement("div", { "data-testid": testID }, renderStaticChildren(children));

  const Text = ({ children, testID }: NativeProps) =>
    React.createElement("span", { "data-testid": testID }, renderStaticChildren(children));

  const TextInput = React.forwardRef<HTMLInputElement, NativeProps>(
    ({ editable = true, onChangeText, onSubmitEditing, placeholder, testID, value }, ref) => {
      mocks.textInput.onChangeText = onChangeText ?? null;
      mocks.textInput.onSubmitEditing = onSubmitEditing ?? null;

      return React.createElement("input", {
        "data-testid": testID,
        disabled: editable === false,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.currentTarget.value),
        placeholder,
        ref,
        value: value ?? "",
      });
    },
  );

  const View = ({ children, testID }: NativeProps) =>
    React.createElement("div", { "data-testid": testID }, renderStaticChildren(children));

  return {
    Modal,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
  };
});

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { ProjectPickerModal } from "./project-picker-modal";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 3; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function pathInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="project-picker-path-input"]',
  );
  if (!input) {
    throw new Error("Project picker path input not found");
  }
  return input;
}

function setPathInput(value: string): void {
  pathInput();
  act(() => {
    mocks.textInput.onChangeText?.(value);
  });
}

function submitPathInput(): void {
  pathInput();
  act(() => {
    mocks.textInput.onSubmitEditing?.();
  });
}

function countPathRows(path: string): number {
  return Array.from(document.querySelectorAll("button")).filter((button) =>
    button.textContent?.includes(path),
  ).length;
}

describe("ProjectPickerModal", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    mocks.keyboardStore.projectPickerOpen = true;
    mocks.keyboardStore.setProjectPickerOpen.mockClear();
    mocks.recommendedPaths.value = [];
    mocks.getDirectorySuggestions.mockReset();
    mocks.getDirectorySuggestions.mockResolvedValue({
      requestId: "request-1",
      directories: [],
      entries: [],
      error: null,
    });
    mocks.openProject.mockClear();
    mocks.openProject.mockResolvedValue(true);
    mocks.textInput.onChangeText = null;
    mocks.textInput.onSubmitEditing = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = createQueryClient();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    queryClient?.clear();
    queryClient = null;
    root = null;
    container?.remove();
    container = null;
  });

  function renderModal(): void {
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <ProjectPickerModal />
        </QueryClientProvider>,
      );
    });
  }

  it("submits a manually typed Linux path from the native return key", async () => {
    renderModal();

    setPathInput("/data/source/project");
    submitPathInput();
    await flushAsyncWork();

    expect(mocks.openProject).toHaveBeenCalledWith("/data/source/project");
    expect(mocks.keyboardStore.setProjectPickerOpen).toHaveBeenCalledWith(false);
  });

  it("shows the current typed path when daemon suggestions are empty", () => {
    renderModal();

    setPathInput("/workspace/project");

    expect(countPathRows("/workspace/project")).toBe(1);
  });

  it("does not duplicate the typed path when it already exists in suggestions", () => {
    mocks.recommendedPaths.value = ["/data/source/project"];
    renderModal();

    setPathInput("/data/source/project");

    expect(countPathRows("/data/source/project")).toBe(1);
  });
});
