import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useReclaude } from "./use-reclaude";

type Step = "credentials" | "mfa";

export function ReclaudeLoginModal({
  serverId,
  visible,
  onClose,
  onSuccess,
}: {
  serverId: string;
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const { login, verifyMfa } = useReclaude(serverId);

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep("credentials");
    setEmail("");
    setPassword("");
    setCode("");
    setChallengeToken(null);
    setError(null);
    setPending(false);
  }, [visible]);

  const handleCancel = useCallback(() => {
    if (pending) return;
    onClose();
  }, [pending, onClose]);

  const submitCredentials = useCallback(async () => {
    if (pending) return;
    if (!email.trim() || !password) {
      setError(t("providerUsage.reclaude.missingCredentials"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await login({ email: email.trim(), password });
      if (result.step === "mfa_required") {
        setChallengeToken(result.mfaChallengeToken);
        setStep("mfa");
        setPending(false);
        return;
      }
      setPending(false);
      onSuccess?.();
      onClose();
    } catch (err) {
      setPending(false);
      setError(
        err instanceof Error && err.message ? err.message : t("providerUsage.reclaude.loginError"),
      );
    }
  }, [pending, email, password, login, onSuccess, onClose, t]);

  const submitMfa = useCallback(async () => {
    if (pending || !challengeToken) return;
    if (!code.trim()) {
      setError(t("providerUsage.reclaude.missingCode"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await verifyMfa({ challengeToken, code: code.trim() });
      setPending(false);
      onSuccess?.();
      onClose();
    } catch (err) {
      setPending(false);
      setError(
        err instanceof Error && err.message ? err.message : t("providerUsage.reclaude.loginError"),
      );
    }
  }, [pending, challengeToken, code, verifyMfa, onSuccess, onClose, t]);

  const handleSubmit = useCallback(() => {
    void (step === "mfa" ? submitMfa() : submitCredentials());
  }, [step, submitMfa, submitCredentials]);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title:
        step === "mfa"
          ? t("providerUsage.reclaude.mfaTitle")
          : t("providerUsage.reclaude.loginTitle"),
    }),
    [step, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleCancel}
      header={sheetHeader}
      testID="reclaude-login-modal"
    >
      <View style={styles.body}>
        {step === "credentials" ? (
          <>
            <Text style={styles.label}>{t("providerUsage.reclaude.emailLabel")}</Text>
            <AdaptiveTextInput
              initialValue=""
              onChangeText={setEmail}
              placeholder={t("providerUsage.reclaude.emailPlaceholder")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              style={styles.input}
              testID="reclaude-login-email"
            />
            <Text style={styles.label}>{t("providerUsage.reclaude.passwordLabel")}</Text>
            <AdaptiveTextInput
              initialValue=""
              onChangeText={setPassword}
              placeholder={t("providerUsage.reclaude.passwordPlaceholder")}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              onSubmitEditing={handleSubmit}
              style={styles.input}
              testID="reclaude-login-password"
            />
          </>
        ) : (
          <>
            <Text style={styles.hint}>{t("providerUsage.reclaude.mfaHint")}</Text>
            <Text style={styles.label}>{t("providerUsage.reclaude.mfaCodeLabel")}</Text>
            <AdaptiveTextInput
              initialValue=""
              onChangeText={setCode}
              placeholder={t("providerUsage.reclaude.mfaCodePlaceholder")}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              onSubmitEditing={handleSubmit}
              style={styles.input}
              testID="reclaude-login-mfa-code"
            />
          </>
        )}

        {error ? (
          <Text style={styles.errorText} testID="reclaude-login-error">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={handleCancel}
            disabled={pending}
            testID="reclaude-login-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.actionButton}
            onPress={handleSubmit}
            disabled={pending}
            loading={pending}
            testID="reclaude-login-submit"
          >
            {step === "mfa"
              ? t("providerUsage.reclaude.mfaSubmit")
              : t("providerUsage.reclaude.submit")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[1],
  },
  input: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    // borderless card (new theme)
    ...theme.shadow.sm,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
