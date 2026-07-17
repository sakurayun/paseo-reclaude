import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Check,
  ChevronRight,
  Globe,
  Monitor,
  Pencil,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react-native";
import type { TFunction } from "i18next";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DictationModelInfo, TerminalProfile } from "@getpaseo/protocol/messages";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@getpaseo/protocol/terminal-profiles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ProfileDraft,
  TerminalProfileEditModal,
} from "@/screens/settings/terminal-profile-edit-modal";
import { getIsElectron } from "@/constants/platform";
import {
  getDesktopDaemonStatus,
  restartDesktopDaemon,
  startDesktopDaemon,
  stopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import { LocalDaemonSection } from "@/desktop/components/desktop-updates-section";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { loadDesktopSettings, useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { ModelGatewaysSection } from "@/screens/settings/model-gateways-section";
import { ProvidersSection } from "@/screens/settings/providers-section";
import { ProviderUsageSettingsSection } from "@/provider-usage/settings-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isVersionMismatch } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatLatency } from "@/utils/latency";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { getProviderIcon } from "@/components/provider-icons";
import { BrowserToolsOptInCard } from "./browser-tools-card";
import { hasDaemonReconnectedAfter, type DaemonConnectionMarker } from "./daemon-reconnect";
import { hostProfileLooksLocal, restartDaemonFromSettings } from "./daemon-restart";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedProfilePencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedProfileSquareTerminal = withUnistyles(SquareTerminal);
const ThemedPlus = withUnistyles(Plus);

interface DynamicProviderIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ iconKey, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withUnistyles(DynamicProviderIcon);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const editProfileIcon = <ThemedProfilePencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const removeProfileIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />;
const addProfileIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

function formatHostConnectionLabel(connection: HostConnection, t: TFunction): string {
  if (connection.type === "relay") {
    return `${t("settings.host.badges.relay")} (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `${t("settings.host.badges.local")} (${connection.path})`;
  }
  return `TCP (${connection.endpoint})`;
}

function formatActiveConnectionBadge(
  activeConnection: { type: HostConnection["type"]; display: string } | null,
  theme: ReturnType<typeof useUnistyles>["theme"],
  t: TFunction,
): { icon: React.ReactNode; text: string } | null {
  if (!activeConnection) return null;
  if (activeConnection.type === "relay") {
    return {
      icon: <Globe size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.relay"),
    };
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return {
      icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.local"),
    };
  }
  return {
    icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    text: activeConnection.display,
  };
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function useHostProfile(serverId: string): HostProfile | null {
  const daemons = useHosts();
  return daemons.find((entry) => entry.serverId === serverId) ?? null;
}

function HostNotFound() {
  const { t } = useTranslation();
  return (
    <View>
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{t("settings.host.notFound")}</Text>
      </View>
    </View>
  );
}

function HostStatusBadges({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnection = snapshot?.activeConnection ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusColor: string;
  if (statusTone === "success") {
    statusColor = theme.colors.palette.green[400];
  } else if (statusTone === "warning") {
    statusColor = theme.colors.palette.amber[500];
  } else if (statusTone === "error") {
    statusColor = theme.colors.destructive;
  } else {
    statusColor = theme.colors.foregroundMuted;
  }
  let statusPillBg: string;
  if (statusTone === "success") {
    statusPillBg = "rgba(74, 222, 128, 0.1)";
  } else if (statusTone === "warning") {
    statusPillBg = "rgba(245, 158, 11, 0.1)";
  } else if (statusTone === "error") {
    statusPillBg = "rgba(248, 113, 113, 0.1)";
  } else {
    statusPillBg = "rgba(161, 161, 170, 0.1)";
  }
  const connectionBadge = formatActiveConnectionBadge(activeConnection, theme, t);
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);

  const statusPillStyle = useMemo(
    () => [styles.statusPill, { backgroundColor: statusPillBg }],
    [statusPillBg],
  );
  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: statusColor }],
    [statusColor],
  );
  const statusTextStyle = useMemo(() => [styles.statusText, { color: statusColor }], [statusColor]);

  return (
    <View style={styles.identityBadges} testID="host-page-identity">
      <View style={statusPillStyle}>
        <View style={statusDotStyle} />
        <Text style={statusTextStyle}>{statusLabel}</Text>
      </View>
      {connectionBadge ? (
        <View style={styles.badgePill}>
          {connectionBadge.icon}
          <Text style={styles.badgeText} numberOfLines={1}>
            {connectionBadge.text}
          </Text>
        </View>
      ) : null}
      {versionBadgeText ? (
        <View style={styles.badgePill}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {versionBadgeText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HostConnectionError({ serverId }: { serverId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const lastError = snapshot?.lastError ?? null;
  const connectionError =
    typeof lastError === "string" && lastError.trim().length > 0 ? lastError.trim() : null;
  if (!connectionError) return null;
  return <Text style={styles.errorText}>{connectionError}</Text>;
}

export function HostConnectionsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <HostConnectionError serverId={serverId} />
      <ConnectionsSection host={host} />
      {isLocalDaemon ? (
        <SettingsSection title={t("settings.host.pairDevices.title")}>
          <PairDeviceRow />
        </SettingsSection>
      ) : null}
    </View>
  );
}

export function HostAgentsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <SettingsSection title={t("settings.hostSections.agents")}>
          <InjectPaseoToolsCard serverId={serverId} />
          <BrowserToolsOptInCard serverId={serverId} />
          <DictationModelCard serverId={serverId} />
          <AppendSystemPromptCard serverId={serverId} />
        </SettingsSection>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

export function HostWorkspacesPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <SettingsSection title={t("settings.hostSections.workspaces")}>
          <AutoArchiveMergedWorkspacesCard serverId={serverId} />
        </SettingsSection>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.workspaces.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

export function HostProvidersPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ModelGatewaysSection serverId={serverId} />

      <ProvidersSection serverId={serverId} />
    </View>
  );
}

export function HostUsagePage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(serverId);
  const handleRefresh = useCallback(() => {
    void refreshProviderUsage();
  }, [refreshProviderUsage]);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProviderUsageSettingsSection
        view={providerUsageView}
        onRefresh={handleRefresh}
        serverId={serverId}
      />
    </View>
  );
}

export function HostSettingsPage({
  serverId,
  onHostRemoved,
}: {
  serverId: string;
  onHostRemoved?: () => void;
}) {
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <View style={styles.daemonHeader}>
        <Text style={styles.daemonHeaderLabel} numberOfLines={1}>
          {host.label}
        </Text>
        <HostRenameButton host={host} />
      </View>

      <HostStatusBadges serverId={serverId} />

      {isLocalDaemon ? <LocalDaemonSection /> : null}

      {!isLocalDaemon ? <UpdateDaemonCard key={host.serverId} host={host} /> : null}

      <RemoveHostSection host={host} isLocalDaemon={isLocalDaemon} onRemoved={onHostRemoved} />
    </View>
  );
}

export function HostRenameButton({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { renameHost } = useHostMutations();
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = useCallback(
    async (value: string) => {
      const nextLabel = value.trim();
      if (nextLabel === host.label.trim()) return;
      await renameHost(host.serverId, nextLabel);
    },
    [host.label, host.serverId, renameHost],
  );

  const openEditor = useCallback(() => setIsEditing(true), []);
  const closeEditor = useCallback(() => setIsEditing(false), []);

  return (
    <>
      <Pressable
        onPress={openEditor}
        hitSlop={8}
        style={styles.identityEditButton}
        accessibilityRole="button"
        accessibilityLabel={t("settings.host.daemon.rename.editLabel")}
        testID="host-page-label-edit-button"
      >
        <Pencil size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <AdaptiveRenameModal
        visible={isEditing}
        title={t("settings.host.daemon.rename.title")}
        initialValue={host.label}
        placeholder={t("settings.host.daemon.rename.placeholder")}
        submitLabel={t("settings.host.daemon.rename.submit")}
        onClose={closeEditor}
        onSubmit={handleSubmit}
        testID="host-page-rename-modal"
      />
    </>
  );
}

function ConnectionsSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);
  const removeConnectionHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.connections.removeTitle") }),
    [t],
  );

  const handleRequestRemove = useCallback(
    (connection: HostConnection) => {
      setPendingRemoveConnection({
        connectionId: connection.id,
        title: formatHostConnectionLabel(connection, t),
      });
    },
    [t],
  );

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        console.error("[HostPage] Failed to remove connection", error);
        Alert.alert(
          t("settings.host.connections.removeErrorTitle"),
          t("settings.host.connections.removeErrorMessage"),
        );
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId, t]);

  return (
    <SettingsSection title={t("settings.host.connections.title")}>
      <View style={settingsStyles.card} testID="host-page-connections-card">
        {host.connections.map((conn, index) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              showBorder={index > 0}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </View>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={removeConnectionHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-connection-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("settings.host.connections.removeMessage", {
              name: pendingRemoveConnection.title,
            })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancelConfirm}
              disabled={isRemovingConnection}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemovingConnection}
              testID="remove-connection-confirm"
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  showBorder,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  showBorder: boolean;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const title = formatHostConnectionLabel(connection, t);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return t("settings.host.connections.timeout");
    if (latencyMs != null) return formatLatency(latencyMs);
    return "—";
  })();
  const latencyColor = latencyError ? theme.colors.palette.red[300] : theme.colors.foregroundMuted;

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, { color: latencyColor }],
    [latencyColor],
  );
  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={latencyTextStyle}>{latencyText}</Text>
      <Button
        variant="ghost"
        size="sm"
        textStyle={destructiveTextStyle}
        onPress={handlePressRemove}
      >
        {t("settings.host.connections.removeAction")}
      </Button>
    </View>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (restartRequest: Promise<void>) => {
      const disconnectTimeoutMs = 30000;
      const reconnectTimeoutMs = 30000;
      const requestFailureDisconnectGraceMs = 2000;
      const disconnectedPromise = isHostConnected()
        ? waitForCondition(() => !isHostConnected(), disconnectTimeoutMs)
        : Promise.resolve(true);
      const restartResult = await restartRequest.then(
        () => ({ status: "accepted" as const }),
        async (error) => ({
          status: "rejected" as const,
          error,
          disconnectedAfterFailure: await waitForCondition(
            () => !isHostConnected(),
            requestFailureDisconnectGraceMs,
            100,
          ),
        }),
      );
      if (!isMountedRef.current) return;

      if (restartResult.status === "rejected" && !restartResult.disconnectedAfterFailure) {
        console.error(`[HostPage] Failed to restart daemon ${host.label}`, restartResult.error);
        setIsRestarting(false);
        Alert.alert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.requestFailedMessage"),
        );
        return;
      }

      const disconnected =
        restartResult.status === "rejected"
          ? restartResult.disconnectedAfterFailure
          : await disconnectedPromise;
      const reconnected =
        disconnected && (await waitForCondition(() => isHostConnected(), reconnectTimeoutMs));
      if (isMountedRef.current) {
        setIsRestarting(false);
        if (!reconnected) {
          Alert.alert(
            t("settings.host.daemon.restart.unableToReconnectTitle"),
            t("settings.host.daemon.restart.unableToReconnectMessage", { name: host.label }),
          );
        }
      }
    },
    [host.label, isHostConnected, t, waitForCondition],
  );

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      Alert.alert(
        t("settings.host.daemon.restart.unavailableTitle"),
        t("settings.host.daemon.restart.unavailableMessage"),
      );
      return;
    }
    if (!isHostConnected()) {
      Alert.alert(
        t("settings.host.daemon.restart.offlineTitle"),
        t("settings.host.daemon.restart.offlineMessage"),
      );
      return;
    }

    void (async () => {
      try {
        const confirmed = await confirmDialog({
          title: t("settings.host.daemon.restart.confirmTitle", { name: host.label }),
          message: t("settings.host.daemon.restart.confirmMessage"),
          confirmLabel: t("settings.host.daemon.restart.confirm"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        setIsRestarting(true);
        const restartRequest = restartDaemonFromSettings(
          host.serverId,
          `settings_daemon_restart_${host.serverId}`,
          {
            getIsElectron,
            getDesktopDaemonStatus,
            getDesktopSettings: loadDesktopSettings,
            restartDesktopDaemon,
            restartServer: (reason) => daemonClient.restartServer(reason),
          },
          { hostLooksLocal: hostProfileLooksLocal(host) },
        );
        await waitForDaemonRestart(restartRequest);
      } catch (error) {
        console.error(`[HostPage] Failed to restart daemon ${host.label}`, error);
        if (isMountedRef.current) {
          setIsRestarting(false);
        }
        Alert.alert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          error instanceof Error
            ? error.message
            : t("settings.host.daemon.restart.dialogFailedMessage"),
        );
      }
    })();
  }, [daemonClient, host, isHostConnected, t, waitForDaemonRestart]);

  const restartIcon = useMemo(
    () => <RotateCw size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  return (
    <View style={settingsStyles.card} testID="host-page-restart-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.restart.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.daemon.restart.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={restartIcon}
          onPress={handleRestart}
          disabled={isRestarting || !daemonClient || !isConnected}
          testID="host-page-restart-button"
        >
          {isRestarting
            ? t("settings.host.daemon.restart.restarting")
            : t("settings.host.daemon.restart.confirm")}
        </Button>
      </View>
    </View>
  );
}

type DaemonUpdateState =
  | { status: "idle" }
  | { status: "updating"; phase: string }
  | { status: "failed"; title: string; message: string };

function UpdateDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [updateState, setUpdateState] = useState<DaemonUpdateState>({ status: "idle" });
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );
  const supportsSelfUpdate = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonSelfUpdate === true,
  );
  const desktopManaged = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.desktopManaged === true,
  );

  const appVersion = resolveAppVersion();
  const hasVersionMismatch = isVersionMismatch(appVersion, daemonVersion);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );
  const hasReconnectedAfter = useCallback(
    (startMarker: DaemonConnectionMarker | null) =>
      hasDaemonReconnectedAfter(runtime.getSnapshot(host.serverId), startMarker),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (startMarker: DaemonConnectionMarker | null) => {
      const disconnectTimeoutMs = 15000;
      const reconnectTimeoutMs = 120000; // 2 minutes — npm update + restart can take a while
      if (!hasReconnectedAfter(startMarker) && isHostConnected()) {
        await waitForCondition(
          () => !isHostConnected() || hasReconnectedAfter(startMarker),
          disconnectTimeoutMs,
        );
      }
      const reconnected =
        hasReconnectedAfter(startMarker) ||
        (await waitForCondition(() => hasReconnectedAfter(startMarker), reconnectTimeoutMs));
      if (isMountedRef.current) {
        if (!reconnected) {
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.unableToReconnectTitle"),
            message: t("settings.host.daemon.update.unableToReconnectMessage", {
              name: host.label,
            }),
          });
          return;
        }
        setUpdateState({ status: "idle" });
      }
    },
    [hasReconnectedAfter, host.label, isHostConnected, t, waitForCondition],
  );

  const handleUpdate = useCallback(() => {
    if (!daemonClient) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.unavailableTitle"),
        message: t("settings.host.daemon.update.unavailableMessage"),
      });
      return;
    }
    if (!isHostConnected()) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.offlineTitle"),
        message: t("settings.host.daemon.update.offlineMessage"),
      });
      return;
    }

    void confirmDialog({
      title: t("settings.host.daemon.update.confirmTitle", { name: host.label }),
      message: t("settings.host.daemon.update.confirmMessage"),
      confirmLabel: t("settings.host.daemon.update.confirm"),
      cancelLabel: t("common.actions.cancel"),
      destructive: false,
    })
      .then((confirmed) => {
        if (!confirmed || !isMountedRef.current) return;
        const startSnapshot = runtime.getSnapshot(host.serverId);
        const startMarker = startSnapshot
          ? {
              clientGeneration: startSnapshot.clientGeneration,
              lastOnlineAt: startSnapshot.lastOnlineAt,
            }
          : null;
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseStarting"),
        });
        const requestId = `settings_daemon_update_${host.serverId}`;

        const unsubscribe = daemonClient.on("daemon.update.progress", (message) => {
          if (message.payload.requestId !== requestId) return;
          if (!isMountedRef.current) return;
          const { phase } = message.payload;
          if (phase === "starting")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseStarting"),
            });
          else if (phase === "downloading")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseDownloading"),
            });
          else if (phase === "installing")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseInstalling"),
            });
          else if (phase === "complete")
            setUpdateState({
              status: "updating",
              phase: t("settings.host.daemon.update.phaseComplete"),
            });
        });
        unsubscribeRef.current = unsubscribe;

        void daemonClient
          .updateDaemon(requestId)
          .then((response) => {
            unsubscribeRef.current = null;
            unsubscribe();
            if (!response.success) {
              if (!isMountedRef.current) return undefined;
              setUpdateState({
                status: "failed",
                title: t("settings.host.daemon.update.requestFailedTitle"),
                message: t("settings.host.daemon.update.requestFailedMessage", {
                  error: response.error ?? "Unknown error",
                }),
              });
              return undefined;
            }
            // Update succeeded — wait for daemon to restart and reconnect
            void waitForDaemonRestart(startMarker);
            return undefined;
          })
          .catch((error) => {
            unsubscribeRef.current = null;
            unsubscribe();
            console.error(`[HostPage] Failed to update daemon ${host.label}`, error);
            if (!isMountedRef.current) return;
            setUpdateState({
              status: "failed",
              title: t("settings.host.daemon.update.requestFailedTitle"),
              message: t("settings.host.daemon.update.requestFailedMessage", {
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            });
          });
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open update confirmation for ${host.label}`, error);
        if (!isMountedRef.current) return;
        setUpdateState({
          status: "failed",
          title: t("settings.host.daemon.update.requestFailedTitle"),
          message: t("settings.host.daemon.update.dialogFailedMessage"),
        });
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, runtime, t, waitForDaemonRestart]);

  const updateIcon = useMemo(
    () => <ArrowUpToLine size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  const shouldShowUpdate = hasVersionMismatch && (supportsSelfUpdate || desktopManaged);
  if (!shouldShowUpdate) {
    return null;
  }

  const isUpdating = updateState.status === "updating";
  const buttonLabel = isUpdating ? updateState.phase : t("settings.host.daemon.update.confirm");

  return (
    <View style={settingsStyles.card} testID="host-page-update-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.update.title")}</Text>
          <Text style={settingsStyles.rowHint}>
            {desktopManaged
              ? t("settings.host.daemon.update.desktopManagedHint")
              : t("settings.host.daemon.update.hint")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={updateIcon}
          onPress={handleUpdate}
          disabled={desktopManaged || isUpdating || !daemonClient || !isConnected}
          testID="host-page-update-button"
        >
          {buttonLabel}
        </Button>
      </View>
      {updateState.status === "failed" ? (
        <View style={styles.updateFailure}>
          <InlineAlert
            variant="error"
            title={updateState.title}
            description={updateState.message}
            testID="host-page-update-error"
          />
        </View>
      ) : null}
    </View>
  );
}

function InjectPaseoToolsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        mcp: {
          injectIntoAgents: next,
        },
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-inject-mcp-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.orchestration.enableTools.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.orchestration.enableTools.hint")}
          </Text>
        </View>
        <Switch
          value={config?.mcp.injectIntoAgents !== false}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.orchestration.enableTools.accessibilityLabel")}
        />
      </View>
    </View>
  );
}

/** Strip parenthetical notes (and any trailing period) from a model description for display. */
function cleanDictationLabel(description: string): string {
  return description
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[.\s]+$/, "")
    .trim();
}

const DICTATION_DOWNLOAD_POLL_MS = 500;
const EMPTY_DICTATION_MODELS: DictationModelInfo[] = [];
const ACCESSIBILITY_STATE_SELECTED = { selected: true } as const;
const ACCESSIBILITY_STATE_UNSELECTED = { selected: false } as const;

type DictationRunState = "running" | "starting" | "stopped";

function resolveDictationRunState(
  selected: boolean,
  readinessAvailable: boolean,
): DictationRunState {
  if (selected && readinessAvailable) return "running";
  if (selected) return "starting";
  return "stopped";
}

function dictationRunStateLabel(t: TFunction, state: DictationRunState): string {
  if (state === "running") return t("settings.host.dictation.running");
  if (state === "starting") return t("settings.host.dictation.starting");
  return t("settings.host.dictation.stopped");
}

function formatDictationDownloadSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "—";
  }
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

function resolveDictationDownloadProgress(params: {
  model: DictationModelInfo;
  selected: boolean;
  downloading: boolean;
  readinessProgress: number | undefined;
  optimistic: boolean;
}): number | null {
  if (typeof params.model.downloadProgress === "number") {
    return params.model.downloadProgress;
  }
  if (params.selected && typeof params.readinessProgress === "number") {
    return params.readinessProgress;
  }
  if (params.downloading || params.optimistic) {
    return 0;
  }
  return null;
}

function resolveDictationDownloadSpeed(params: {
  model: DictationModelInfo;
  selected: boolean;
  readinessSpeed: number | undefined;
}): number {
  if (typeof params.model.downloadBytesPerSecond === "number") {
    return params.model.downloadBytesPerSecond;
  }
  if (params.selected && typeof params.readinessSpeed === "number") {
    return params.readinessSpeed;
  }
  return 0;
}

function isDictationModelDownloading(params: {
  model: DictationModelInfo;
  selected: boolean;
  readinessDownloading: boolean;
  missingModelIds: string[];
  readinessAvailable: boolean;
  optimistic: boolean;
}): boolean {
  if (params.optimistic) {
    return true;
  }
  if (params.model.downloading === true) {
    return true;
  }
  if (!params.selected || !params.readinessDownloading) {
    return false;
  }
  return params.missingModelIds.includes(params.model.id) || !params.readinessAvailable;
}

function useDictationModels(
  serverId: string,
  options: {
    forcePoll: boolean;
  },
) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.dictationModelSelection === true,
  );
  const queryKey = useMemo(() => ["dictation-models", serverId] as const, [serverId]);
  const forcePoll = options.forcePoll;
  const query = useQuery({
    queryKey,
    enabled: Boolean(client && isConnected && supported),
    // Live progress needs frequent round-trips; otherwise keep the list warm for a bit.
    staleTime: forcePoll ? 0 : 5_000,
    refetchInterval: (queryState) => {
      if (forcePoll) {
        return DICTATION_DOWNLOAD_POLL_MS;
      }
      const data = queryState.state.data;
      if (!data) {
        return false;
      }
      if (data.readiness?.downloading === true) {
        return DICTATION_DOWNLOAD_POLL_MS;
      }
      if (
        data.models.some(
          (model) => model.downloading === true || typeof model.downloadProgress === "number",
        )
      ) {
        return DICTATION_DOWNLOAD_POLL_MS;
      }
      // Selected model still missing on disk — download may start shortly after set_model.
      if (
        data.models.some((model) => model.id === data.current.model && model.installed !== true)
      ) {
        return DICTATION_DOWNLOAD_POLL_MS;
      }
      return false;
    },
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return client.listDictationModels();
    },
  });
  return { query, queryKey, supported, client };
}

function DictationModelCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Models the user just kicked off — keep polling even before the daemon reports downloading.
  const [trackingModelIds, setTrackingModelIds] = useState<Set<string>>(() => new Set());
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const forcePoll = trackingModelIds.size > 0 || pendingModel !== null;
  const { query, queryKey, supported, client } = useDictationModels(serverId, { forcePoll });

  const models = query.data?.models ?? EMPTY_DICTATION_MODELS;
  const currentModel = query.data?.current.model ?? null;
  const readiness = query.data?.readiness ?? null;

  // Drop tracking once the model is installed (or leaves the list).
  useEffect(() => {
    if (trackingModelIds.size === 0) {
      return;
    }
    const snapshotModels = query.data?.models;
    if (!snapshotModels) {
      return;
    }
    setTrackingModelIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const model = snapshotModels.find((entry) => entry.id === id);
        // Unknown id (not in list) or installed → stop tracking.
        if (!model || model.installed) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [query.data?.models, trackingModelIds.size]);

  const handleApply = useCallback(
    (modelId: string) => {
      if (!client) {
        return;
      }
      setPendingModel(modelId);
      setTrackingModelIds((prev) => new Set(prev).add(modelId));
      void (async () => {
        try {
          await client.setDictationModel(modelId);
          await queryClient.invalidateQueries({ queryKey });
        } catch (error) {
          setTrackingModelIds((prev) => {
            const next = new Set(prev);
            next.delete(modelId);
            return next;
          });
          Alert.alert(
            t("settings.host.dictation.selectErrorTitle"),
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setPendingModel(null);
        }
      })();
    },
    [client, queryClient, queryKey, t],
  );

  if (!supported) {
    return null;
  }

  return (
    <View style={settingsStyles.card} testID="host-page-dictation-model-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.dictation.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.dictation.hint")}</Text>
        </View>
      </View>
      <View style={DICTATION_LIST_CARD_STYLE}>
        {query.isLoading && models.length === 0 ? (
          <Text style={styles.dictationOptionStatus}>{t("settings.host.dictation.loading")}</Text>
        ) : (
          models.map((model) => {
            const selected = model.id === currentModel;
            const optimistic = trackingModelIds.has(model.id) && model.installed !== true;
            const downloading = isDictationModelDownloading({
              model,
              selected,
              readinessDownloading: readiness?.downloading === true,
              missingModelIds: readiness?.missingModelIds ?? [],
              readinessAvailable: readiness?.available === true,
              optimistic,
            });
            const progress = resolveDictationDownloadProgress({
              model,
              selected,
              downloading,
              readinessProgress: readiness?.downloadProgress,
              optimistic,
            });
            const speed = resolveDictationDownloadSpeed({
              model,
              selected,
              readinessSpeed: readiness?.downloadBytesPerSecond,
            });

            return (
              <DictationModelRow
                key={model.id}
                model={model}
                selected={selected}
                pending={pendingModel === model.id}
                downloading={downloading}
                downloadProgress={progress}
                downloadBytesPerSecond={speed}
                readinessAvailable={readiness?.available === true}
                onApply={handleApply}
              />
            );
          })
        )}
      </View>
    </View>
  );
}

function DictationDownloadProgress({
  modelId,
  percent,
  bytesPerSecond,
}: {
  modelId: string;
  percent: number;
  bytesPerSecond: number;
}) {
  const { t } = useTranslation();
  const fillStyle = useMemo(
    () => [styles.dictationProgressFill, { width: `${percent}%` as `${number}%` }],
    [percent],
  );
  const speedLabel = formatDictationDownloadSpeed(bytesPerSecond);

  return (
    <View style={styles.dictationProgressWrap} testID={`dictation-model-progress-${modelId}`}>
      <View style={styles.dictationProgressTrack}>
        <View style={fillStyle} />
      </View>
      <View style={styles.dictationProgressMeta}>
        <Text style={styles.dictationProgressLabel}>{`${percent}%`}</Text>
        <Text style={styles.dictationProgressSpeed} numberOfLines={1}>
          {t("settings.host.dictation.downloadSpeed", { speed: speedLabel })}
        </Text>
      </View>
    </View>
  );
}

function DictationRunStatusPill({ state }: { state: DictationRunState }) {
  const { t } = useTranslation();
  const active = state === "running";
  const pillStyle = useMemo(
    () => [
      styles.dictationStatusPill,
      active ? styles.dictationStatusPillActive : styles.dictationStatusPillIdle,
    ],
    [active],
  );
  const textStyle = useMemo(
    () => [
      styles.dictationStatusPillText,
      active ? styles.dictationStatusPillTextActive : styles.dictationStatusPillTextIdle,
    ],
    [active],
  );

  return (
    <View style={pillStyle}>
      <Text style={textStyle}>{dictationRunStateLabel(t, state)}</Text>
    </View>
  );
}

function DictationInstalledTrailing({
  modelId,
  selected,
  readinessAvailable,
  onApply,
}: {
  modelId: string;
  selected: boolean;
  readinessAvailable: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const runState = resolveDictationRunState(selected, readinessAvailable);

  return (
    <View style={styles.dictationTrailingActions}>
      <DictationRunStatusPill state={runState} />
      {selected ? (
        <View style={styles.dictationAppliedBadge} accessibilityRole="text">
          <Check size={theme.iconSize.sm} color={theme.colors.foreground} />
          <Text style={styles.dictationAppliedText}>{t("settings.host.dictation.applied")}</Text>
        </View>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onPress={onApply}
          accessibilityLabel={t("settings.host.dictation.apply")}
          testID={`dictation-model-apply-${modelId}`}
        >
          {t("settings.host.dictation.apply")}
        </Button>
      )}
    </View>
  );
}

function DictationModelRow({
  model,
  selected,
  pending,
  downloading,
  downloadProgress,
  downloadBytesPerSecond,
  readinessAvailable,
  onApply,
}: {
  model: DictationModelInfo;
  selected: boolean;
  pending: boolean;
  downloading: boolean;
  downloadProgress: number | null;
  downloadBytesPerSecond: number;
  readinessAvailable: boolean;
  onApply: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const handleApply = useCallback(() => onApply(model.id), [onApply, model.id]);
  const optionStyle = useMemo(
    () => [styles.dictationOption, selected && styles.dictationOptionSelected],
    [selected],
  );
  const accessibilityState = selected
    ? ACCESSIBILITY_STATE_SELECTED
    : ACCESSIBILITY_STATE_UNSELECTED;

  const installed = model.installed || (selected && readinessAvailable && !downloading);
  const percent =
    downloadProgress === null ? null : Math.max(0, Math.min(100, Math.round(downloadProgress)));
  const showProgress = downloading || percent !== null;
  const runState = resolveDictationRunState(selected, readinessAvailable);
  const speedLabel = formatDictationDownloadSpeed(downloadBytesPerSecond);

  let statusText: string;
  if (showProgress) {
    if (percent === null) {
      statusText = t("settings.host.dictation.downloading");
    } else {
      statusText = t("settings.host.dictation.downloadingPercentWithSpeed", {
        percent,
        speed: speedLabel,
      });
    }
  } else if (!installed) {
    statusText = t("settings.host.dictation.notInstalled");
  } else {
    statusText = dictationRunStateLabel(t, runState);
  }

  let trailing: ReactNode = null;
  if (pending) {
    trailing = <ActivityIndicator color={theme.colors.foregroundMuted} />;
  } else if (showProgress) {
    trailing = (
      <DictationDownloadProgress
        modelId={model.id}
        percent={percent ?? 0}
        bytesPerSecond={downloadBytesPerSecond}
      />
    );
  } else if (!installed) {
    trailing = (
      <Button
        size="sm"
        variant="secondary"
        onPress={handleApply}
        accessibilityLabel={t("settings.host.dictation.download")}
        testID={`dictation-model-download-${model.id}`}
      >
        {t("settings.host.dictation.download")}
      </Button>
    );
  } else {
    trailing = (
      <DictationInstalledTrailing
        modelId={model.id}
        selected={selected}
        readinessAvailable={readinessAvailable}
        onApply={handleApply}
      />
    );
  }

  return (
    <View
      style={optionStyle}
      accessibilityState={accessibilityState}
      testID={`dictation-model-row-${model.id}`}
    >
      <View style={styles.dictationOptionContent}>
        <Text style={styles.dictationOptionTitle}>{cleanDictationLabel(model.description)}</Text>
        <View style={styles.dictationLangRow}>
          {model.languages.map((lang) => (
            <View key={lang} style={styles.dictationLangBadge}>
              <Text style={styles.dictationLangBadgeText}>{lang}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.dictationOptionStatus}>{statusText}</Text>
      </View>
      {trailing}
    </View>
  );
}

function AutoArchiveMergedWorkspacesCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ autoArchiveAfterMerge: next }).catch((error) => {
        console.error("[HostPage] Failed to update auto-archive after merge", error);
        Alert.alert(
          t("settings.host.workspaces.autoArchive.updateFailedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-auto-archive-merged-workspaces-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.workspaces.autoArchive.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.workspaces.autoArchive.hint")}
          </Text>
        </View>
        <Switch
          value={config?.autoArchiveAfterMerge === true}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.workspaces.autoArchive.title")}
          testID="host-page-auto-archive-merged-workspaces-switch"
        />
      </View>
    </View>
  );
}

function EnableTerminalAgentHooksCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ enableTerminalAgentHooks: next }).catch((error) => {
        console.error("[HostPage] Failed to update terminal agent hooks", error);
        Alert.alert(
          t("settings.host.terminalAgents.updateFailedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-terminal-agent-hooks-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.terminalAgents.enableTitle")}
          </Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.terminalAgents.enableHint")}</Text>
        </View>
        <Switch
          value={config?.enableTerminalAgentHooks === true}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.terminalAgents.enableTitle")}
          testID="host-page-terminal-agent-hooks-switch"
        />
      </View>
    </View>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.orchestration.systemPrompt.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save append system prompt", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-page-append-system-prompt-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.orchestration.systemPrompt.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.orchestration.systemPrompt.hint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-page-append-system-prompt-edit"
          >
            {t("settings.host.orchestration.systemPrompt.edit")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={t("settings.host.orchestration.systemPrompt.accessibilityLabel")}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("settings.host.orchestration.systemPrompt.placeholder")}
          />
          <View style={styles.appendPromptActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleReset}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-reset"
            >
              {t("settings.host.orchestration.systemPrompt.reset")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-save"
            >
              {isSaving
                ? t("settings.host.orchestration.systemPrompt.saving")
                : t("settings.host.orchestration.systemPrompt.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function PairDeviceRow() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <View style={settingsStyles.card}>
      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.pairDevices.rowTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.pairDevices.rowHint")}</Text>
        </View>
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <PairDeviceModal
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </View>
  );
}

function RemoveHostSection({
  host,
  isLocalDaemon,
  onRemoved,
}: {
  host: HostProfile;
  isLocalDaemon: boolean;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { removeHost } = useHostMutations();
  const { updateSettings } = useDesktopSettings();
  const { data: daemonStatusData, setStatus } = useDaemonStatus();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const daemonStatus = daemonStatusData?.status ?? null;
  const removeHostHeader = useMemo<SheetHeader>(
    () => ({
      title: isLocalDaemon
        ? t("settings.host.daemon.remove.localConfirmTitle")
        : t("settings.host.daemon.remove.title"),
    }),
    [isLocalDaemon, t],
  );

  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const rollbackLocalhostRemoval = useCallback(
    async (shouldRestartDaemon: boolean) => {
      await updateSettings({ daemon: { manageBuiltInDaemon: true } });
      if (!shouldRestartDaemon) {
        return;
      }
      setStatus(await startDesktopDaemon());
    },
    [setStatus, updateSettings],
  );
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    const remove = async () => {
      let didDisableDaemonManagement = false;
      let didStopDaemon = false;
      if (isLocalDaemon) {
        try {
          await updateSettings({ daemon: { manageBuiltInDaemon: false } });
          didDisableDaemonManagement = true;
          if (daemonStatus?.status === "running" && daemonStatus.desktopManaged) {
            setStatus(await stopDesktopDaemon("host_remove"));
            didStopDaemon = true;
          }
          await removeHost(host.serverId);
        } catch (error) {
          if (didDisableDaemonManagement) {
            try {
              await rollbackLocalhostRemoval(didStopDaemon);
            } catch (rollbackError) {
              console.error("[HostPage] Failed to roll back localhost removal", rollbackError);
            }
          }
          throw error;
        }
        return;
      }
      await removeHost(host.serverId);
    };
    void remove()
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to remove host", error);
        Alert.alert(
          t("settings.host.daemon.remove.errorTitle"),
          isLocalDaemon
            ? t("settings.host.daemon.remove.localErrorMessage")
            : t("settings.host.daemon.remove.errorMessage"),
        );
      })
      .finally(() => setIsRemoving(false));
  }, [
    daemonStatus,
    host.serverId,
    isLocalDaemon,
    onRemoved,
    removeHost,
    rollbackLocalhostRemoval,
    setStatus,
    t,
    updateSettings,
  ]);

  const removeIcon = useMemo(
    () => <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />,
    [theme.iconSize.sm, theme.colors.destructive],
  );

  return (
    <SettingsSection
      title={t("settings.host.daemon.dangerZone")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localTitle")
                : t("settings.host.daemon.remove.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localHint")
                : t("settings.host.daemon.remove.hint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={removeIcon}
            textStyle={destructiveTextStyle}
            onPress={handleOpenConfirm}
            testID="host-page-remove-host-button"
          >
            {t("settings.host.connections.removeAction")}
          </Button>
        </View>
      </View>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={removeHostHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-host-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {isLocalDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", { name: host.label })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancel}
              disabled={isRemoving}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemoving}
              testID="remove-host-confirm"
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Terminal Profiles
// ---------------------------------------------------------------------------

function generateProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function parseArgsString(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", command: "", args: "" };

interface TerminalProfileRowProps {
  profile: TerminalProfile;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TerminalProfileRow({
  profile,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TerminalProfileRowProps) {
  const { t } = useTranslation();

  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);

  const commandText =
    profile.args && profile.args.length > 0
      ? `${profile.command} ${profile.args.join(" ")}`
      : profile.command;

  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder, terminalProfileStyles.row],
    [isFirst],
  );

  const icon = getTerminalProfileIcon(profile);

  return (
    <View style={rowStyle} testID={`terminal-profile-row-${profile.id}`}>
      <View style={terminalProfileStyles.iconWrapper}>
        {icon ? (
          <ThemedDynamicProviderIcon
            iconKey={icon}
            size={ICON_SIZE.md}
            uniProps={mutedColorMapping}
          />
        ) : (
          <ThemedProfileSquareTerminal size={ICON_SIZE.md} uniProps={mutedColorMapping} />
        )}
      </View>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {profile.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {commandText}
        </Text>
      </View>
      <View style={terminalProfileStyles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.host.terminalProfiles.moveUp")}
          testID={`terminal-profile-move-up-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.host.terminalProfiles.moveDown")}
          testID={`terminal-profile-move-down-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editProfileIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.host.terminalProfiles.editProfile")}
          testID={`terminal-profile-edit-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeProfileIcon}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.terminalProfiles.remove")}
          testID={`terminal-profile-remove-${profile.id}`}
        />
      </View>
    </View>
  );
}

function TerminalProfilesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    draft: ProfileDraft;
  } | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const profiles = useMemo(
    () => (config ? resolveTerminalProfiles(config.terminalProfiles) : null),
    [config],
  );

  const saveProfiles = useCallback(
    async (next: TerminalProfile[]) => {
      await patchConfig({ terminalProfiles: next });
    },
    [patchConfig],
  );

  const handleAddOpen = useCallback(() => setIsAdding(true), []);
  const handleAddClose = useCallback(() => setIsAdding(false), []);

  const handleAddSave = useCallback(
    async (draft: ProfileDraft) => {
      const current = profiles ? [...profiles] : [];
      const next: TerminalProfile[] = [
        ...current,
        {
          id: generateProfileId(),
          name: draft.name,
          command: draft.command,
          args: parseArgsString(draft.args),
        },
      ];
      await saveProfiles(next);
      setIsAdding(false);
    },
    [profiles, saveProfiles],
  );

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      setEditingProfile({
        id,
        draft: {
          name: profile.name,
          command: profile.command,
          args: profile.args ? profile.args.join(" ") : "",
        },
      });
    },
    [profiles],
  );

  const handleEditClose = useCallback(() => setEditingProfile(null), []);

  const handleEditSave = useCallback(
    async (draft: ProfileDraft) => {
      if (!editingProfile || !profiles) return;
      const next: TerminalProfile[] = profiles.map((p) =>
        p.id === editingProfile.id
          ? {
              ...p,
              name: draft.name,
              command: draft.command,
              args: parseArgsString(draft.args),
            }
          : p,
      );
      await saveProfiles(next);
      setEditingProfile(null);
    },
    [editingProfile, profiles, saveProfiles],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      void confirmDialog({
        title: t("settings.host.terminalProfiles.removeConfirmTitle"),
        message: t("settings.host.terminalProfiles.removeConfirmMessage", {
          name: profile.name,
        }),
        confirmLabel: t("settings.host.terminalProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !profiles) return;
        try {
          await saveProfiles(profiles.filter((p) => p.id !== id));
        } catch (error) {
          Alert.alert(
            t("common.errors.unableToSave"),
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      });
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveUp = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index <= 0) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index - 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveDown = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index < 0 || index >= profiles.length - 1) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index + 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addProfileIcon}
        onPress={handleAddOpen}
        disabled={!isConnected || !profiles}
        testID="terminal-profiles-add-button"
      />
    ),
    [handleAddOpen, isConnected, profiles],
  );

  if (!isConnected) {
    return (
      <View style={TERMINAL_PROFILES_EMPTY_CARD_STYLE} testID="terminal-profiles-unavailable">
        <Text style={terminalProfileStyles.emptyText}>
          {t("settings.host.terminalProfiles.unavailable")}
        </Text>
      </View>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.terminalProfiles.sectionTitle")}
        trailing={addButton}
        testID="terminal-profiles-section"
      >
        <View style={settingsStyles.card} testID="terminal-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <TerminalProfileRow
                key={profile.id}
                profile={profile}
                isFirst={index === 0}
                isLast={index === profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={TERMINAL_PROFILES_EMPTY_CARD_STYLE}>
              <Text style={terminalProfileStyles.emptyText}>
                {t("settings.host.terminalProfiles.emptyState")}
              </Text>
            </View>
          )}
        </View>
      </SettingsSection>

      <TerminalProfileEditModal
        visible={isAdding}
        title={t("settings.host.terminalProfiles.addProfileTitle")}
        initialDraft={EMPTY_PROFILE_DRAFT}
        onClose={handleAddClose}
        onSave={handleAddSave}
        testID="terminal-profile-edit-modal"
      />

      {editingProfile ? (
        <TerminalProfileEditModal
          visible
          title={t("settings.host.terminalProfiles.editProfileTitle")}
          initialDraft={editingProfile.draft}
          onClose={handleEditClose}
          onSave={handleEditSave}
        />
      ) : null}
    </>
  );
}

export function HostTerminalsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <SettingsSection title={t("settings.host.terminalAgents.sectionTitle")}>
        <EnableTerminalAgentHooksCard serverId={serverId} />
      </SettingsSection>
      <TerminalProfilesSection serverId={serverId} />
    </View>
  );
}

const terminalProfileStyles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
    minHeight: 56,
  },
  iconWrapper: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

const styles = StyleSheet.create((theme) => ({
  dictationList: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[4],
  },
  dictationOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  dictationOptionSelected: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
  dictationOptionContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  dictationOptionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  dictationLangRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  dictationLangBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  dictationLangBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  dictationOptionStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  dictationTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  dictationProgressWrap: {
    width: 128,
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  dictationProgressTrack: {
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  dictationProgressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foreground,
  },
  dictationProgressMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
  },
  dictationProgressLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  dictationProgressSpeed: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  dictationStatusPill: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  dictationStatusPillActive: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
  dictationStatusPillIdle: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  dictationStatusPillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  dictationStatusPillTextActive: {
    color: theme.colors.foreground,
  },
  dictationStatusPillTextIdle: {
    color: theme.colors.foregroundMuted,
  },
  dictationAppliedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  dictationAppliedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  updateFailure: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  identityEditButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  daemonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[4],
  },
  daemonHeaderLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  identityBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    marginBottom: theme.spacing[6],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    maxWidth: 200,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginBottom: theme.spacing[2],
  },
  connectionLatency: {
    fontSize: theme.fontSize.sm,
    marginRight: theme.spacing[2],
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
  appendPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const FLEX_1_STYLE = { flex: 1 };
const EMPTY_CARD_STYLE = [settingsStyles.cardSurface, styles.emptyCard];
// Borderless rounded surface panels for the dictation model list and the
// terminal-profiles empty/unavailable states (hoisted so the JSX style prop
// isn't a fresh array each render).
const DICTATION_LIST_CARD_STYLE = [settingsStyles.cardSurface, styles.dictationList];
const TERMINAL_PROFILES_EMPTY_CARD_STYLE = [
  settingsStyles.cardSurface,
  terminalProfileStyles.emptyCard,
];
