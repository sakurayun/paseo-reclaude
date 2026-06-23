export interface WorkspaceTabWheelScrollInput {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  deltaX: number;
  deltaY: number;
}

export interface WorkspaceTabWheelScrollResult {
  nextScrollLeft: number;
  shouldPreventDefault: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function resolveWorkspaceTabWheelScroll(
  input: WorkspaceTabWheelScrollInput,
): WorkspaceTabWheelScrollResult {
  const maxScrollLeft = Math.max(0, input.scrollWidth - input.clientWidth);
  if (maxScrollLeft === 0) {
    return {
      nextScrollLeft: input.scrollLeft,
      shouldPreventDefault: false,
    };
  }

  if (Math.abs(input.deltaY) <= Math.abs(input.deltaX)) {
    return {
      nextScrollLeft: input.scrollLeft,
      shouldPreventDefault: false,
    };
  }

  const nextScrollLeft = clamp(input.scrollLeft + input.deltaY, 0, maxScrollLeft);
  return {
    nextScrollLeft,
    shouldPreventDefault: nextScrollLeft !== input.scrollLeft,
  };
}
