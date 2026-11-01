import { getDesktopHost } from "@/desktop/host";
import { createNotificationOpenSource as createWebSource } from "./source.web";
import type { NotificationOpenSource } from "./source";
import {
  reportTerminalNotificationActivated,
  reportTerminalNotificationClosed,
} from "@/terminal/runtime/terminal-desktop-notification-actions";

export function createNotificationOpenSource(): NotificationOpenSource {
  const web = createWebSource();
  let nextId = 0;
  return {
    ...web,
    subscribe(onTap) {
      const stopWeb = web.subscribe(onTap);
      let disposed = false;
      let stopDesktop: (() => void) | undefined;
      const subscription = getDesktopHost()?.events?.on?.(
        "notification-click",
        (payload: unknown) => {
          const data =
            typeof payload === "object" && payload !== null && "data" in payload
              ? payload.data
              : undefined;
          const record =
            typeof data === "object" && data !== null
              ? Object.fromEntries(Object.entries(data))
              : undefined;
          const terminal = reportTerminalNotificationActivated(record);
          if (terminal.handled && !terminal.shouldFocus) return;
          onTap({
            id: `electron:${++nextId}`,
            data:
              typeof data === "object" && data !== null
                ? Object.fromEntries(Object.entries(data))
                : undefined,
          });
        },
      );
      const closeSubscription = getDesktopHost()?.events?.on?.(
        "notification-close",
        (payload: unknown) => {
          if (typeof payload !== "object" || payload === null || !("data" in payload)) return;
          const data = payload.data;
          if (typeof data === "object" && data !== null)
            reportTerminalNotificationClosed(Object.fromEntries(Object.entries(data)));
        },
      );
      let stopClose: (() => void) | undefined;
      void Promise.resolve(closeSubscription).then((stop) => {
        if (disposed) stop?.();
        else stopClose = stop;
        return;
      });
      void Promise.resolve(subscription).then((stop) => {
        if (disposed) stop?.();
        else stopDesktop = stop;
        return;
      });
      return () => {
        disposed = true;
        stopWeb();
        stopDesktop?.();
        stopClose?.();
      };
    },
  };
}
