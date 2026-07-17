export type SidebarSessionSelectionKey = string;

export function toSidebarSessionSelectionKey(input: {
  serverId: string;
  id: string;
}): SidebarSessionSelectionKey {
  return `${input.serverId}:${input.id}`;
}

export function parseSidebarSessionSelectionKey(
  key: SidebarSessionSelectionKey,
): { serverId: string; agentId: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return {
    serverId: key.slice(0, separator),
    agentId: key.slice(separator + 1),
  };
}

export type SidebarSessionSelectionMode = "replace" | "toggle" | "range";

export interface SidebarSessionSelectionState {
  selectedKeys: ReadonlySet<SidebarSessionSelectionKey>;
  /** Anchor used as the start of a Shift-range selection. */
  anchorKey: SidebarSessionSelectionKey | null;
}

export function createEmptySidebarSessionSelection(): SidebarSessionSelectionState {
  return {
    selectedKeys: new Set(),
    anchorKey: null,
  };
}

/**
 * Pure multi-select update for an ordered list of session keys.
 *
 * - `replace`: select only the target (normal click)
 * - `toggle`: Ctrl/Cmd click — add/remove the target without dropping others
 * - `range`: Shift click — select every key between the anchor and the target
 */
export function applySidebarSessionSelection(input: {
  state: SidebarSessionSelectionState;
  orderedKeys: readonly SidebarSessionSelectionKey[];
  targetKey: SidebarSessionSelectionKey;
  mode: SidebarSessionSelectionMode;
}): SidebarSessionSelectionState {
  const { orderedKeys, targetKey, mode } = input;
  if (mode === "replace") {
    return {
      selectedKeys: new Set([targetKey]),
      anchorKey: targetKey,
    };
  }

  if (mode === "toggle") {
    const next = new Set(input.state.selectedKeys);
    if (next.has(targetKey)) {
      next.delete(targetKey);
    } else {
      next.add(targetKey);
    }
    return {
      selectedKeys: next,
      // Keep anchor when removing so a later Shift-range is still predictable.
      anchorKey: input.state.anchorKey ?? targetKey,
    };
  }

  // range
  const anchorKey = input.state.anchorKey ?? targetKey;
  const startIndex = orderedKeys.indexOf(anchorKey);
  const endIndex = orderedKeys.indexOf(targetKey);
  if (startIndex < 0 || endIndex < 0) {
    return {
      selectedKeys: new Set([targetKey]),
      anchorKey: targetKey,
    };
  }
  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  const next = new Set(input.state.selectedKeys);
  for (let index = from; index <= to; index += 1) {
    next.add(orderedKeys[index]!);
  }
  return {
    selectedKeys: next,
    anchorKey,
  };
}

export function readPointerSelectionMode(event: unknown): SidebarSessionSelectionMode {
  const source = resolveEventSource(event);
  if (!source) {
    return "replace";
  }
  if (source.shiftKey) {
    return "range";
  }
  if (source.metaKey || source.ctrlKey) {
    return "toggle";
  }
  return "replace";
}

function resolveEventSource(event: unknown): {
  shiftKey?: unknown;
  metaKey?: unknown;
  ctrlKey?: unknown;
} | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const nativeEvent = Reflect.get(event, "nativeEvent");
  if (typeof nativeEvent === "object" && nativeEvent !== null) {
    return nativeEvent as {
      shiftKey?: unknown;
      metaKey?: unknown;
      ctrlKey?: unknown;
    };
  }
  return event as {
    shiftKey?: unknown;
    metaKey?: unknown;
    ctrlKey?: unknown;
  };
}
