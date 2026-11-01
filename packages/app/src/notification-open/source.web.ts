import { WEB_NOTIFICATION_CLICK_EVENT } from "./model";
import type { NotificationOpenSource } from "./source";
import { isWeb } from "@/constants/platform";
import {
  reportTerminalNotificationActivated,
  reportTerminalNotificationClosed,
} from "@/terminal/runtime/terminal-desktop-notification-actions";

export function createNotificationOpenSource(): NotificationOpenSource {
  let nextId = 0;
  return {
    subscribe(onTap) {
      if (!isWeb) return () => {};
      function receive(event: Event) {
        if (!(event instanceof CustomEvent)) return;
        event.preventDefault();
        const terminal = reportTerminalNotificationActivated(event.detail?.data);
        if (terminal.handled && !terminal.shouldFocus) return;
        onTap({ id: `web:${++nextId}`, data: event.detail?.data });
      }
      function receiveClose(event: Event) {
        if (event instanceof CustomEvent) reportTerminalNotificationClosed(event.detail?.data);
      }
      window.addEventListener(WEB_NOTIFICATION_CLICK_EVENT, receive);
      window.addEventListener("paseo:web-notification-close", receiveClose);
      return () => {
        window.removeEventListener(WEB_NOTIFICATION_CLICK_EVENT, receive);
        window.removeEventListener("paseo:web-notification-close", receiveClose);
      };
    },
    async takeLaunchTap() {
      return null;
    },
    acknowledge() {},
  };
}
