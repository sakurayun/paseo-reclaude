import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSshForwards } from "@/screens/ssh/use-ssh-forwards";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import type { SshForwardInfo, SshForwardRuntime, SshHostInfo } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

type ForwardType = "local" | "remote" | "dynamic";

interface SshForwardsSectionProps {
  serverId: string | null;
}

export function SshForwardsSection({ serverId }: SshForwardsSectionProps) {
  const { t } = useTranslation();
  const { forwards, runtimeById, deleteForward, startForward, stopForward } =
    useSshForwards(serverId);
  const { hosts } = useSshHosts(serverId);
  const [creating, setCreating] = useState(false);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);

  return (
    <View style={styles.section}>
      <View style={styles.toolbar}>
        <Button variant="secondary" onPress={openCreate} testID="ssh-new-forward">
          {t("ssh.forwards.newForward")}
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {forwards.length === 0 ? (
          <Text style={styles.empty}>{t("ssh.forwards.empty")}</Text>
        ) : (
          forwards.map((forward) => (
            <ForwardCard
              key={forward.id}
              forward={forward}
              runtime={runtimeById.get(forward.id) ?? null}
              onStart={startForward}
              onStop={stopForward}
              onDelete={deleteForward}
            />
          ))
        )}
      </ScrollView>
      {creating ? (
        <NewForwardSheet serverId={serverId} hosts={hosts} onClose={closeCreate} />
      ) : null}
    </View>
  );
}

function ForwardCard({
  forward,
  runtime,
  onStart,
  onStop,
  onDelete,
}: {
  forward: SshForwardInfo;
  runtime: SshForwardRuntime | null;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const status = runtime?.status ?? "stopped";
  const isActive = status === "active";
  const handleToggle = useCallback(() => {
    void (isActive ? onStop(forward.id) : onStart(forward.id));
  }, [isActive, onStart, onStop, forward.id]);
  const handleDelete = useCallback(() => void onDelete(forward.id), [onDelete, forward.id]);
  const summary = useMemo(() => summarizeForward(forward), [forward]);

  return (
    <View style={styles.card}>
      <View style={statusDotStyle(status)} />
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {forward.label || summary}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {summary} · {statusLabel(status, t)}
        </Text>
      </View>
      <Button variant="secondary" size="sm" onPress={handleToggle}>
        {isActive ? t("ssh.forwards.stop") : t("ssh.forwards.start")}
      </Button>
      <Pressable onPress={handleDelete} accessibilityRole="button" style={styles.deleteButton}>
        <Text style={styles.deleteLabel}>×</Text>
      </Pressable>
    </View>
  );
}

function NewForwardSheet({
  serverId,
  hosts,
  onClose,
}: {
  serverId: string | null;
  hosts: SshHostInfo[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const controlSize = useIsCompactFormFactor() ? "md" : "sm";
  const { createForward, isSaving } = useSshForwards(serverId);
  const [hostId, setHostId] = useState<string | null>(hosts[0]?.id ?? null);
  const [forwardType, setForwardType] = useState<ForwardType>("local");
  const [label, setLabel] = useState("");
  const [listenPort, setListenPort] = useState("");
  const [bindAddress, setBindAddress] = useState("127.0.0.1");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("");

  const typeOptions = useMemo(
    () => [
      { value: "local" as const, label: t("ssh.forwards.typeLocal") },
      { value: "remote" as const, label: t("ssh.forwards.typeRemote") },
      { value: "dynamic" as const, label: t("ssh.forwards.typeDynamic") },
    ],
    [t],
  );
  const hostOptions = useMemo<SelectFieldOption<string>[]>(
    () => hosts.map((host) => ({ id: host.id, value: host.id, label: host.label || host.address })),
    [hosts],
  );
  const selectedHostDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const host = hosts.find((entry) => entry.id === hostId);
    return host ? { label: host.label || host.address } : null;
  }, [hosts, hostId]);
  const handleHost = useCallback((value: string) => setHostId(value), []);

  const canSubmit = hostId !== null && Number(listenPort) > 0;
  const showTarget = forwardType !== "dynamic";

  const handleSubmit = useCallback(async () => {
    if (!hostId || !canSubmit) {
      return;
    }
    await createForward({
      hostId,
      forwardType,
      listenPort: Number(listenPort),
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(bindAddress.trim() ? { bindAddress: bindAddress.trim() } : {}),
      ...(showTarget && targetHost.trim() ? { targetHost: targetHost.trim() } : {}),
      ...(showTarget && Number(targetPort) > 0 ? { targetPort: Number(targetPort) } : {}),
    });
    onClose();
  }, [
    hostId,
    canSubmit,
    createForward,
    forwardType,
    listenPort,
    label,
    bindAddress,
    showTarget,
    targetHost,
    targetPort,
    onClose,
  ]);
  const handleSubmitPress = useCallback(() => void handleSubmit(), [handleSubmit]);

  const header = useMemo<SheetHeader>(() => ({ title: t("ssh.forwards.newForward") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" style={styles.footerButton} onPress={onClose}>
          {t("ssh.form.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={isSaving}
          testID="ssh-forward-submit"
        >
          {t("ssh.form.save")}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, isSaving, onClose, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      testID="ssh-forward-sheet"
    >
      <View style={styles.form}>
        <Field label={t("ssh.forwards.type")}>
          <SegmentedControl
            options={typeOptions}
            value={forwardType}
            onValueChange={setForwardType}
          />
        </Field>
        <SelectField
          label={t("ssh.sections.hosts")}
          value={hostId}
          selectedDisplay={selectedHostDisplay}
          options={hostOptions}
          onChange={handleHost}
          placeholder={t("ssh.sections.hosts")}
          emptyText={t("ssh.hosts.empty")}
          searchable
          title={t("ssh.sections.hosts")}
          size={controlSize}
        />
        <Field label={t("ssh.forwards.label")}>
          <FormTextInput
            size={controlSize}
            initialValue={label}
            value={label}
            onChangeText={setLabel}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label={t("ssh.forwards.bindAddress")}>
          <FormTextInput
            size={controlSize}
            initialValue={bindAddress}
            value={bindAddress}
            onChangeText={setBindAddress}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label={t("ssh.forwards.listenPort")}>
          <FormTextInput
            size={controlSize}
            initialValue={listenPort}
            value={listenPort}
            onChangeText={setListenPort}
            keyboardType="number-pad"
            testID="ssh-forward-listen-port"
          />
        </Field>
        {showTarget ? (
          <>
            <Field label={t("ssh.forwards.targetHost")}>
              <FormTextInput
                size={controlSize}
                initialValue={targetHost}
                value={targetHost}
                onChangeText={setTargetHost}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>
            <Field label={t("ssh.forwards.targetPort")}>
              <FormTextInput
                size={controlSize}
                initialValue={targetPort}
                value={targetPort}
                onChangeText={setTargetPort}
                keyboardType="number-pad"
              />
            </Field>
          </>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function summarizeForward(forward: SshForwardInfo): string {
  const bind = forward.bindAddress ?? "127.0.0.1";
  if (forward.forwardType === "dynamic") {
    return `SOCKS ${bind}:${forward.listenPort}`;
  }
  const target = `${forward.targetHost ?? "127.0.0.1"}:${forward.targetPort ?? forward.listenPort}`;
  return forward.forwardType === "local"
    ? `${bind}:${forward.listenPort} → ${target}`
    : `${target} → ${bind}:${forward.listenPort}`;
}

function statusLabel(status: SshForwardRuntime["status"], t: (key: string) => string): string {
  switch (status) {
    case "active":
      return t("ssh.forwards.statusActive");
    case "starting":
      return t("ssh.forwards.statusStarting");
    case "error":
      return t("ssh.forwards.statusError");
    default:
      return t("ssh.forwards.statusStopped");
  }
}

const styles = StyleSheet.create((theme: Theme) => ({
  section: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    padding: theme.spacing[3],
  },
  list: {
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.sm,
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  cardSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  deleteButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteLabel: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
  },
  form: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  footer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  statusStopped: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusStarting: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.statusWarning,
  },
  statusActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.statusSuccess,
  },
  statusError: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.statusDanger,
  },
}));

function statusDotStyle(status: SshForwardRuntime["status"]) {
  switch (status) {
    case "active":
      return styles.statusActive;
    case "starting":
      return styles.statusStarting;
    case "error":
      return styles.statusError;
    default:
      return styles.statusStopped;
  }
}
