import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Cable, Plus, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { Pressable } from "react-native";
import invariant from "tiny-invariant";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { getIsElectron } from "@/constants/platform";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { reconcilePortForwards, teardownAllPortForwards } from "@/runtime/port-forward-runtime";
import { usePortForwards } from "@/screens/workspace/port-forwards/use-port-forwards";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function usePortForwardsPanelDescriptor(
  _target: { kind: "port-forwards" },
  _context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("workspace.portForwards.title"),
    tooltip: t("workspace.portForwards.title"),
    subtitle: t("workspace.portForwards.subtitle"),
    titleState: "ready",
    icon: Cable,
    statusBucket: null,
  };
}

function PortForwardsPanel() {
  const { t } = useTranslation();
  const { serverId } = usePaneContext();
  invariant(serverId, "PortForwardsPanel requires a serverId");

  const client = useHostRuntimeClient(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.portForward === true,
  );
  const { forwards, createMutation, deleteMutation } = usePortForwards({ client, serverId });
  const isDesktop = getIsElectron();

  // Desktop only: keep the OS-level loopback listeners in sync with the synced
  // list. On web/native there is no main-process listener, so the list is
  // view/manage-only and forwards activate on whichever desktop client is open.
  useEffect(() => {
    if (!isDesktop || !client) {
      return;
    }
    void reconcilePortForwards({
      client,
      forwards: forwards.map((forward) => ({
        localPort: forward.localPort,
        remotePort: forward.remotePort,
      })),
    });
  }, [isDesktop, client, forwards]);

  useEffect(() => {
    return () => {
      if (isDesktop) {
        teardownAllPortForwards();
      }
    };
  }, [isDesktop]);

  const [localPort, setLocalPort] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [label, setLabel] = useState("");

  const parsedLocal = parsePort(localPort);
  const parsedRemote = parsePort(remotePort);
  const canSubmit =
    parsedLocal !== null && parsedRemote !== null && !createMutation.isPending && Boolean(client);

  const handleAdd = useCallback(() => {
    if (parsedLocal === null || parsedRemote === null) {
      return;
    }
    createMutation.mutate(
      {
        localPort: parsedLocal,
        remotePort: parsedRemote,
        label: label.trim() ? label.trim() : undefined,
      },
      {
        onSuccess: () => {
          setLocalPort("");
          setRemotePort("");
          setLabel("");
        },
      },
    );
  }, [createMutation, label, parsedLocal, parsedRemote]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const createErrorMessage = useMemo(() => {
    const error = createMutation.error;
    if (!error) {
      return null;
    }
    return error instanceof Error ? error.message : String(error);
  }, [createMutation.error]);

  if (!supported) {
    return (
      <View style={styles.centered} testID="workspace-port-forwards-panel">
        <Text style={styles.emptyText}>{t("workspace.portForwards.needsUpdate")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      testID="workspace-port-forwards-panel"
    >
      <Text style={styles.description}>{t("workspace.portForwards.description")}</Text>

      {!isDesktop ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{t("workspace.portForwards.desktopOnlyNotice")}</Text>
        </View>
      ) : null}

      <View style={styles.form}>
        <View style={styles.portInputs}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("workspace.portForwards.localPortLabel")}</Text>
            <ThemedTextInput
              style={styles.input}
              value={localPort}
              onChangeText={setLocalPort}
              placeholder={t("workspace.portForwards.localPortPlaceholder")}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              testID="workspace-port-forwards-local-input"
              uniProps={placeholderColorMapping}
            />
          </View>
          <View style={styles.arrowColumn}>
            <ThemedArrowRight size={16} uniProps={mutedColorMapping} />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("workspace.portForwards.remotePortLabel")}</Text>
            <ThemedTextInput
              style={styles.input}
              value={remotePort}
              onChangeText={setRemotePort}
              placeholder={t("workspace.portForwards.remotePortPlaceholder")}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              testID="workspace-port-forwards-remote-input"
              uniProps={placeholderColorMapping}
            />
          </View>
        </View>
        <ThemedTextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder={t("workspace.portForwards.labelPlaceholder")}
          maxLength={64}
          testID="workspace-port-forwards-label-input"
          uniProps={placeholderColorMapping}
        />
        <AddButton
          onPress={handleAdd}
          disabled={!canSubmit}
          label={t("workspace.portForwards.addButton")}
        />
        {createErrorMessage ? <Text style={styles.errorText}>{createErrorMessage}</Text> : null}
      </View>

      {forwards.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t("workspace.portForwards.empty")}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {forwards.map((forward) => (
            <View
              key={forward.id}
              style={styles.row}
              testID={`workspace-port-forward-${forward.id}`}
            >
              <View style={styles.rowMain}>
                <View style={styles.rowPorts}>
                  <Text style={styles.portText}>localhost:{forward.localPort}</Text>
                  <ThemedArrowRight size={14} uniProps={mutedColorMapping} />
                  <Text style={styles.portText}>:{forward.remotePort}</Text>
                </View>
                {forward.label ? <Text style={styles.rowLabel}>{forward.label}</Text> : null}
              </View>
              <Text style={isDesktop ? styles.statusActive : styles.statusInactive}>
                {isDesktop
                  ? t("workspace.portForwards.statusActive")
                  : t("workspace.portForwards.statusDesktopOnly")}
              </Text>
              <DeleteButton
                id={forward.id}
                onDelete={handleDelete}
                disabled={deleteMutation.isPending}
                accessibilityLabel={t("workspace.portForwards.deleteLabel")}
                testID={`workspace-port-forward-delete-${forward.id}`}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function AddButton({
  onPress,
  disabled,
  label,
}: {
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.addButton,
      disabled && styles.addButtonDisabled,
      pressed && !disabled && styles.addButtonPressed,
    ],
    [disabled],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={buttonStyle}
      accessibilityRole="button"
      testID="workspace-port-forwards-add"
    >
      <ThemedPlus size={16} uniProps={onAccentColorMapping} />
      <Text style={styles.addButtonText}>{label}</Text>
    </Pressable>
  );
}

function DeleteButton({
  id,
  onDelete,
  disabled,
  accessibilityLabel,
  testID,
}: {
  id: string;
  onDelete: (id: string) => void;
  disabled: boolean;
  accessibilityLabel: string;
  testID: string;
}) {
  const handlePress = useCallback(() => {
    onDelete(id);
  }, [id, onDelete]);
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.deleteButton,
      pressed && styles.deleteButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={buttonStyle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <ThemedTrash2 size={16} uniProps={mutedColorMapping} />
    </Pressable>
  );
}

export const portForwardsPanelRegistration: PanelRegistration<"port-forwards"> = {
  kind: "port-forwards",
  component: PortForwardsPanel,
  useDescriptor: usePortForwardsPanelDescriptor,
};

const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedPlus = withUnistyles(Plus);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedTextInput = withUnistyles(TextInput);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const onAccentColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const placeholderColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  description: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
  },
  noticeCard: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  noticeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  form: {
    gap: theme.spacing[2],
  },
  portInputs: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  field: {
    flex: 1,
    gap: theme.spacing[1],
  },
  fieldLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  arrowColumn: {
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonPressed: {
    opacity: 0.85,
  },
  addButtonText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.accentForeground,
  },
  list: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  rowMain: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowPorts: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  portText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  statusActive: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.green[500],
  },
  statusInactive: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  deleteButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  deleteButtonPressed: {
    opacity: 0.7,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: theme.spacing[6],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.red[500],
  },
}));
