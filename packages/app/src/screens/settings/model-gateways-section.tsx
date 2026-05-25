import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, Plus, Pencil, RefreshCw, Trash2 } from "lucide-react-native";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { MutableDaemonConfig } from "@server/shared/messages";

type ModelGateways = NonNullable<MutableDaemonConfig["modelGateways"]>;
type ModelGatewayConfig = ModelGateways[string];

const EMPTY_GATEWAYS: ModelGateways = {};
const GATEWAY_SHEET_HEADER: SheetHeader = { title: "Model gateway" };
const CODEX_PROVIDER_LABEL = "Codex";

function slugifyGatewayId(label: string, existingIds: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gateway";
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function getGatewayLabel(id: string, gateway: ModelGatewayConfig): string {
  return gateway.label?.trim() || id;
}

function getGatewaySubtitle(gateway: ModelGatewayConfig): string {
  if (gateway.type === "openai-compatible") {
    const model = gateway.model?.trim();
    const provider =
      gateway.provider === "codex" || !gateway.provider ? CODEX_PROVIDER_LABEL : gateway.provider;
    return model
      ? `${provider} · OpenAI-compatible · ${gateway.baseUrl} · model ${model}`
      : `${provider} · OpenAI-compatible · ${gateway.baseUrl}`;
  }
  return "Native provider routing";
}

function toOpenAICompatibleDraft(gateway: ModelGatewayConfig | null): {
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  if (gateway?.type !== "openai-compatible") {
    return { label: "", baseUrl: "", model: "", apiKey: "" };
  }
  return {
    label: gateway.label ?? "",
    baseUrl: gateway.baseUrl,
    model: gateway.model ?? "",
    apiKey: gateway.apiKey ?? "",
  };
}

export function ModelGatewaysSection({ serverId }: { serverId: string }) {
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId);
  const supportsModelGateways = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.modelGateways === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const gateways = config?.modelGateways ?? EMPTY_GATEWAYS;
  const entries = useMemo(
    () => Object.entries(gateways).sort(([left], [right]) => left.localeCompare(right)),
    [gateways],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [draftResetKey, setDraftResetKey] = useState(0);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string | null>(null);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const modelAnchorRef = useRef<View | null>(null);

  const resetDraft = useCallback((id: string | null, gateway: ModelGatewayConfig | null) => {
    const draft = toOpenAICompatibleDraft(gateway);
    setEditingId(id);
    setLabel(draft.label);
    setBaseUrl(draft.baseUrl);
    setModel(draft.model);
    setApiKey(draft.apiKey ?? "");
    setDiscoveredModels([]);
    setModelDiscoveryError(null);
    setIsModelSelectorOpen(false);
    setDraftResetKey((current) => current + 1);
  }, []);

  const handleAdd = useCallback(() => {
    resetDraft(null, null);
    setIsSheetOpen(true);
  }, [resetDraft]);

  const handleEdit = useCallback(
    (id: string, gateway: ModelGatewayConfig) => {
      resetDraft(id, gateway);
      setIsSheetOpen(true);
    },
    [resetDraft],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setIsSheetOpen(false);
  }, [isSaving]);

  const handleDiscoverModels = useCallback(async () => {
    const nextBaseUrl = baseUrl.trim();
    if (!nextBaseUrl || !client || isDiscoveringModels) {
      return;
    }

    setIsDiscoveringModels(true);
    setModelDiscoveryError(null);
    try {
      const result = await client.listModelGatewayModels({
        type: "openai-compatible",
        provider: "codex",
        baseUrl: nextBaseUrl,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setDiscoveredModels(result.models);
      setModelDiscoveryError(result.error);
    } catch (error) {
      setDiscoveredModels([]);
      setModelDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDiscoveringModels(false);
    }
  }, [apiKey, baseUrl, client, isDiscoveringModels]);
  const handleTriggerModelDiscovery = useCallback(() => {
    void handleDiscoverModels();
  }, [handleDiscoverModels]);
  const handleOpenModelSelector = useCallback(() => {
    setIsModelSelectorOpen(true);
  }, []);

  const modelOptions = useMemo(
    () => discoveredModels.map((id) => ({ id, label: id })),
    [discoveredModels],
  );
  const modelDiscoveryStatus = useMemo(() => {
    if (isDiscoveringModels) {
      return "Loading models...";
    }
    if (modelDiscoveryError) {
      return modelDiscoveryError;
    }
    if (discoveredModels.length > 0) {
      return `${discoveredModels.length} models available`;
    }
    return "Load available routes or enter an ID manually.";
  }, [discoveredModels.length, isDiscoveringModels, modelDiscoveryError]);

  const handleSave = useCallback(() => {
    const nextLabel = label.trim();
    const nextBaseUrl = baseUrl.trim();
    const nextModel = model.trim();
    const nextApiKey = apiKey.trim();
    if (!nextLabel) {
      Alert.alert("Name required", "Enter a name for this gateway.");
      return;
    }
    if (!nextBaseUrl) {
      Alert.alert("Base URL required", "Enter the gateway base URL.");
      return;
    }

    const existingIds = new Set(Object.keys(gateways));
    const id = editingId ?? slugifyGatewayId(nextLabel, existingIds);
    const nextGateways: ModelGateways = {
      ...gateways,
      [id]: {
        type: "openai-compatible",
        id,
        provider: "codex",
        label: nextLabel,
        baseUrl: nextBaseUrl,
        ...(nextModel ? { model: nextModel } : {}),
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
      },
    };

    setIsSaving(true);
    void patchConfig({ modelGateways: nextGateways })
      .then(() => setIsSheetOpen(false))
      .catch((error) => {
        Alert.alert(
          "Unable to save gateway",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => setIsSaving(false));
  }, [apiKey, baseUrl, editingId, gateways, label, model, patchConfig]);

  const handleRemove = useCallback(
    (id: string) => {
      const nextGateways: ModelGateways = { ...gateways };
      delete nextGateways[id];
      void patchConfig({ modelGateways: nextGateways }).catch((error) => {
        Alert.alert(
          "Unable to remove gateway",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [gateways, patchConfig],
  );

  const trailing = useMemo(
    () => (
      <Pressable
        onPress={handleAdd}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel="Add model gateway"
        testID="add-model-gateway-button"
      >
        <Plus size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        <Text style={settingsStyles.sectionHeaderLinkText}>Add gateway</Text>
      </Pressable>
    ),
    [handleAdd, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  if (!supportsModelGateways) {
    return null;
  }

  return (
    <SettingsSection title="Model Gateways" trailing={trailing} testID="model-gateways-section">
      <View style={settingsStyles.card}>
        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={settingsStyles.rowTitle}>No gateways</Text>
            <Text style={settingsStyles.rowHint}>
              Add an OpenAI-compatible endpoint to route model requests through a gateway.
            </Text>
          </View>
        ) : (
          entries.map(([id, gateway], index) => (
            <ModelGatewayRow
              key={id}
              id={id}
              gateway={gateway}
              isFirst={index === 0}
              onEdit={handleEdit}
              onRemove={handleRemove}
            />
          ))
        )}
      </View>

      <AdaptiveModalSheet
        visible={isSheetOpen}
        header={GATEWAY_SHEET_HEADER}
        onClose={handleClose}
        testID="model-gateway-sheet"
      >
        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Provider</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyFieldText}>{CODEX_PROVIDER_LABEL}</Text>
            </View>
            <Text style={styles.fieldHint}>
              Model gateways use the native config format for the selected provider.
            </Text>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Name</Text>
            <AdaptiveTextInput
              value={label}
              initialValue={label}
              resetKey={`gateway-label-${editingId ?? "new"}-${draftResetKey}`}
              onChangeText={setLabel}
              placeholder="Local 9Router"
              autoCapitalize="none"
              autoCorrect={false}
              testID="model-gateway-label-input"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Base URL</Text>
            <AdaptiveTextInput
              value={baseUrl}
              initialValue={baseUrl}
              resetKey={`gateway-base-url-${editingId ?? "new"}-${draftResetKey}`}
              onChangeText={setBaseUrl}
              onBlur={handleTriggerModelDiscovery}
              placeholder="http://localhost:20128/v1"
              autoCapitalize="none"
              autoCorrect={false}
              testID="model-gateway-base-url-input"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>API key</Text>
            <AdaptiveTextInput
              value={apiKey}
              initialValue={apiKey}
              resetKey={`gateway-api-key-${editingId ?? "new"}-${draftResetKey}`}
              onChangeText={setApiKey}
              onBlur={handleTriggerModelDiscovery}
              placeholder="Optional"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              testID="model-gateway-api-key-input"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Model / combo</Text>
            <View ref={modelAnchorRef} collapsable={false}>
              <Pressable
                onPress={handleOpenModelSelector}
                style={styles.modelSelector}
                accessibilityRole="button"
                accessibilityLabel="Select gateway model"
                testID="model-gateway-model-input"
              >
                <Text style={styles.modelSelectorText} numberOfLines={1}>
                  {model.trim() || "Select or enter a model ID"}
                </Text>
                <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              </Pressable>
              <Combobox
                options={modelOptions}
                value={model}
                onSelect={setModel}
                searchable
                allowCustomValue
                customValuePrefix="Use model ID"
                placeholder="Select or enter a model ID"
                searchPlaceholder="Search models or enter an ID"
                emptyText={
                  isDiscoveringModels
                    ? "Loading models..."
                    : "No discovered models. Enter a model ID."
                }
                title="Model / combo"
                open={isModelSelectorOpen}
                onOpenChange={setIsModelSelectorOpen}
                anchorRef={modelAnchorRef}
                desktopPlacement="bottom-start"
                desktopPreventInitialFlash
                desktopMinWidth={320}
              />
            </View>
            <View style={styles.modelDiscoveryRow}>
              <Text style={styles.modelDiscoveryStatus}>{modelDiscoveryStatus}</Text>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={RefreshCw}
                onPress={handleTriggerModelDiscovery}
                loading={isDiscoveringModels}
                disabled={!baseUrl.trim()}
                testID="refresh-model-gateway-models-button"
              >
                Refresh
              </Button>
            </View>
            <Text style={styles.fieldHint}>
              Default gateway route, alias, or combo. Available models are read from the gateway.
            </Text>
          </View>
          <View style={styles.formActions}>
            <Button variant="ghost" onPress={handleClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="default" onPress={handleSave} loading={isSaving}>
              Save
            </Button>
          </View>
        </View>
      </AdaptiveModalSheet>
    </SettingsSection>
  );
}

function ModelGatewayRow({
  id,
  gateway,
  isFirst,
  onEdit,
  onRemove,
}: {
  id: string;
  gateway: ModelGatewayConfig;
  isFirst: boolean;
  onEdit: (id: string, gateway: ModelGatewayConfig) => void;
  onRemove: (id: string) => void;
}) {
  const { theme } = useUnistyles();
  const label = getGatewayLabel(id, gateway);
  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder],
    [isFirst],
  );
  const handleEdit = useCallback(() => onEdit(id, gateway), [gateway, id, onEdit]);
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {getGatewaySubtitle(gateway)}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          hitSlop={8}
          onPress={handleEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label}`}
          testID={`edit-model-gateway-${id}`}
        >
          <Pencil size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={handleRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          testID={`remove-model-gateway-${id}`}
        >
          <Trash2 size={theme.iconSize.md} color={theme.colors.destructive} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  form: {
    gap: theme.spacing[4],
  },
  fieldGroup: {
    gap: theme.spacing[2],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  fieldHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  modelSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  modelSelectorText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  modelDiscoveryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  modelDiscoveryStatus: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  readOnlyField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  readOnlyFieldText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
