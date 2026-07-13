import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import type {
  SshHostFormEnvEntry,
  SshHostFormModel,
  SshHostFormState,
  ProxyType,
} from "@/ssh/ssh-host-form-model";
import type { Theme } from "@/styles/theme";

interface SshHostFormProps {
  model: SshHostFormModel;
  state: SshHostFormState;
  controlSize: FieldControlSize;
}

const CHARSET_OPTIONS = ["utf-8", "gbk", "big5", "shift_jis", "euc-kr", "latin1"];
const PROXY_TYPES: ProxyType[] = ["http", "socks4", "socks5"];

export function SshHostForm({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.form}>
      <SectionTitle title={t("ssh.form.addressSection")} />
      <Field label={t("ssh.form.address")}>
        <FormTextInput
          size={controlSize}
          initialValue={state.address}
          value={state.address}
          onChangeText={model.setAddress}
          placeholder="10.0.0.1"
          autoCapitalize="none"
          autoCorrect={false}
          testID="ssh-host-address"
        />
      </Field>
      <Field label={t("ssh.form.port")}>
        <FormTextInput
          size={controlSize}
          initialValue={state.port}
          value={state.port}
          onChangeText={model.setPort}
          placeholder="22"
          keyboardType="number-pad"
          testID="ssh-host-port"
        />
      </Field>

      <SectionTitle title={t("ssh.form.generalSection")} />
      <Field label={t("ssh.form.label")}>
        <FormTextInput
          size={controlSize}
          initialValue={state.label}
          value={state.label}
          onChangeText={model.setLabel}
          placeholder={state.address || t("ssh.form.label")}
          autoCapitalize="none"
          autoCorrect={false}
          testID="ssh-host-label"
        />
      </Field>
      <GroupField model={model} state={state} controlSize={controlSize} />
      <TagsField model={model} state={state} controlSize={controlSize} />

      <SectionTitle title={t("ssh.form.credentialsSection")} />
      <Field label={t("ssh.form.username")}>
        <FormTextInput
          size={controlSize}
          initialValue={state.username}
          value={state.username}
          onChangeText={model.setUsername}
          placeholder="root"
          autoCapitalize="none"
          autoCorrect={false}
          testID="ssh-host-username"
        />
      </Field>
      {state.disclosure.showPasswordField ? (
        <Field label={t("ssh.form.password")}>
          <FormTextInput
            size={controlSize}
            initialValue={state.password}
            value={state.password}
            onChangeText={model.setPassword}
            placeholder={state.mode === "edit" ? "••••••••" : ""}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID="ssh-host-password"
          />
        </Field>
      ) : null}
      <KeyField model={model} state={state} controlSize={controlSize} />
      <ToggleRow
        label={t("ssh.form.useFido2")}
        value={state.useFido2}
        onValueChange={model.setUseFido2}
      />
      {state.disclosure.showFido2Notice ? <Notice text={t("ssh.form.fido2Notice")} /> : null}
      {/*
        SSH agent options (not Paseo AI agents):
        - useAgent: authenticate with identities from the local ssh-agent
          ($SSH_AUTH_SOCK / Windows OpenSSH pipe), optionally alongside a
          selected key file or password.
        - agentForwarding: OpenSSH ForwardAgent (-A). After login, the remote
          session can use the *local* agent for further ssh/git without copying
          private keys. Independent of useAgent; still requires a local agent.
      */}
      <ToggleRow
        label={t("ssh.form.useAgent")}
        description={t("ssh.form.useAgentHint")}
        value={state.useAgent}
        onValueChange={model.setUseAgent}
        testID="ssh-host-use-agent"
      />
      <ToggleRow
        label={t("ssh.form.agentForwarding")}
        description={t("ssh.form.agentForwardingHint")}
        value={state.agentForwarding}
        onValueChange={model.setAgentForwarding}
        testID="ssh-host-agent-forwarding"
      />
      {state.disclosure.showAgentForwardingNotice ? (
        <Notice text={t("ssh.form.agentForwardingNotice")} />
      ) : null}

      <SectionTitle title={t("ssh.form.connectionSection")} />
      <ChainField model={model} state={state} controlSize={controlSize} />
      <ProxyFields model={model} state={state} controlSize={controlSize} />
      <ToggleRow
        label={t("ssh.form.mosh")}
        value={state.moshEnabled}
        onValueChange={model.setMoshEnabled}
      />
      {state.disclosure.showMoshNotice ? <Notice text={t("ssh.form.moshNotice")} /> : null}

      <SectionTitle title={t("ssh.form.terminalSection")} />
      <BackspaceField model={model} state={state} />
      <CharsetField model={model} state={state} controlSize={controlSize} />
      <Field label={t("ssh.form.startupSnippet")}>
        <FormTextInput
          size={controlSize}
          initialValue={state.startupSnippet}
          value={state.startupSnippet}
          onChangeText={model.setStartupSnippet}
          placeholder="export TERM=xterm-256color"
          style={styles.multiline}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
      <EnvFields model={model} state={state} controlSize={controlSize} />
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function Notice({ text }: { text: string }) {
  return <Text style={styles.notice}>{text}</Text>;
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  testID,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
}) {
  return (
    <View style={styles.toggleBlock}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Switch
          value={value}
          onValueChange={onValueChange}
          accessibilityLabel={label}
          testID={testID}
        />
      </View>
      {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
    </View>
  );
}

function GroupField({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string | null>[]>(
    () => [
      { id: "__none__", value: null, label: t("ssh.form.keyNone") },
      ...state.groups.map((group) => ({ id: group.id, value: group.id, label: group.name })),
    ],
    [state.groups, t],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const group = state.groups.find((entry) => entry.id === state.groupId);
    return group ? { label: group.name } : null;
  }, [state.groups, state.groupId]);
  const handleChange = useCallback((value: string | null) => model.setGroup(value), [model]);
  return (
    <SelectField
      label={t("ssh.form.parentGroup")}
      value={state.groupId}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder={t("ssh.form.keyNone")}
      emptyText={t("ssh.form.keyNone")}
      searchable={false}
      title={t("ssh.form.parentGroup")}
      size={controlSize}
    />
  );
}

function KeyField({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string | null>[]>(
    () => [
      { id: "__none__", value: null, label: t("ssh.form.keyNone") },
      ...state.keys.map((key) => ({
        id: key.id,
        value: key.id,
        label: key.label,
        description: key.keyType,
      })),
    ],
    [state.keys, t],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const key = state.keys.find((entry) => entry.id === state.keyId);
    return key ? { label: key.label, description: key.keyType } : null;
  }, [state.keys, state.keyId]);
  const handleChange = useCallback((value: string | null) => model.setKey(value), [model]);
  return (
    <SelectField
      label={t("ssh.form.key")}
      value={state.keyId}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder={t("ssh.form.keyNone")}
      emptyText={t("ssh.form.keyNone")}
      searchable
      title={t("ssh.form.key")}
      size={controlSize}
    />
  );
}

function CharsetField({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(
    () => CHARSET_OPTIONS.map((charset) => ({ id: charset, value: charset, label: charset })),
    [],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: state.charset }),
    [state.charset],
  );
  const handleChange = useCallback((value: string) => model.setCharset(value), [model]);
  return (
    <SelectField
      label={t("ssh.form.charset")}
      value={state.charset}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder="utf-8"
      emptyText="utf-8"
      searchable={false}
      title={t("ssh.form.charset")}
      size={controlSize}
    />
  );
}

function BackspaceField({ model, state }: { model: SshHostFormModel; state: SshHostFormState }) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { value: "del" as const, label: t("ssh.form.backspaceDel") },
      { value: "ctrl-h" as const, label: t("ssh.form.backspaceCtrlH") },
    ],
    [t],
  );
  return (
    <Field label={t("ssh.form.backspace")}>
      <SegmentedControl
        options={options}
        value={state.backspaceMode}
        onValueChange={model.setBackspaceMode}
      />
    </Field>
  );
}

function TagsField({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const handleSubmit = useCallback(
    (event: { nativeEvent: { text: string } }) => {
      model.addTag(event.nativeEvent.text);
    },
    [model],
  );
  return (
    <Field label={t("ssh.form.tags")}>
      <View style={styles.chipRow}>
        {state.tags.map((tag) => (
          <Chip key={tag} label={tag} value={tag} onRemove={model.removeTag} />
        ))}
      </View>
      <FormTextInput
        size={controlSize}
        placeholder={t("ssh.form.tags")}
        onSubmitEditing={handleSubmit}
        blurOnSubmit={false}
        autoCapitalize="none"
        autoCorrect={false}
        testID="ssh-host-tag-input"
      />
    </Field>
  );
}

function ChainField({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const candidates = useMemo(
    () => state.chainCandidates.filter((entry) => !state.chainHostIds.includes(entry.id)),
    [state.chainCandidates, state.chainHostIds],
  );
  const options = useMemo<SelectFieldOption<string>[]>(
    () => candidates.map((entry) => ({ id: entry.id, value: entry.id, label: entry.label })),
    [candidates],
  );
  const handleAdd = useCallback(
    (value: string) => {
      model.setChain([...state.chainHostIds, value]);
    },
    [model, state.chainHostIds],
  );
  const handleRemove = useCallback(
    (hostId: string) => {
      model.setChain(state.chainHostIds.filter((id) => id !== hostId));
    },
    [model, state.chainHostIds],
  );
  const labelFor = useCallback(
    (hostId: string) => state.chainCandidates.find((entry) => entry.id === hostId)?.label ?? hostId,
    [state.chainCandidates],
  );
  return (
    <Field label={t("ssh.form.hostChaining")}>
      <View style={styles.chipRow}>
        {state.chainHostIds.map((hostId) => (
          <Chip key={hostId} label={labelFor(hostId)} value={hostId} onRemove={handleRemove} />
        ))}
      </View>
      {options.length > 0 ? (
        <SelectField
          label=""
          value={null}
          selectedDisplay={null}
          options={options}
          onChange={handleAdd}
          placeholder={t("ssh.form.hostChaining")}
          emptyText={t("ssh.form.hostChaining")}
          searchable
          title={t("ssh.form.hostChaining")}
          size={controlSize}
        />
      ) : null}
    </Field>
  );
}

function ProxyFields({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<ProxyType | null>[]>(
    () => [
      { id: "__none__", value: null, label: t("ssh.form.keyNone") },
      ...PROXY_TYPES.map((type) => ({ id: type, value: type, label: type.toUpperCase() })),
    ],
    [t],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(
    () => (state.proxyType ? { label: state.proxyType.toUpperCase() } : null),
    [state.proxyType],
  );
  const handleType = useCallback((value: ProxyType | null) => model.setProxyType(value), [model]);
  return (
    <>
      <SelectField
        label={t("ssh.form.proxy")}
        value={state.proxyType}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={handleType}
        placeholder={t("ssh.form.keyNone")}
        emptyText={t("ssh.form.keyNone")}
        searchable={false}
        title={t("ssh.form.proxy")}
        size={controlSize}
      />
      {state.disclosure.showProxyFields ? (
        <>
          <Field label={t("ssh.form.address")}>
            <FormTextInput
              size={controlSize}
              initialValue={state.proxyHost}
              value={state.proxyHost}
              onChangeText={model.setProxyHost}
              placeholder="proxy.local"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={t("ssh.form.port")}>
            <FormTextInput
              size={controlSize}
              initialValue={state.proxyPort}
              value={state.proxyPort}
              onChangeText={model.setProxyPort}
              placeholder="1080"
              keyboardType="number-pad"
            />
          </Field>
          <Field label={t("ssh.form.username")}>
            <FormTextInput
              size={controlSize}
              initialValue={state.proxyUsername}
              value={state.proxyUsername}
              onChangeText={model.setProxyUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={t("ssh.form.password")}>
            <FormTextInput
              size={controlSize}
              initialValue={state.proxyPassword}
              value={state.proxyPassword}
              onChangeText={model.setProxyPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}

function EnvFields({ model, state, controlSize }: SshHostFormProps) {
  const { t } = useTranslation();
  return (
    <Field label={t("ssh.form.environment")}>
      {state.env.map((entry, index) => (
        <EnvRow
          key={entry.id}
          index={index}
          entry={entry}
          controlSize={controlSize}
          onChange={model.setEnvVar}
          onRemove={model.removeEnvVar}
        />
      ))}
      <Pressable style={styles.addRow} onPress={model.addEnvVar} accessibilityRole="button">
        <Text style={styles.addLabel}>+ {t("ssh.form.environment")}</Text>
      </Pressable>
    </Field>
  );
}

function EnvRow({
  index,
  entry,
  controlSize,
  onChange,
  onRemove,
}: {
  index: number;
  entry: SshHostFormEnvEntry;
  controlSize: FieldControlSize;
  onChange: (index: number, entry: SshHostFormEnvEntry) => void;
  onRemove: (index: number) => void;
}) {
  const handleKey = useCallback(
    (key: string) => onChange(index, { ...entry, key }),
    [onChange, index, entry],
  );
  const handleValue = useCallback(
    (value: string) => onChange(index, { ...entry, value }),
    [onChange, index, entry],
  );
  const handleRemove = useCallback(() => onRemove(index), [onRemove, index]);
  return (
    <View style={styles.envRow}>
      <FormTextInput
        size={controlSize}
        style={styles.envKey}
        initialValue={entry.key}
        value={entry.key}
        onChangeText={handleKey}
        placeholder="KEY"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <FormTextInput
        size={controlSize}
        style={styles.envValue}
        initialValue={entry.value}
        value={entry.value}
        onChangeText={handleValue}
        placeholder="value"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={styles.envRemove}
        onPress={handleRemove}
        accessibilityRole="button"
        hitSlop={8}
      >
        <XIcon />
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: (value: string) => void;
}) {
  const handleRemove = useCallback(() => onRemove(value), [onRemove, value]);
  return (
    <Pressable style={styles.chip} onPress={handleRemove} accessibilityRole="button">
      <Text style={styles.chipLabel}>{label}</Text>
      <XIcon />
    </Pressable>
  );
}

const ThemedX = withUnistyles(X);
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function XIcon() {
  return <ThemedX size={12} uniProps={mutedIconColor} />;
}

const styles = StyleSheet.create((theme: Theme) => ({
  form: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginTop: theme.spacing[2],
  },
  notice: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  multiline: {
    minHeight: 72,
  },
  toggleBlock: {
    gap: theme.spacing[1],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1],
  },
  toggleLabel: {
    flex: 1,
    flexShrink: 1,
    paddingRight: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  toggleDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] / 2,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  chipLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  envRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  envKey: {
    flex: 1,
  },
  envValue: {
    flex: 2,
  },
  envRemove: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    paddingVertical: theme.spacing[1],
  },
  addLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
  },
}));
