import { useCallback, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import type { SshHostGroup, SshHostInfo, SshKeyInfo } from "@getpaseo/protocol/messages";
import { useSshHostFormModel } from "@/ssh/use-ssh-host-form-model";
import type { SshHostFormSnapshot, SshHostSubmitPayload } from "@/ssh/ssh-host-form-model";
import { SshHostForm } from "./ssh-host-form";
import type { Theme } from "@/styles/theme";

export interface SshHostFormRequest {
  mode: "create" | "edit";
  host?: SshHostInfo;
}

interface SshHostFormSheetProps {
  request: SshHostFormRequest | null;
  groups: readonly SshHostGroup[];
  keys: readonly SshKeyInfo[];
  chainCandidates: readonly { id: string; label: string }[];
  isSaving: boolean;
  onSubmit: (request: SshHostFormRequest, payload: SshHostSubmitPayload) => Promise<void>;
  onClose: () => void;
}

// Outer layer: mounts a fresh form (keyed by mode + host id) when a request is
// present, else renders nothing. Mirrors the schedule form sheet's lifecycle.
export function SshHostFormSheet({
  request,
  groups,
  keys,
  chainCandidates,
  isSaving,
  onSubmit,
  onClose,
}: SshHostFormSheetProps) {
  if (!request) {
    return null;
  }
  return (
    <OpenSshHostFormSheet
      key={`${request.mode}:${request.host?.id ?? "new"}`}
      request={request}
      groups={groups}
      keys={keys}
      chainCandidates={chainCandidates}
      isSaving={isSaving}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
}

function OpenSshHostFormSheet({
  request,
  groups,
  keys,
  chainCandidates,
  isSaving,
  onSubmit,
  onClose,
}: SshHostFormSheetProps & { request: SshHostFormRequest }): ReactElement {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const snapshot = useMemo<SshHostFormSnapshot>(
    () => ({
      mode: request.mode,
      ...(request.host ? { host: request.host } : {}),
      groups,
      keys,
      chainCandidates,
    }),
    [request.mode, request.host, groups, keys, chainCandidates],
  );
  const model = useSshHostFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const [submitting, setSubmitting] = useState(false);

  const header = useMemo<SheetHeader>(
    () => ({ title: request.mode === "edit" ? t("ssh.hosts.edit") : t("ssh.hosts.newHost") }),
    [request.mode, t],
  );

  const handleSubmit = useCallback(async () => {
    if (!state.canSubmit) {
      return;
    }
    setSubmitting(true);
    model.setSubmitError(null);
    try {
      await onSubmit(request, model.buildSubmitPayload());
      onClose();
    } catch (error) {
      model.setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [state.canSubmit, model, onSubmit, request, onClose]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const busy = submitting || isSaving;

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button style={styles.footerButton} variant="secondary" onPress={onClose} disabled={busy}>
          {t("ssh.form.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!state.canSubmit}
          loading={busy}
          testID="ssh-host-form-submit"
        >
          {t("ssh.form.save")}
        </Button>
      </View>
    ),
    [busy, handleSubmitPress, onClose, state.canSubmit, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      webScrollbar
      testID="ssh-host-form-sheet"
    >
      <SshHostForm model={model} state={state} controlSize={controlSize} />
      {state.submitError ? <SubmitError message={state.submitError} /> : null}
    </AdaptiveModalSheet>
  );
}

function SubmitError({ message }: { message: string }) {
  return (
    <View style={styles.errorRow} testID="ssh-host-form-error">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  footer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  errorRow: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
}));
