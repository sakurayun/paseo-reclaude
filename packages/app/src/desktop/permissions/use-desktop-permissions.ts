import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDesktopPermissionSnapshot,
  requestDesktopPermission,
  shouldShowDesktopPermissionSection,
  type DesktopPermissionKind,
  type DesktopPermissionSnapshot,
} from "@/desktop/permissions/desktop-permissions";
import i18n from "@/i18n";
import { sendOsNotification } from "@/utils/os-notifications";

export interface UseDesktopPermissionsReturn {
  isDesktopApp: boolean;
  snapshot: DesktopPermissionSnapshot | null;
  isRefreshing: boolean;
  requestingPermission: DesktopPermissionKind | null;
  isSendingTestNotification: boolean;
  testNotificationError: string | null;
  refreshPermissions: () => Promise<void>;
  requestPermission: (kind: DesktopPermissionKind) => Promise<void>;
  sendTestNotification: () => Promise<void>;
}

function emptyNotificationStatus() {
  return {
    state: "unknown" as const,
    detail: i18n.t("settings:permissions.detail.notificationsUnchecked"),
  };
}

function emptyMicrophoneStatus() {
  return {
    state: "unknown" as const,
    detail: i18n.t("settings:permissions.detail.microphoneUnchecked"),
  };
}

export function useDesktopPermissions(): UseDesktopPermissionsReturn {
  const isDesktopApp = shouldShowDesktopPermissionSection();
  const isMountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<DesktopPermissionSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState<DesktopPermissionKind | null>(
    null,
  );
  const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!isDesktopApp) {
      return;
    }

    setIsRefreshing(true);
    try {
      const nextSnapshot = await getDesktopPermissionSnapshot();
      if (!isMountedRef.current) {
        return;
      }
      setSnapshot(nextSnapshot);
    } catch (error) {
      console.error("[Settings] Failed to load desktop permission status", error);
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [isDesktopApp]);

  const requestPermission = useCallback(
    async (kind: DesktopPermissionKind) => {
      if (!isDesktopApp) {
        return;
      }

      setRequestingPermission(kind);
      try {
        const status = await requestDesktopPermission({ kind });
        if (!isMountedRef.current) {
          return;
        }

        setSnapshot((previous) => {
          const base: DesktopPermissionSnapshot = previous ?? {
            checkedAt: Date.now(),
            notifications: emptyNotificationStatus(),
            microphone: emptyMicrophoneStatus(),
          };

          if (kind === "notifications") {
            return {
              ...base,
              checkedAt: Date.now(),
              notifications: status,
            };
          }

          return {
            ...base,
            checkedAt: Date.now(),
            microphone: status,
          };
        });
      } catch (error) {
        console.error(`[Settings] Failed to request ${kind} permission`, error);
      } finally {
        if (isMountedRef.current) {
          setRequestingPermission(null);
        }
        await refreshPermissions();
      }
    },
    [isDesktopApp, refreshPermissions],
  );

  const [testNotificationError, setTestNotificationError] = useState<string | null>(null);

  const sendTestNotification = useCallback(async () => {
    if (!isDesktopApp) {
      return;
    }

    setIsSendingTestNotification(true);
    setTestNotificationError(null);
    try {
      const sent = await sendOsNotification({
        title: i18n.t("settings:permissions.testNotification.title"),
        body: i18n.t("settings:permissions.testNotification.body"),
      });
      if (!sent) {
        setTestNotificationError(i18n.t("settings:permissions.testNotification.notDelivered"));
      }
    } catch {
      setTestNotificationError(i18n.t("settings:permissions.testNotification.sendFailed"));
    } finally {
      if (isMountedRef.current) {
        setIsSendingTestNotification(false);
      }
    }
  }, [isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }

    void refreshPermissions();
  }, [isDesktopApp, refreshPermissions]);

  return {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    isSendingTestNotification,
    testNotificationError,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  };
}
