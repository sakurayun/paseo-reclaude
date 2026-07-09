import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  NEW_THEME_HEADER_HEIGHT_DESKTOP,
} from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSshKeys } from "@/screens/ssh/use-ssh-keys";
import { useConnectSshHost } from "@/screens/ssh/use-connect-ssh-host";
import { SshFingerprintMismatchDialog } from "@/components/ssh/ssh-fingerprint-mismatch-dialog";
import { SshHostsSection } from "@/screens/ssh/ssh-hosts-section";
import { SshKeychainSection } from "@/screens/ssh/ssh-keychain-section";
import { SshForwardsSection } from "@/screens/ssh/ssh-forwards-section";
import { SshKnownHostsSection } from "@/screens/ssh/ssh-known-hosts-section";
import { SshLogsSection } from "@/screens/ssh/ssh-logs-section";
import { SshHostFormSheet, type SshHostFormRequest } from "@/components/ssh/ssh-host-form-sheet";
import type { SshHostSubmitPayload } from "@/ssh/ssh-host-form-model";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { isSshSection, type SshSection } from "@/screens/ssh/ssh-navigation";
import type { Theme } from "@/styles/theme";

// Main-panel screen for the SSH manager. Connecting to a host opens its
// terminal as a tab in the active workspace's tab bar (not in this page), so
// this screen only ever renders the management sections.
export function SshScreen() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ section?: string }>();
  const hosts = useHosts();
  const serverId = useMemo(
    () => parseServerIdFromPathname(pathname) ?? hosts[0]?.serverId ?? null,
    [hosts, pathname],
  );

  const section: SshSection = isSshSection(params.section) ? params.section : "hosts";
  const {
    hosts: sshHosts,
    groups,
    isLoading,
    createHost,
    updateHost,
    isSaving,
  } = useSshHosts(serverId);
  const { keys } = useSshKeys(serverId);
  const { connectHost, connectingHostId, mismatch, trustAndReconnect, closeMismatch } =
    useConnectSshHost(serverId);
  const [formRequest, setFormRequest] = useState<SshHostFormRequest | null>(null);

  const chainCandidates = useMemo(
    () => sshHosts.map((host) => ({ id: host.id, label: host.label || host.address })),
    [sshHosts],
  );

  const trustAndReconnectPress = useCallback(() => void trustAndReconnect(), [trustAndReconnect]);

  const editHost = useCallback(
    (hostId: string) => {
      const host = sshHosts.find((entry) => entry.id === hostId);
      if (host) {
        setFormRequest({ mode: "edit", host });
      }
    },
    [sshHosts],
  );

  const newHost = useCallback(() => setFormRequest({ mode: "create" }), []);
  const closeForm = useCallback(() => setFormRequest(null), []);

  const submitForm = useCallback(
    async (request: SshHostFormRequest, payload: SshHostSubmitPayload) => {
      if (request.mode === "edit" && request.host) {
        await updateHost(request.host.id, payload);
      } else {
        await createHost(payload);
      }
    },
    [createHost, updateHost],
  );

  const headerRight = useMemo(
    () =>
      section === "hosts" ? (
        <Pressable onPress={newHost} accessibilityRole="button" testID="ssh-new-host">
          <Text style={styles.newHostLabel}>+ {t("ssh.hosts.newHost")}</Text>
        </Pressable>
      ) : undefined,
    [section, newHost, t],
  );

  return (
    <View style={styles.screen}>
      <MenuHeader
        title={t(`ssh.sections.${sectionTitleKey(section)}`)}
        rightContent={headerRight}
        surfaceStyle={styles.headerSurface}
        rowStyle={styles.headerRow}
      />
      <View style={styles.card}>
        <SshSectionContent
          section={section}
          serverId={serverId}
          hosts={sshHosts}
          isLoading={isLoading}
          connectingHostId={connectingHostId}
          onConnect={connectHost}
          onEdit={editHost}
        />
      </View>
      <SshHostFormSheet
        request={formRequest}
        groups={groups}
        keys={keys}
        chainCandidates={chainCandidates}
        isSaving={isSaving}
        onSubmit={submitForm}
        onClose={closeForm}
      />
      <SshFingerprintMismatchDialog
        observedKey={mismatch?.key ?? null}
        isBusy={connectingHostId !== null}
        onTrust={trustAndReconnectPress}
        onClose={closeMismatch}
      />
    </View>
  );
}

// Renders the active section's body. Connecting to a host opens a workspace
// terminal tab and navigates there, so the hosts section only ever shows the
// host grid.
function SshSectionContent({
  section,
  serverId,
  hosts,
  isLoading,
  connectingHostId,
  onConnect,
  onEdit,
}: {
  section: SshSection;
  serverId: string | null;
  hosts: SshHostInfo[];
  isLoading: boolean;
  connectingHostId: string | null;
  onConnect: (hostId: string) => void;
  onEdit: (hostId: string) => void;
}) {
  if (section === "keychain") {
    return <SshKeychainSection serverId={serverId} />;
  }
  if (section === "forwards") {
    return <SshForwardsSection serverId={serverId} />;
  }
  if (section === "knownhosts") {
    return <SshKnownHostsSection serverId={serverId} />;
  }
  if (section === "logs") {
    return <SshLogsSection serverId={serverId} />;
  }
  return (
    <ScrollView style={styles.hostsScroll} contentContainerStyle={styles.hostsContent}>
      <SshHostsSection
        hosts={hosts}
        isLoading={isLoading}
        connectingHostId={connectingHostId}
        onConnect={onConnect}
        onEdit={onEdit}
      />
    </ScrollView>
  );
}

function sectionTitleKey(section: SshSection): string {
  switch (section) {
    case "keychain":
      return "keychain";
    case "forwards":
      return "forwards";
    case "knownhosts":
      return "knownHosts";
    case "logs":
      return "logs";
    default:
      return "hosts";
  }
}

const styles = StyleSheet.create((theme: Theme) => ({
  // Three-layer new-theme shell mirroring the workspace/settings screens: the
  // #fafafa underlay (surfaceShell) holds an exposed borderless header above a
  // floating white content card (surfaceWorkspace). Classic themes collapse the
  // tokens (surfaceShell == surface0, contentMargin/radius == 0) so the pane
  // stays visually unchanged.
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceShell,
  },
  headerSurface: {
    backgroundColor: theme.colors.surfaceShell,
  },
  headerRow: {
    borderBottomWidth: theme.shell.chromeDivider,
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: theme.shell.floating ? NEW_THEME_HEADER_HEIGHT_DESKTOP : HEADER_INNER_HEIGHT,
    },
  },
  card: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
    marginTop: 0,
    marginHorizontal: theme.shell.contentMargin,
    marginBottom: theme.shell.contentMargin,
    borderRadius: theme.shell.contentRadius,
    overflow: theme.shell.contentOverflow,
  },
  hostsScroll: {
    flex: 1,
  },
  hostsContent: {
    flexGrow: 1,
  },
  newHostLabel: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
