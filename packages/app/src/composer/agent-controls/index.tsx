import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  Keyboard,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { TFunction } from "i18next";
import { useShallow } from "zustand/shallow";
import {
  Brain,
  ChevronDown,
  Code2,
  ListTodo,
  Route,
  Settings2,
  ShieldCheck,
  Zap,
} from "lucide-react-native";
import { getProviderIcon } from "@/components/provider-icons";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  buildModelGatewayModelDefinitions,
  buildModelGatewaySelectorProviders,
} from "@/model-gateways/model-gateway-models";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useModelGatewayModels } from "@/hooks/use-model-gateway-models";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import {
  buildFavoriteModelKey,
  mergeProviderPreferences,
  toggleFavoriteModel,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { DraftAgentModeControl, AgentModeControl } from "@/composer/agent-controls/mode-control";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  AgentSessionConfig,
} from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  resolveFeatureImpliedThinkingOptionId,
  resolveThinkingImpliedFeatureUpdates,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import {
  localizeAgentFeature,
  localizeThinkingOptionLabel,
} from "@/composer/agent-controls/localize";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";

interface AgentControlOption {
  id: string;
  label: string;
}

const NATIVE_MODEL_GATEWAY_ID = "native";

interface RuntimeModelGatewayStatus {
  id: string;
  label?: string;
  provider?: string;
}

type AgentControlSelector =
  | "provider"
  | "gateway"
  | "mode"
  | "model"
  | "thinking"
  | `feature-${string}`;

interface ControlledAgentControlsProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  onSelectModelGateway?: (gatewayId: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  /** Extra elements rendered inline with the agent controls (desktop only). */
  desktopExtras?: ReactNode;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
}

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  onSelectProvider: (provider: AgentProvider) => void;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (provider: AgentProvider, modelId: string) => void;
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  onSelectModelGateway?: (gatewayId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
}

interface AgentControlsProps {
  agentId: string;
  serverId: string;
  onDropdownClose?: () => void;
  isCompactLayout?: boolean;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

const FEATURE_ICONS: Record<string, typeof Zap> = {
  "list-todo": ListTodo,
  "shield-check": ShieldCheck,
  zap: Zap,
};

function getFeatureIcon(featureId: string, icon?: string) {
  if (featureId === "ultracode") {
    return Code2;
  }

  return (icon && FEATURE_ICONS[icon]) || Settings2;
}

function getFeatureIconColor(
  featureId: string,
  enabled: boolean,
  colors: {
    palette: {
      blue: { 400: string };
      green: { 400: string };
      yellow: { 400: string };
    };
    ultracodeGlow: { halo: string };
    foregroundMuted: string;
  },
): string {
  if (!enabled) {
    return colors.foregroundMuted;
  }

  switch (getFeatureHighlightColor(featureId)) {
    case "blue":
      return colors.palette.blue[400];
    case "green":
      return colors.palette.green[400];
    case "purple":
      // Ultracode follows the theme glow (violet by default, terracotta on
      // the Claude themes).
      return colors.ultracodeGlow.halo;
    case "yellow":
      return colors.palette.yellow[400];
    default:
      return colors.foregroundMuted;
  }
}

// Mobile agent controls only — strip namespace prefix so providers like OpenCode
// show "gpt-5.5" instead of "openrouter/gpt-5.5". Full label still appears in
// the model picker.
function shortModelLabel(label: string): string {
  const i = label.lastIndexOf("/");
  return i === -1 ? label : label.slice(i + 1);
}

type ActiveSheet = "gateway" | "thinking" | "features" | null;

function resolveHasAnyControl({
  providerOptions,
  modelGatewayOptions,
  canSelectModel,
  thinkingOptions,
  features,
  hasDesktopExtras,
}: {
  providerOptions: AgentControlOption[] | undefined;
  modelGatewayOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  hasDesktopExtras: boolean;
}) {
  return (
    Boolean(providerOptions?.length) ||
    Boolean(modelGatewayOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length) ||
    hasDesktopExtras
  );
}

function toComboboxOptions(options: AgentControlOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function toThinkingControlOptions(
  options: AgentControlOption[] | undefined,
  t: TFunction,
): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: localizeThinkingOptionLabel(t, option),
  }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: buildFavoriteModelKey({ provider, modelId: option.id }),
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function makeBadgePressableStyle(
  baseStyle: StyleProp<ViewStyle>,
  disabledStyle: StyleProp<ViewStyle>,
  disabled: boolean,
  isOpen: boolean,
) {
  return ({ pressed, hovered }: PressableStateCallbackType) => [
    baseStyle,
    hovered && styles.modeBadgeHovered,
    (pressed || isOpen) && styles.modeBadgePressed,
    disabled && disabledStyle,
  ];
}

function pickSheetModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectProviderAndModel,
  onSelectProvider,
  onSelectModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  onSelectProvider?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId !== currentProvider) {
    onSelectProvider?.(nextProviderId);
  }
  onSelectModel?.(modelId);
}

function pickDesktopModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectModel?: (modelId: string) => void;
}) {
  if (nextProviderId === currentProvider) {
    onSelectModel?.(modelId);
  }
}

function resolveProviderIcon(provider: string) {
  if (provider.trim().length === 0) {
    return null;
  }
  return getProviderIcon(provider);
}

type AgentControlsSlice = {
  provider: string;
  cwd: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  modelGatewayId: string | null;
  modelGatewayLabel: string | null;
  features: AgentFeature[] | undefined;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
} | null;

function readRuntimeModelGatewayStatus(
  extra: Record<string, unknown> | undefined,
): RuntimeModelGatewayStatus | null {
  const raw = extra?.modelGateway;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    label: typeof record.label === "string" ? record.label : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
  };
}

function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  const modelGateway = readRuntimeModelGatewayStatus(currentAgent.runtimeInfo?.extra);
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    modelGatewayId: modelGateway?.id ?? null,
    modelGatewayLabel: modelGateway?.label ?? null,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
  };
}

function buildActiveModelGatewayOptions(
  id: string | undefined,
  label: string | undefined,
  nativeLabel: string,
): AgentControlOption[] | undefined {
  if (!id) {
    return undefined;
  }
  return [
    { id: NATIVE_MODEL_GATEWAY_ID, label: nativeLabel },
    {
      id,
      label: label?.trim() || id,
    },
  ];
}

function useActiveModelGatewayStatus(agent: AgentControlsSlice) {
  const { t } = useTranslation();
  const modelGatewayId = agent?.modelGatewayId ?? undefined;
  const modelGatewayLabel = agent?.modelGatewayLabel ?? undefined;
  const options = useMemo(
    () =>
      buildActiveModelGatewayOptions(
        modelGatewayId,
        modelGatewayLabel,
        t("agentControls.gateway.nativeLabel"),
      ),
    [modelGatewayId, modelGatewayLabel, t],
  );
  return {
    options,
    selectedId: modelGatewayId,
  };
}

function resolveConfiguredModelGateway(
  modelGatewayId: string | null | undefined,
  modelGateways: Record<string, NonNullable<AgentSessionConfig["modelGateway"]>> | undefined,
): AgentSessionConfig["modelGateway"] | undefined {
  if (!modelGatewayId) {
    return undefined;
  }
  return modelGateways?.[modelGatewayId];
}

function resolveActiveAgentModels(
  gatewayModels: AgentModelDefinition[],
  nativeModels: AgentModelDefinition[] | null,
): AgentModelDefinition[] | null {
  if (gatewayModels.length > 0) {
    return gatewayModels;
  }
  return nativeModels;
}

function useActiveModelGatewayCatalog(
  serverId: string,
  agent: AgentControlsSlice,
  daemonConfig: ReturnType<typeof useDaemonConfig>["config"],
  nativeModels: AgentModelDefinition[] | null,
) {
  const configuredModelGateway = resolveConfiguredModelGateway(
    agent?.modelGatewayId,
    daemonConfig?.modelGateways,
  );
  const { modelIds: discoveredModelIds } = useModelGatewayModels(serverId, configuredModelGateway);
  const gatewayModels = useMemo(
    () =>
      buildModelGatewayModelDefinitions({
        provider: agent?.provider,
        gateway: configuredModelGateway,
        selectedModelId: agent?.runtimeModelId ?? agent?.model,
        discoveredModelIds,
      }),
    [
      agent?.model,
      agent?.provider,
      agent?.runtimeModelId,
      configuredModelGateway,
      discoveredModelIds,
    ],
  );
  return {
    configuredModelGateway,
    gatewayModels,
    activeModels: resolveActiveAgentModels(gatewayModels, nativeModels),
  };
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((e) => e.provider === agentProvider) ?? null;
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function buildOpenChangeHandler(
  selector: AgentControlSelector,
  setOpenSelector: (next: AgentControlSelector | null) => void,
  onDropdownClose?: () => void,
) {
  return (nextOpen: boolean) => {
    setOpenSelector(nextOpen ? selector : null);
    if (!nextOpen) {
      onDropdownClose?.();
    }
  };
}

function ControlledAgentControls({
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  modelGatewayOptions,
  selectedModelGatewayId,
  onSelectModelGateway,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  favoriteKeys = new Set<string>(),
  onToggleFavoriteModel,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  desktopExtras,
  modelSelectorServerId = null,
  isCompactLayout,
}: ControlledAgentControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<AgentControlSelector | null>(null);

  const providerAnchorRef = useRef<View>(null);
  const _modelAnchorRef = useRef<View>(null);
  const gatewayAnchorRef = useRef<View>(null);
  const thinkingAnchorRef = useRef<View>(null);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectModel = Boolean(onSelectModel);
  const canSelectModelGateway = Boolean(
    onSelectModelGateway && modelGatewayOptions && modelGatewayOptions.length > 0,
  );
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );

  const displayProvider = findOptionLabel(
    providerOptions,
    selectedProviderId,
    t("agentControls.provider.fallback"),
  );
  const displayModelGateway = findOptionLabel(
    modelGatewayOptions,
    selectedModelGatewayId,
    t("agentControls.gateway.nativeLabel"),
  );
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions, t),
    [thinkingOptions, t],
  );
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("agentControls.thinking.unknown"),
  );

  const ProviderIcon = resolveProviderIcon(provider);

  const hasAnyControl = resolveHasAnyControl({
    providerOptions,
    modelGatewayOptions,
    canSelectModel,
    thinkingOptions,
    features,
    hasDesktopExtras: desktopExtras !== null && desktopExtras !== undefined,
  });

  const modelDisabled = disabled;

  const comboboxProviderOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(providerOptions),
    [providerOptions],
  );
  const comboboxModelGatewayOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(modelGatewayOptions),
    [modelGatewayOptions],
  );
  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(formattedThinkingOptions),
    [formattedThinkingOptions],
  );

  const renderThinkingOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ThinkingComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        iconColor={theme.colors.foreground}
      />
    ),
    [theme.colors.foreground],
  );

  const handleOpenChange = useCallback(
    (selector: AgentControlSelector) =>
      buildOpenChangeHandler(selector, setOpenSelector, onDropdownClose),
    [onDropdownClose],
  );

  const handleProviderPress = useCallback(() => {
    handleOpenChange("provider")(openSelector !== "provider");
  }, [handleOpenChange, openSelector]);

  const handleGatewayPress = useCallback(() => {
    handleOpenChange("gateway")(openSelector !== "gateway");
  }, [handleOpenChange, openSelector]);

  const handleThinkingPress = useCallback(() => {
    handleOpenChange("thinking")(openSelector !== "thinking");
  }, [handleOpenChange, openSelector]);

  const handleProviderOpenChange = useMemo(() => handleOpenChange("provider"), [handleOpenChange]);
  const handleGatewayOpenChange = useMemo(() => handleOpenChange("gateway"), [handleOpenChange]);
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );

  const handleGatewaySelect = useCallback(
    (id: string) => onSelectModelGateway?.(id),
    [onSelectModelGateway],
  );

  const applyThinkingImpliedFeatureUpdates = useCallback(
    (thinkingOptionId: string) => {
      for (const update of resolveThinkingImpliedFeatureUpdates({
        thinkingOptionId,
        features,
      })) {
        onSetFeature?.(update.featureId, update.value);
      }
    },
    [features, onSetFeature],
  );

  const handleThinkingSelect = useCallback(
    (id: string) => {
      onSelectThinkingOption?.(id);
      applyThinkingImpliedFeatureUpdates(id);
    },
    [applyThinkingImpliedFeatureUpdates, onSelectThinkingOption],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      onSetFeature?.(featureId, value);
      const impliedThinkingOptionId = resolveFeatureImpliedThinkingOptionId({
        featureId,
        value,
        thinkingOptions: formattedThinkingOptions,
      });
      if (impliedThinkingOptionId && selectedThinkingOptionId !== impliedThinkingOptionId) {
        onSelectThinkingOption?.(impliedThinkingOptionId);
      }
    },
    [formattedThinkingOptions, onSelectThinkingOption, onSetFeature, selectedThinkingOptionId],
  );

  const handleDesktopModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickDesktopModel({ nextProviderId, modelId, currentProvider: provider, onSelectModel });
    },
    [onSelectModel, provider],
  );

  const providerPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectProvider,
        openSelector === "provider",
      ),
    [canSelectProvider, disabled, openSelector],
  );

  const gatewayPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectModelGateway,
        openSelector === "gateway",
      ),
    [canSelectModelGateway, disabled, openSelector],
  );

  const thinkingPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectThinking,
        openSelector === "thinking",
      ),
    [canSelectThinking, disabled, openSelector],
  );

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
  }, []);

  const handleSelectThinkingAndClose = useCallback(
    (thinkingOptionId: string) => {
      handleThinkingSelect(thinkingOptionId);
      setActiveSheet(null);
    },
    [handleThinkingSelect],
  );

  const handleSelectGatewayAndClose = useCallback(
    (gatewayId: string) => {
      onSelectModelGateway?.(gatewayId);
      setActiveSheet(null);
    },
    [onSelectModelGateway],
  );

  const handleSheetModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickSheetModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectProvider,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProvider, onSelectProviderAndModel, provider],
  );

  if (!hasAnyControl) {
    return null;
  }

  return (
    <View style={styles.container}>
      {!isCompact ? (
        <DesktopAgentControlsContent
          provider={provider}
          providerOptions={providerOptions}
          selectedProviderId={selectedProviderId}
          modelOptions={modelOptions}
          selectedModelId={selectedModelId}
          modelGatewayOptions={modelGatewayOptions}
          selectedModelGatewayId={selectedModelGatewayId}
          thinkingOptions={formattedThinkingOptions}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={handleSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          onRetryModelProvider={onRetryModelProvider}
          isRetryingModelProvider={isRetryingModelProvider}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectProvider={canSelectProvider}
          canSelectModel={canSelectModel}
          canSelectModelGateway={canSelectModelGateway}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxProviderOptions={comboboxProviderOptions}
          comboboxModelGatewayOptions={comboboxModelGatewayOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          displayProvider={displayProvider}
          displayModelGateway={displayModelGateway}
          displayThinking={displayThinking}
          openSelector={openSelector}
          providerAnchorRef={providerAnchorRef}
          gatewayAnchorRef={gatewayAnchorRef}
          thinkingAnchorRef={thinkingAnchorRef}
          providerPressableStyle={providerPressableStyle}
          gatewayPressableStyle={gatewayPressableStyle}
          thinkingPressableStyle={thinkingPressableStyle}
          handleProviderPress={handleProviderPress}
          handleGatewayPress={handleGatewayPress}
          handleThinkingPress={handleThinkingPress}
          handleProviderSelect={handleProviderSelect}
          handleGatewaySelect={handleGatewaySelect}
          handleThinkingSelect={handleThinkingSelect}
          handleDesktopModelSelect={handleDesktopModelSelect}
          handleProviderOpenChange={handleProviderOpenChange}
          handleGatewayOpenChange={handleGatewayOpenChange}
          handleThinkingOpenChange={handleThinkingOpenChange}
          handleOpenChange={handleOpenChange}
          renderThinkingOption={renderThinkingOption}
          extras={desktopExtras}
          modelSelectorServerId={modelSelectorServerId}
        />
      ) : (
        <SheetAgentControlsContent
          provider={provider}
          selectedModelId={selectedModelId}
          modelGatewayOptions={modelGatewayOptions}
          selectedModelGatewayId={selectedModelGatewayId}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={handleSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          onRetryModelProvider={onRetryModelProvider}
          isRetryingModelProvider={isRetryingModelProvider}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectModel={canSelectModel}
          canSelectModelGateway={canSelectModelGateway}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxModelGatewayOptions={comboboxModelGatewayOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          openSelector={openSelector}
          ProviderIcon={ProviderIcon}
          activeSheet={activeSheet}
          handleOpenSheet={handleOpenSheet}
          handleCloseSheet={handleCloseSheet}
          handleSheetModelSelect={handleSheetModelSelect}
          handleSelectThinkingAndClose={handleSelectThinkingAndClose}
          handleSelectGatewayAndClose={handleSelectGatewayAndClose}
          handleOpenChange={handleOpenChange}
          renderThinkingOption={renderThinkingOption}
          modelSelectorServerId={modelSelectorServerId}
        />
      )}
    </View>
  );
}

interface DesktopAgentControlsContentProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectModel: boolean;
  canSelectModelGateway: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxProviderOptions: ComboboxOption[];
  comboboxModelGatewayOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  displayProvider: string;
  displayModelGateway: string;
  displayThinking: string;
  openSelector: AgentControlSelector | null;
  providerAnchorRef: RefObject<View | null>;
  gatewayAnchorRef: RefObject<View | null>;
  thinkingAnchorRef: RefObject<View | null>;
  providerPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  gatewayPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  thinkingPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleProviderPress: () => void;
  handleGatewayPress: () => void;
  handleThinkingPress: () => void;
  handleProviderSelect: (id: string) => void;
  handleGatewaySelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  handleProviderOpenChange: (open: boolean) => void;
  handleGatewayOpenChange: (open: boolean) => void;
  handleThinkingOpenChange: (open: boolean) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  extras?: ReactNode;
  modelSelectorServerId: string | null;
}

const DESKTOP_SEARCH_THRESHOLD = 6;

function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    provider,
    providerOptions,
    selectedProviderId,
    selectedModelId,
    modelGatewayOptions,
    selectedModelGatewayId,
    thinkingOptions,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectProvider,
    canSelectModel,
    canSelectModelGateway,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxProviderOptions,
    comboboxModelGatewayOptions,
    comboboxThinkingOptions,
    displayProvider,
    displayModelGateway,
    displayThinking,
    openSelector,
    providerAnchorRef,
    gatewayAnchorRef,
    thinkingAnchorRef,
    providerPressableStyle,
    gatewayPressableStyle,
    thinkingPressableStyle,
    handleProviderPress,
    handleGatewayPress,
    handleThinkingPress,
    handleProviderSelect,
    handleGatewaySelect,
    handleThinkingSelect,
    handleDesktopModelSelect,
    handleProviderOpenChange,
    handleGatewayOpenChange,
    handleThinkingOpenChange,
    handleOpenChange,
    renderThinkingOption,
    extras,
    modelSelectorServerId,
  } = props;

  return (
    <>
      {providerOptions && providerOptions.length > 0 ? (
        <>
          <Pressable
            ref={providerAnchorRef}
            collapsable={false}
            disabled={disabled || !canSelectProvider}
            onPress={handleProviderPress}
            style={providerPressableStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.provider.select")}
            testID="agent-provider-selector"
          >
            <Text style={styles.modeBadgeText}>{displayProvider}</Text>
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Combobox
            options={comboboxProviderOptions}
            value={selectedProviderId ?? ""}
            onSelect={handleProviderSelect}
            searchable={comboboxProviderOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "provider"}
            onOpenChange={handleProviderOpenChange}
            anchorRef={providerAnchorRef}
            desktopPlacement="top-start"
          />
        </>
      ) : null}

      {canSelectModel ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <View>
              <CombinedModelSelector
                providers={modelSelectorProviders}
                selectedProvider={provider}
                selectedModel={selectedModelId ?? ""}
                onSelect={handleDesktopModelSelect}
                favoriteKeys={favoriteKeys}
                onToggleFavorite={onToggleFavoriteModel}
                isLoading={isModelLoading}
                disabled={modelDisabled}
                onOpen={onModelSelectorOpen}
                onClose={onDropdownClose}
                onRetryProvider={onRetryModelProvider}
                isRetryingProvider={isRetryingModelProvider}
                serverId={modelSelectorServerId}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t(getAgentControlHintKey("model"))}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}

      <DesktopModelGatewaySelector
        modelGatewayOptions={modelGatewayOptions}
        selectedModelGatewayId={selectedModelGatewayId}
        canSelectModelGateway={canSelectModelGateway}
        disabled={disabled}
        displayModelGateway={displayModelGateway}
        comboboxModelGatewayOptions={comboboxModelGatewayOptions}
        openSelector={openSelector}
        gatewayAnchorRef={gatewayAnchorRef}
        gatewayPressableStyle={gatewayPressableStyle}
        handleGatewayPress={handleGatewayPress}
        handleGatewaySelect={handleGatewaySelect}
        handleGatewayOpenChange={handleGatewayOpenChange}
      />

      {thinkingOptions && thinkingOptions.length > 0 ? (
        <>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild triggerRefProp="ref">
              <Pressable
                ref={thinkingAnchorRef}
                collapsable={false}
                disabled={disabled || !canSelectThinking}
                onPress={handleThinkingPress}
                style={thinkingPressableStyle}
                accessibilityRole="button"
                accessibilityLabel={t("agentControls.thinking.selectWithValue", {
                  value: displayThinking,
                })}
                testID="agent-thinking-selector"
              >
                <Brain size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
                <Text style={styles.modeBadgeText}>{displayThinking}</Text>
                <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t(getAgentControlHintKey("thinking"))}</Text>
            </TooltipContent>
          </Tooltip>
          <Combobox
            options={comboboxThinkingOptions}
            value={selectedThinkingOptionId ?? ""}
            onSelect={handleThinkingSelect}
            searchable={comboboxThinkingOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "thinking"}
            onOpenChange={handleThinkingOpenChange}
            anchorRef={thinkingAnchorRef}
            desktopPlacement="top-start"
            renderOption={renderThinkingOption}
          />
        </>
      ) : null}

      {extras}

      {features?.map((feature) => (
        <DesktopFeatureItem
          key={`feature-${feature.id}`}
          feature={feature}
          disabled={disabled}
          openSelector={openSelector}
          handleOpenChange={handleOpenChange}
          onSetFeature={onSetFeature}
        />
      ))}
    </>
  );
}

interface SheetAgentControlsContentProps {
  provider: string;
  selectedModelId?: string;
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  canSelectModelGateway: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxModelGatewayOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  ProviderIcon: ReturnType<typeof getProviderIcon> | null;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleSelectGatewayAndClose: (gatewayId: string) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  modelSelectorServerId: string | null;
}

function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    provider,
    selectedModelId,
    modelGatewayOptions,
    selectedModelGatewayId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectModel,
    canSelectModelGateway,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxModelGatewayOptions,
    comboboxThinkingOptions,
    openSelector,
    ProviderIcon,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectThinkingAndClose,
    handleSelectGatewayAndClose,
    handleOpenChange,
    renderThinkingOption,
    modelSelectorServerId,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);

  const hasThinking = comboboxThinkingOptions.length > 0;
  const hasFeatures = Boolean(features && features.length > 0);
  const featuresSheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.features.title") }),
    [t],
  );

  const handleOpenThinking = useCallback(() => handleOpenSheet("thinking"), [handleOpenSheet]);
  const handleOpenFeatures = useCallback(() => handleOpenSheet("features"), [handleOpenSheet]);
  const handleThinkingSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("thinking");
      } else {
        handleCloseSheet();
      }
    },
    [handleCloseSheet, handleOpenSheet],
  );

  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
    }) => (
      <View pointerEvents="none" style={styles.prefsButton} testID="agent-controls-model">
        {ProviderIcon ? (
          <ProviderIcon size={theme.iconSize.lg} color={theme.colors.foregroundMuted} />
        ) : null}
        <Text style={styles.prefsButtonText} numberOfLines={1}>
          {shortModelLabel(selectedModelLabel)}
        </Text>
      </View>
    ),
    [ProviderIcon, theme.iconSize.lg, theme.colors.foregroundMuted],
  );

  const thinkingButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled || !canSelectThinking,
    activeSheet === "thinking",
  );
  const featuresButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled,
    activeSheet === "features",
  );

  return (
    <>
      {canSelectModel ? (
        <CombinedModelSelector
          providers={modelSelectorProviders}
          selectedProvider={provider}
          selectedModel={selectedModelId ?? ""}
          onSelect={handleSheetModelSelect}
          favoriteKeys={favoriteKeys}
          onToggleFavorite={onToggleFavoriteModel}
          isLoading={isModelLoading}
          disabled={modelDisabled}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
          onRetryProvider={onRetryModelProvider}
          isRetryingProvider={isRetryingModelProvider}
          renderTrigger={renderModelTrigger}
          serverId={modelSelectorServerId}
        />
      ) : null}

      <SheetModelGatewaySelector
        modelGatewayOptions={modelGatewayOptions}
        selectedModelGatewayId={selectedModelGatewayId}
        canSelectModelGateway={canSelectModelGateway}
        disabled={disabled}
        activeSheet={activeSheet}
        handleOpenSheet={handleOpenSheet}
        handleCloseSheet={handleCloseSheet}
        handleSelectGatewayAndClose={handleSelectGatewayAndClose}
        comboboxModelGatewayOptions={comboboxModelGatewayOptions}
      />

      {hasThinking ? (
        <Pressable
          ref={thinkingAnchorRef}
          onPress={handleOpenThinking}
          disabled={disabled || !canSelectThinking}
          style={thinkingButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.thinking.select")}
          testID="agent-controls-thinking"
        >
          <Brain size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}

      {hasFeatures ? (
        <Pressable
          onPress={handleOpenFeatures}
          disabled={disabled}
          style={featuresButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("agentControls.features.open")}
          testID="agent-controls-features"
        >
          <Settings2 size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}

      {hasThinking ? (
        <Combobox
          options={comboboxThinkingOptions}
          value={selectedThinkingOptionId ?? ""}
          onSelect={handleSelectThinkingAndClose}
          searchable={false}
          title={t("agentControls.thinking.title")}
          open={activeSheet === "thinking"}
          onOpenChange={handleThinkingSheetOpenChange}
          anchorRef={thinkingAnchorRef}
          renderOption={renderThinkingOption}
        />
      ) : null}

      <AdaptiveModalSheet
        header={featuresSheetHeader}
        visible={activeSheet === "features"}
        onClose={handleCloseSheet}
        testID="agent-features-sheet"
      >
        {(features ?? []).map((feature) => (
          <SheetFeatureItem
            key={`feature-${feature.id}`}
            feature={feature}
            disabled={disabled}
            openSelector={openSelector}
            handleOpenChange={handleOpenChange}
            onSetFeature={onSetFeature}
          />
        ))}
      </AdaptiveModalSheet>
    </>
  );
}

function DesktopModelGatewaySelector({
  modelGatewayOptions,
  selectedModelGatewayId,
  canSelectModelGateway,
  disabled,
  displayModelGateway,
  comboboxModelGatewayOptions,
  openSelector,
  gatewayAnchorRef,
  gatewayPressableStyle,
  handleGatewayPress,
  handleGatewaySelect,
  handleGatewayOpenChange,
}: {
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  canSelectModelGateway: boolean;
  disabled: boolean;
  displayModelGateway: string;
  comboboxModelGatewayOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  gatewayAnchorRef: RefObject<View | null>;
  gatewayPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleGatewayPress: () => void;
  handleGatewaySelect: (id: string) => void;
  handleGatewayOpenChange: (open: boolean) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (!modelGatewayOptions?.length) {
    return null;
  }
  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable
            ref={gatewayAnchorRef}
            collapsable={false}
            disabled={disabled || !canSelectModelGateway}
            onPress={handleGatewayPress}
            style={gatewayPressableStyle}
            accessibilityRole="button"
            accessibilityLabel={t("agentControls.gateway.selectAccessibilityLabelWithValue", {
              value: displayModelGateway,
            })}
            testID="agent-model-gateway-selector"
          >
            <Route size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
            <Text style={styles.modeBadgeText}>{displayModelGateway}</Text>
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{t(getAgentControlHintKey("gateway"))}</Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={comboboxModelGatewayOptions}
        value={selectedModelGatewayId ?? ""}
        onSelect={handleGatewaySelect}
        searchable={comboboxModelGatewayOptions.length > DESKTOP_SEARCH_THRESHOLD}
        open={openSelector === "gateway"}
        onOpenChange={handleGatewayOpenChange}
        anchorRef={gatewayAnchorRef}
        desktopPlacement="top-start"
      />
    </>
  );
}

function SheetModelGatewaySelector({
  modelGatewayOptions,
  selectedModelGatewayId,
  canSelectModelGateway,
  disabled,
  activeSheet,
  handleOpenSheet,
  handleCloseSheet,
  handleSelectGatewayAndClose,
  comboboxModelGatewayOptions,
}: {
  modelGatewayOptions?: AgentControlOption[];
  selectedModelGatewayId?: string;
  canSelectModelGateway: boolean;
  disabled: boolean;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSelectGatewayAndClose: (gatewayId: string) => void;
  comboboxModelGatewayOptions: ComboboxOption[];
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const gatewayAnchorRef = useRef<View | null>(null);
  const hasGateway = Boolean(
    canSelectModelGateway && modelGatewayOptions && modelGatewayOptions.length > 0,
  );
  const handleOpenGateway = useCallback(() => handleOpenSheet("gateway"), [handleOpenSheet]);
  const handleGatewaySheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("gateway");
      } else {
        handleCloseSheet();
      }
    },
    [handleCloseSheet, handleOpenSheet],
  );
  const gatewayButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled || !canSelectModelGateway,
    activeSheet === "gateway",
  );

  if (!hasGateway) {
    return null;
  }

  return (
    <>
      <Pressable
        ref={gatewayAnchorRef}
        onPress={handleOpenGateway}
        disabled={disabled || !canSelectModelGateway}
        style={gatewayButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("agentControls.gateway.selectAccessibilityLabel")}
        testID="agent-controls-gateway"
      >
        <Route size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Combobox
        options={comboboxModelGatewayOptions}
        value={selectedModelGatewayId ?? ""}
        onSelect={handleSelectGatewayAndClose}
        searchable={false}
        title={t("agentControls.gateway.sheetTitle")}
        open={activeSheet === "gateway"}
        onOpenChange={handleGatewaySheetOpenChange}
        anchorRef={gatewayAnchorRef}
      />
    </>
  );
}

function DesktopFeatureItem({
  feature: rawFeature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const feature = useMemo(() => localizeAgentFeature(t, rawFeature), [t, rawFeature]);
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );

  const togglePressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeIconBadge,
      hovered && styles.modeBadgeHovered,
      pressed && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled],
  );

  const selectPressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeBadge,
      hovered && styles.modeBadgeHovered,
      (pressed || openSelector === featureSelector) && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled, openSelector, featureSelector],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.id, feature.icon);
    return (
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable
            disabled={disabled}
            onPress={handleTogglePress}
            style={togglePressableStyle}
            accessibilityRole="button"
            accessibilityLabel={getFeatureTooltip(feature)}
            testID={`agent-feature-${feature.id}`}
          >
            <FeatureIcon
              size={theme.iconSize.md}
              color={getFeatureIconColor(feature.id, feature.value, theme.colors)}
            />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getFeatureIcon(feature.id, feature.icon);
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <DropdownMenu open={openSelector === featureSelector} onOpenChange={handleFeatureOpenChange}>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <DropdownMenuTrigger
              disabled={disabled}
              style={selectPressableStyle}
              accessibilityRole="button"
              accessibilityLabel={getFeatureTooltip(feature)}
              testID={`agent-feature-${feature.id}`}
            >
              <FeatureIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={styles.modeBadgeText}>{selectedOption?.label ?? feature.label}</Text>
              <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{getFeatureTooltip(feature)}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start">
          {feature.options.map((option) => (
            <FeatureOptionMenuItem
              key={option.id}
              option={option}
              selected={option.id === feature.value}
              onSelect={handleSelectOption}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return null;
}

function SheetFeatureItem({
  feature: rawFeature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const feature = useMemo(() => localizeAgentFeature(t, rawFeature), [t, rawFeature]);
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );

  const togglePressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.sheetSelect,
      pressed && styles.sheetSelectPressed,
      disabled && styles.disabledSheetSelect,
    ],
    [disabled],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.id, feature.icon);
    return (
      <View style={styles.sheetSection}>
        <Pressable
          disabled={disabled}
          onPress={handleTogglePress}
          style={togglePressableStyle}
          accessibilityRole="button"
          accessibilityLabel={getFeatureTooltip(feature)}
          testID={`agent-feature-${feature.id}`}
        >
          <FeatureIcon
            size={theme.iconSize.md}
            color={getFeatureIconColor(feature.id, feature.value, theme.colors)}
          />
          <Text style={styles.sheetSelectText}>{feature.label}</Text>
          <Text style={styles.modeBadgeText}>
            {feature.value ? t("agentControls.features.on") : t("agentControls.features.off")}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (feature.type === "select") {
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <View style={styles.sheetSection}>
        <DropdownMenu
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
        >
          <DropdownMenuTrigger
            disabled={disabled}
            style={togglePressableStyle}
            accessibilityRole="button"
            accessibilityLabel={getFeatureTooltip(feature)}
            testID={`agent-feature-${feature.id}`}
          >
            <Text style={styles.sheetSelectText}>{selectedOption?.label ?? feature.label}</Text>
            <ChevronDown size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            {feature.options.map((option) => (
              <FeatureOptionMenuItem
                key={option.id}
                option={option}
                selected={option.id === feature.value}
                onSelect={handleSelectOption}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    );
  }

  return null;
}

function FeatureOptionMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: { id: string; label: string };
  selected: boolean;
  onSelect: (optionId: string) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

function ThinkingComboboxOption({
  option,
  selected,
  active,
  onPress,
  iconColor,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  iconColor: string;
}) {
  const leadingSlot = useMemo(() => <Brain size={16} color={iconColor} />, [iconColor]);
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export const AgentControls = memo(function AgentControls({
  agentId,
  serverId,
  onDropdownClose,
  isCompactLayout,
}: AgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const { t } = useTranslation();
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });

  const snapshotSelectedEntry = useMemo(
    () => resolveSnapshotSelectedEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );

  const models = snapshotSelectedEntry?.models ?? null;
  const { config: daemonConfig } = useDaemonConfig(serverId);
  const { configuredModelGateway, gatewayModels, activeModels } = useActiveModelGatewayCatalog(
    serverId,
    agent,
    daemonConfig,
    models,
  );
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";

  const agentProviderDefinitions = useMemo(
    () => buildAgentProviderDefinitions(agent?.provider, snapshotEntries),
    [agent?.provider, snapshotEntries],
  );

  const agentProviderModels = useMemo(
    () => buildAgentProviderModels(agent?.provider, activeModels),
    [agent?.provider, activeModels],
  );
  const agentModelSelectorProviders = useMemo(() => {
    if (gatewayModels.length > 0) {
      return buildModelGatewaySelectorProviders({
        provider: agent?.provider,
        providerLabel:
          configuredModelGateway?.label?.trim() ||
          agent?.modelGatewayLabel ||
          t("agentControls.gateway.fallbackLabel"),
        models: gatewayModels,
      });
    }
    if (snapshotSelectedEntry) {
      return buildSelectableProviderSelectorProviders([snapshotSelectedEntry]);
    }
    return buildProviderSelectorProviders({
      providerDefinitions: agentProviderDefinitions,
      modelsByProvider: agentProviderModels,
    });
  }, [
    agent?.modelGatewayLabel,
    agent?.provider,
    agentProviderDefinitions,
    agentProviderModels,
    configuredModelGateway,
    gatewayModels,
    snapshotSelectedEntry,
    t,
  ]);

  const modelSelection = resolveAgentModelSelection({
    models: activeModels,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modelOptions = useMemo<AgentControlOption[]>(() => {
    return (activeModels ?? []).map((model) => ({ id: model.id, label: model.label }));
  }, [activeModels]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const thinkingOptions = useMemo<AgentControlOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: localizeThinkingOptionLabel(t, option),
    }));
  }, [modelSelection.thinkingOptions, t]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;

  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            model: modelId,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist model preference failed", error);
      });
      void client.setAgentModel(agentId, modelId).catch((error) => {
        console.warn("[AgentControls] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[AgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client.setAgentThinkingOption(agentId, thinkingOptionId).catch((error) => {
        console.warn("[AgentControls] setAgentThinkingOption failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentControls] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale(agentProvider);
  }, [agentProvider, refetchSnapshotIfStale]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]);
    },
    [refreshSnapshot],
  );

  const modeChip = useMemo(
    () => (
      <AgentModeControl
        serverId={serverId}
        agentId={agentId}
        placement="toolbar"
        isCompactLayout={isCompactLayout}
      />
    ),
    [serverId, agentId, isCompactLayout],
  );

  const activeModelGatewayStatus = useActiveModelGatewayStatus(agent);

  if (!agent) {
    return null;
  }

  return (
    <ControlledAgentControls
      provider={agent.provider}
      modelSelectorProviders={agentModelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      onSelectModel={handleSelectModel}
      modelGatewayOptions={activeModelGatewayStatus.options}
      selectedModelGatewayId={activeModelGatewayStatus.selectedId}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      thinkingOptions={thinkingOptions.length > 1 ? thinkingOptions : undefined}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={snapshotIsLoading || selectedProviderIsLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onRetryModelProvider={handleRetryModelProvider}
      isRetryingModelProvider={snapshotIsRefreshing}
      onDropdownClose={onDropdownClose}
      disabled={!client}
      desktopExtras={modeChip}
      modelSelectorServerId={serverId}
      isCompactLayout={isCompactLayout}
    />
  );
});

export function DraftAgentControls({
  providerDefinitions,
  selectedProvider,
  onSelectProvider: _onSelectProvider,
  modeOptions,
  selectedMode,
  onSelectMode,
  models,
  selectedModel,
  onSelectModel,
  isModelLoading: _isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  modelGatewayOptions,
  selectedModelGatewayId,
  onSelectModelGateway,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  disabled = false,
  modelSelectorServerId = null,
  isCompactLayout,
}: DraftAgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;

  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions, t);
  }, [thinkingOptions, t]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  const handleToggleFavorite = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[DraftAgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const draftModeChip = useMemo(
    () => (
      <DraftAgentModeControl
        placement="toolbar"
        selectedProvider={selectedProvider}
        providerDefinitions={providerDefinitions}
        modeOptions={modeOptions}
        selectedMode={selectedMode}
        onSelectMode={onSelectMode}
        disabled={disabled}
        isCompactLayout={isCompactLayout}
      />
    ),
    [
      selectedProvider,
      providerDefinitions,
      modeOptions,
      selectedMode,
      onSelectMode,
      disabled,
      isCompactLayout,
    ],
  );

  if (!isCompact) {
    return (
      <View style={styles.container}>
        <CombinedModelSelector
          providers={modelSelectorProviders}
          selectedProvider={selectedProvider ?? ""}
          selectedModel={selectedModel}
          onSelect={onSelectProviderAndModel}
          favoriteKeys={favoriteKeys}
          onToggleFavorite={handleToggleFavorite}
          isLoading={isAllModelsLoading}
          disabled={disabled}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
          onRetryProvider={onRetryModelProvider}
          isRetryingProvider={isRetryingModelProvider}
          serverId={modelSelectorServerId}
        />
        {selectedProvider ? (
          <ControlledAgentControls
            provider={selectedProvider}
            modelGatewayOptions={modelGatewayOptions}
            selectedModelGatewayId={selectedModelGatewayId}
            onSelectModelGateway={onSelectModelGateway}
            thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
            selectedThinkingOptionId={effectiveSelectedThinkingOption}
            onSelectThinkingOption={onSelectThinkingOption}
            features={features}
            onSetFeature={onSetFeature}
            onDropdownClose={onDropdownClose}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            disabled={disabled}
            desktopExtras={draftModeChip}
            isCompactLayout={isCompactLayout}
          />
        ) : null}
      </View>
    );
  }

  return (
    <ControlledAgentControls
      provider={selectedProvider ?? ""}
      modelSelectorProviders={modelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={selectedModel}
      onSelectModel={onSelectModel}
      onSelectProviderAndModel={onSelectProviderAndModel}
      modelGatewayOptions={modelGatewayOptions}
      selectedModelGatewayId={selectedModelGatewayId}
      onSelectModelGateway={onSelectModelGateway}
      isModelLoading={isAllModelsLoading}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavorite}
      thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
      selectedThinkingOptionId={effectiveSelectedThinkingOption}
      onSelectThinkingOption={onSelectThinkingOption}
      features={features}
      onSetFeature={onSetFeature}
      onModelSelectorOpen={onModelSelectorOpen}
      onRetryModelProvider={onRetryModelProvider}
      isRetryingModelProvider={isRetryingModelProvider}
      disabled={disabled}
      modelSelectorServerId={modelSelectorServerId}
      isCompactLayout={isCompactLayout}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  modeBadge: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  modeIconBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: theme.borderRadius.full,
  },
  modeBadgeHovered: {
    backgroundColor: theme.colors.surface2,
  },
  modeBadgePressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabledBadge: {
    opacity: 0.5,
  },
  modeBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  prefsButton: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  prefsButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  sheetSection: {
    gap: theme.spacing[2],
  },
  sheetSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
  },
  sheetSelectPressed: {
    backgroundColor: theme.colors.surface2,
  },
  disabledSheetSelect: {
    opacity: 0.5,
  },
  sheetSelectText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
}));
