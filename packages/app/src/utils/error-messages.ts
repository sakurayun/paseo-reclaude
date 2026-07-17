export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
    if (typeof record.error === "string" && record.error.length > 0) {
      return record.error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

/**
 * Shape an unknown failure for structured console logging.
 * Avoids `console.error("…", { error })` collapsing to `[object Object]`.
 */
export function formatErrorForLog(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
  cause?: ReturnType<typeof formatErrorForLog>;
  value?: unknown;
} {
  if (error instanceof Error) {
    const formatted: {
      message: string;
      name?: string;
      stack?: string;
      cause?: ReturnType<typeof formatErrorForLog>;
    } = {
      message: error.message,
      name: error.name,
    };
    if (typeof error.stack === "string" && error.stack.length > 0) {
      formatted.stack = error.stack;
    }
    if ("cause" in error && error.cause !== undefined) {
      formatted.cause = formatErrorForLog(error.cause);
    }
    return formatted;
  }

  if (error && typeof error === "object") {
    return {
      message: toErrorMessage(error),
      value: error,
    };
  }

  return { message: toErrorMessage(error) };
}
