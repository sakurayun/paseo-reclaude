import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
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
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  Brain,
  ChevronDown,
  ListTodo,
  Route,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldQuestionMark,
  Zap,
} from "lucide-react-native";
import { getProviderIcon } from "@/components/provider-icons";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildProviderSelectorProviders,
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
  type UseFormPreferencesReturn,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  AgentSessionConfig,
} from "@server/server/agent/agent-sdk-types";
import type { AgentProviderDefinition } from "@server/server/agent/provider-manifest";
import type { DaemonClient } from "@server/client/daemon-client";
import { getModeVisuals, type AgentModeColorTier } from "@server/server/agent/provider-manifest";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHint,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";

interface StatusOption {
  id: string;
  label: string;
}

const NATIVE_MODEL_GATEWAY_ID = "native";

interface RuntimeModelGatewayStatus {
  id: string;
  label?: string;
  provider?: string;
}

type StatusSelector = "provider" | "gateway" | "mode" | "model" | "thinking" | `feature-${string}`;

interface ControlledAgentStatusBarProps {
  provider: string;
  providerOptions?: StatusOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modeOptions?: StatusOption[];
  selectedModeId?: string;
  onSelectMode?: (modeId: string) => void;
  modelOptions?: StatusOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  modelGatewayOptions?: StatusOption[];
  selectedModelGatewayId?: string;
  onSelectModelGateway?: (gatewayId: string) => void;
  thinkingOptions?: StatusOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  providerDefinitions: AgentProviderDefinition[];
  modelSelectorProviders?: ProviderSelectorProvider[];
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
}

export interface DraftAgentStatusBarProps {
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
  modelGatewayOptions?: StatusOption[];
  selectedModelGatewayId?: string;
  onSelectModelGateway?: (gatewayId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  disabled?: boolean;
}

export type DraftAgentControlsProps = DraftAgentStatusBarProps;

interface AgentStatusBarProps {
  agentId: string;
  serverId: string;
  onDropdownClose?: () => void;
}

function findOptionLabel(
  options: StatusOption[] | undefined,
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
  zap: Zap,
};

function getFeatureIcon(icon?: string) {
  return (icon && FEATURE_ICONS[icon]) || Settings2;
}

function getFeatureIconColor(
  featureId: string,
  enabled: boolean,
  palette: {
    blue: { 400: string };
    yellow: { 400: string };
  },
  foregroundMuted: string,
): string {
  if (!enabled) {
    return foregroundMuted;
  }

  switch (getFeatureHighlightColor(featureId)) {
    case "blue":
      return palette.blue[400];
    case "yellow":
      return palette.yellow[400];
    default:
      return foregroundMuted;
  }
}

const MODE_ICONS = {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  ShieldQuestionMark,
} as const;

type ModeIconName = keyof typeof MODE_ICONS;

function resolveModeIcon(icon: string | undefined) {
  return icon && icon in MODE_ICONS ? MODE_ICONS[icon as ModeIconName] : null;
}

function resolveDisplayModel(
  isModelLoading: boolean,
  modelOptions: StatusOption[] | undefined,
  selectedModelId: string | undefined,
) {
  if (isModelLoading && (!modelOptions || modelOptions.length === 0)) {
    return "Loading models...";
  }
  return findOptionLabel(modelOptions, selectedModelId, "Select model");
}

// Mobile status bar only — strip namespace prefix so providers like OpenCode
// show "gpt-5.5" instead of "openrouter/gpt-5.5". Full label still appears in
// the model picker.
function shortModelLabel(label: string): string {
  const i = label.lastIndexOf("/");
  return i === -1 ? label : label.slice(i + 1);
}

type ActiveSheet = "gateway" | "thinking" | "mode" | "features" | null;

function resolveHasAnyControl({
  providerOptions,
  modeOptions,
  modelGatewayOptions,
  canSelectModel,
  thinkingOptions,
  features,
}: {
  providerOptions: StatusOption[] | undefined;
  modeOptions: StatusOption[] | undefined;
  modelGatewayOptions: StatusOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: StatusOption[] | undefined;
  features: AgentFeature[] | undefined;
}) {
  return (
    Boolean(providerOptions?.length) ||
    Boolean(modeOptions?.length) ||
    Boolean(modelGatewayOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length)
  );
}

function toComboboxOptions(options: StatusOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: StatusOption[] | undefined,
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

function resolveModeVisualsForProvider(
  provider: string,
  selectedModeId: string | undefined,
  providerDefinitions: AgentProviderDefinition[],
  palette: Parameters<typeof getModeIconColor>[1],
) {
  const modeVisuals = selectedModeId
    ? getModeVisuals(provider, selectedModeId, providerDefinitions)
    : undefined;
  const icon = resolveModeIcon(modeVisuals?.icon);
  const color = getModeIconColor(modeVisuals?.colorTier, palette);
  return { icon, color };
}

function resolveProviderIcon(provider: string) {
  if (provider.trim().length === 0) {
    return null;
  }
  return getProviderIcon(provider);
}

type AgentStatusBarSlice = {
  provider: string;
  cwd: string | null;
  currentModeId: string | null | undefined;
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

function selectAgentStatusBarSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentStatusBarSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  const modelGateway = readRuntimeModelGatewayStatus(currentAgent.runtimeInfo?.extra);
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    currentModeId: currentAgent.currentModeId,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    modelGatewayId: modelGateway?.id ?? null,
    modelGatewayLabel: modelGateway?.label ?? null,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
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

function buildActiveModelGatewayOptions(
  id: string | undefined,
  label: string | undefined,
): StatusOption[] | undefined {
  if (!id) {
    return undefined;
  }
  return [
    { id: NATIVE_MODEL_GATEWAY_ID, label: "Native" },
    {
      id,
      label: label?.trim() || id,
    },
  ];
}

function useActiveModelGatewayStatus(agent: AgentStatusBarSlice) {
  const modelGatewayId = agent?.modelGatewayId ?? undefined;
  const modelGatewayLabel = agent?.modelGatewayLabel ?? undefined;
  const options = useMemo(
    () => buildActiveModelGatewayOptions(modelGatewayId, modelGatewayLabel),
    [modelGatewayId, modelGatewayLabel],
  );
  return {
    options,
    selectedId: modelGatewayId,
  };
}

function buildFallbackModeOptions(
  modeOptions: StatusOption[],
  currentModeId: string | null | undefined,
  displayMode: string,
): StatusOption[] {
  if (modeOptions.length > 0) {
    return modeOptions;
  }
  return [{ id: currentModeId ?? "", label: displayMode }];
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

function resolveVisibleThinkingOptions(options: StatusOption[]): StatusOption[] | undefined {
  if (options.length > 1) {
    return options;
  }
  return undefined;
}

function useActiveModelGatewayCatalog(
  serverId: string,
  agent: AgentStatusBarSlice,
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

function buildAgentModelSelectorProviders(input: {
  agentProvider: string | undefined;
  gatewayLabel: string | null | undefined;
  configuredModelGateway: AgentSessionConfig["modelGateway"] | undefined;
  gatewayModels: AgentModelDefinition[];
  providerDefinitions: AgentProviderDefinition[];
  providerModels: Map<string, AgentModelDefinition[]>;
}): ProviderSelectorProvider[] {
  if (input.gatewayModels.length > 0) {
    return buildModelGatewaySelectorProviders({
      provider: input.agentProvider,
      providerLabel:
        input.configuredModelGateway?.label?.trim() || input.gatewayLabel || "Model gateway",
      models: input.gatewayModels,
    });
  }
  return buildProviderSelectorProviders({
    providerDefinitions: input.providerDefinitions,
    modelsByProvider: input.providerModels,
  });
}

function compareAvailableModes(a: AgentMode[], b: AgentMode[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function resolveAgentDisplayMode(
  availableModes: AgentMode[],
  currentModeId: string | null | undefined,
): string {
  const found = availableModes.find((mode) => mode.id === currentModeId);
  return found?.label || currentModeId || "default";
}

function buildOpenChangeHandler(
  selector: StatusSelector,
  setOpenSelector: (next: StatusSelector | null) => void,
  onDropdownClose?: () => void,
) {
  return (nextOpen: boolean) => {
    setOpenSelector(nextOpen ? selector : null);
    if (!nextOpen) {
      onDropdownClose?.();
    }
  };
}

function getModeIconColor(
  colorTier: AgentModeColorTier | undefined,
  palette: {
    blue: { 500: string };
    green: { 500: string };
    red: { 500: string };
    purple: { 500: string };
  },
): string {
  switch (colorTier) {
    case "safe":
      return palette.green[500];
    case "moderate":
      return palette.blue[500];
    case "dangerous":
      return palette.red[500];
    case "planning":
      return palette.purple[500];
    default:
      return palette.blue[500];
  }
}

function ControlledStatusBar({
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modeOptions,
  selectedModeId,
  onSelectMode,
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
  providerDefinitions,
  modelSelectorProviders,
  favoriteKeys = new Set<string>(),
  onToggleFavoriteModel,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
}: ControlledAgentStatusBarProps) {
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<StatusSelector | null>(null);

  const providerAnchorRef = useRef<View>(null);
  const modeAnchorRef = useRef<View>(null);
  const _modelAnchorRef = useRef<View>(null);
  const gatewayAnchorRef = useRef<View>(null);
  const thinkingAnchorRef = useRef<View>(null);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectMode = Boolean(onSelectMode && modeOptions && modeOptions.length > 0);
  const canSelectModel = Boolean(onSelectModel);
  const canSelectModelGateway = Boolean(
    onSelectModelGateway && modelGatewayOptions && modelGatewayOptions.length > 0,
  );
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );

  const displayProvider = findOptionLabel(providerOptions, selectedProviderId, "Provider");
  const displayModel = resolveDisplayModel(isModelLoading, modelOptions, selectedModelId);
  const displayModelGateway = findOptionLabel(
    modelGatewayOptions,
    selectedModelGatewayId,
    "Native",
  );
  const displayThinking = findOptionLabel(
    thinkingOptions,
    selectedThinkingOptionId,
    thinkingOptions?.[0]?.label ?? "Unknown",
  );

  const { icon: ModeIconComponent, color: modeIconColor } = resolveModeVisualsForProvider(
    provider,
    selectedModeId,
    providerDefinitions,
    theme.colors.palette,
  );
  const ProviderIcon = resolveProviderIcon(provider);

  const hasAnyControl = resolveHasAnyControl({
    providerOptions,
    modeOptions,
    modelGatewayOptions,
    canSelectModel,
    thinkingOptions,
    features,
  });

  const modelDisabled = disabled;

  const comboboxProviderOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(providerOptions),
    [providerOptions],
  );
  const comboboxModeOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(modeOptions),
    [modeOptions],
  );
  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(thinkingOptions),
    [thinkingOptions],
  );
  const comboboxModelGatewayOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(modelGatewayOptions),
    [modelGatewayOptions],
  );

  const renderModeOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ModeComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        provider={provider}
        providerDefinitions={providerDefinitions}
        iconColor={theme.colors.foreground}
      />
    ),
    [provider, providerDefinitions, theme.colors.foreground],
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
    (selector: StatusSelector) =>
      buildOpenChangeHandler(selector, setOpenSelector, onDropdownClose),
    [onDropdownClose],
  );

  const handleProviderPress = useCallback(() => {
    handleOpenChange("provider")(openSelector !== "provider");
  }, [handleOpenChange, openSelector]);

  const handleThinkingPress = useCallback(() => {
    handleOpenChange("thinking")(openSelector !== "thinking");
  }, [handleOpenChange, openSelector]);

  const handleGatewayPress = useCallback(() => {
    handleOpenChange("gateway")(openSelector !== "gateway");
  }, [handleOpenChange, openSelector]);

  const handleModePress = useCallback(() => {
    handleOpenChange("mode")(openSelector !== "mode");
  }, [handleOpenChange, openSelector]);

  const handleProviderOpenChange = useMemo(() => handleOpenChange("provider"), [handleOpenChange]);
  const handleGatewayOpenChange = useMemo(() => handleOpenChange("gateway"), [handleOpenChange]);
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);
  const handleModeOpenChange = useMemo(() => handleOpenChange("mode"), [handleOpenChange]);

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );
  const handleGatewaySelect = useCallback(
    (id: string) => onSelectModelGateway?.(id),
    [onSelectModelGateway],
  );
  const handleModeSelect = useCallback((id: string) => onSelectMode?.(id), [onSelectMode]);

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

  const modePressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeIconBadge,
        styles.disabledBadge,
        disabled || !canSelectMode,
        openSelector === "mode",
      ),
    [canSelectMode, disabled, openSelector],
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
      onSelectThinkingOption?.(thinkingOptionId);
      setActiveSheet(null);
    },
    [onSelectThinkingOption],
  );

  const handleSelectGatewayAndClose = useCallback(
    (gatewayId: string) => {
      onSelectModelGateway?.(gatewayId);
      setActiveSheet(null);
    },
    [onSelectModelGateway],
  );

  const handleSelectModeAndClose = useCallback(
    (modeId: string) => {
      onSelectMode?.(modeId);
      setActiveSheet(null);
    },
    [onSelectMode],
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
        <DesktopStatusBarContent
          provider={provider}
          providerOptions={providerOptions}
          selectedProviderId={selectedProviderId}
          modeOptions={modeOptions}
          selectedModeId={selectedModeId}
          modelOptions={modelOptions}
          selectedModelId={selectedModelId}
          modelGatewayOptions={modelGatewayOptions}
          selectedModelGatewayId={selectedModelGatewayId}
          thinkingOptions={thinkingOptions}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={onSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          providerDefinitions={providerDefinitions}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectProvider={canSelectProvider}
          canSelectMode={canSelectMode}
          canSelectModel={canSelectModel}
          canSelectModelGateway={canSelectModelGateway}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxProviderOptions={comboboxProviderOptions}
          comboboxModeOptions={comboboxModeOptions}
          comboboxModelGatewayOptions={comboboxModelGatewayOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          displayProvider={displayProvider}
          displayModel={displayModel}
          displayModelGateway={displayModelGateway}
          displayThinking={displayThinking}
          ModeIconComponent={ModeIconComponent}
          modeIconColor={modeIconColor}
          openSelector={openSelector}
          providerAnchorRef={providerAnchorRef}
          gatewayAnchorRef={gatewayAnchorRef}
          thinkingAnchorRef={thinkingAnchorRef}
          modeAnchorRef={modeAnchorRef}
          providerPressableStyle={providerPressableStyle}
          gatewayPressableStyle={gatewayPressableStyle}
          thinkingPressableStyle={thinkingPressableStyle}
          modePressableStyle={modePressableStyle}
          handleProviderPress={handleProviderPress}
          handleGatewayPress={handleGatewayPress}
          handleThinkingPress={handleThinkingPress}
          handleModePress={handleModePress}
          handleProviderSelect={handleProviderSelect}
          handleGatewaySelect={handleGatewaySelect}
          handleThinkingSelect={handleThinkingSelect}
          handleModeSelect={handleModeSelect}
          handleDesktopModelSelect={handleDesktopModelSelect}
          handleProviderOpenChange={handleProviderOpenChange}
          handleGatewayOpenChange={handleGatewayOpenChange}
          handleThinkingOpenChange={handleThinkingOpenChange}
          handleModeOpenChange={handleModeOpenChange}
          handleOpenChange={handleOpenChange}
          renderModeOption={renderModeOption}
          renderThinkingOption={renderThinkingOption}
        />
      ) : (
        <SheetStatusBarContent
          provider={provider}
          selectedModeId={selectedModeId}
          selectedModelId={selectedModelId}
          modelGatewayOptions={modelGatewayOptions}
          selectedModelGatewayId={selectedModelGatewayId}
          selectedThinkingOptionId={selectedThinkingOptionId}
          features={features}
          onSetFeature={onSetFeature}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectMode={canSelectMode}
          canSelectModel={canSelectModel}
          canSelectModelGateway={canSelectModelGateway}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxModeOptions={comboboxModeOptions}
          comboboxModelGatewayOptions={comboboxModelGatewayOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          ModeIconComponent={ModeIconComponent}
          modeIconColor={modeIconColor}
          openSelector={openSelector}
          ProviderIcon={ProviderIcon}
          activeSheet={activeSheet}
          handleOpenSheet={handleOpenSheet}
          handleCloseSheet={handleCloseSheet}
          handleSheetModelSelect={handleSheetModelSelect}
          handleSelectGatewayAndClose={handleSelectGatewayAndClose}
          handleSelectThinkingAndClose={handleSelectThinkingAndClose}
          handleSelectModeAndClose={handleSelectModeAndClose}
          handleOpenChange={handleOpenChange}
          renderModeOption={renderModeOption}
          renderThinkingOption={renderThinkingOption}
        />
      )}
    </View>
  );
}

interface DesktopStatusBarContentProps {
  provider: string;
  providerOptions?: StatusOption[];
  selectedProviderId?: string;
  modeOptions?: StatusOption[];
  selectedModeId?: string;
  modelOptions?: StatusOption[];
  selectedModelId?: string;
  modelGatewayOptions?: StatusOption[];
  selectedModelGatewayId?: string;
  thinkingOptions?: StatusOption[];
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  providerDefinitions: AgentProviderDefinition[];
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectMode: boolean;
  canSelectModel: boolean;
  canSelectModelGateway: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxProviderOptions: ComboboxOption[];
  comboboxModeOptions: ComboboxOption[];
  comboboxModelGatewayOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  displayProvider: string;
  displayModel: string;
  displayModelGateway: string;
  displayThinking: string;
  ModeIconComponent: (typeof MODE_ICONS)[keyof typeof MODE_ICONS] | null;
  modeIconColor: string;
  openSelector: StatusSelector | null;
  providerAnchorRef: RefObject<View | null>;
  gatewayAnchorRef: RefObject<View | null>;
  thinkingAnchorRef: RefObject<View | null>;
  modeAnchorRef: RefObject<View | null>;
  providerPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  gatewayPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  thinkingPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  modePressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleProviderPress: () => void;
  handleGatewayPress: () => void;
  handleThinkingPress: () => void;
  handleModePress: () => void;
  handleProviderSelect: (id: string) => void;
  handleGatewaySelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleModeSelect: (id: string) => void;
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  handleProviderOpenChange: (open: boolean) => void;
  handleGatewayOpenChange: (open: boolean) => void;
  handleThinkingOpenChange: (open: boolean) => void;
  handleModeOpenChange: (open: boolean) => void;
  handleOpenChange: (selector: StatusSelector) => (nextOpen: boolean) => void;
  renderModeOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

const DESKTOP_SEARCH_THRESHOLD = 6;

function DesktopStatusBarContent(props: DesktopStatusBarContentProps) {
  const { theme } = useUnistyles();
  const {
    provider,
    providerOptions,
    selectedProviderId,
    modeOptions,
    selectedModeId,
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
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectProvider,
    canSelectMode,
    canSelectModel,
    canSelectModelGateway,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxProviderOptions,
    comboboxModeOptions,
    comboboxModelGatewayOptions,
    comboboxThinkingOptions,
    displayProvider,
    displayModel,
    displayModelGateway,
    displayThinking,
    ModeIconComponent,
    modeIconColor,
    openSelector,
    providerAnchorRef,
    gatewayAnchorRef,
    thinkingAnchorRef,
    modeAnchorRef,
    providerPressableStyle,
    gatewayPressableStyle,
    thinkingPressableStyle,
    modePressableStyle,
    handleProviderPress,
    handleGatewayPress,
    handleThinkingPress,
    handleModePress,
    handleProviderSelect,
    handleGatewaySelect,
    handleThinkingSelect,
    handleModeSelect,
    handleDesktopModelSelect,
    handleProviderOpenChange,
    handleGatewayOpenChange,
    handleThinkingOpenChange,
    handleModeOpenChange,
    handleOpenChange,
    renderModeOption,
    renderThinkingOption,
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
            accessibilityLabel="Select agent provider"
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
        <Tooltip
          key={`model-${displayModel}`}
          delayDuration={0}
          enabledOnDesktop
          enabledOnMobile={false}
        >
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
              />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{getAgentControlHint("model")}</Text>
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
                accessibilityLabel={`Select thinking option (${displayThinking})`}
                testID="agent-thinking-selector"
              >
                <Brain size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
                <Text style={styles.modeBadgeText}>{displayThinking}</Text>
                <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{getAgentControlHint("thinking")}</Text>
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

      {modeOptions && modeOptions.length > 0 ? (
        <>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild triggerRefProp="ref">
              <Pressable
                ref={modeAnchorRef}
                collapsable={false}
                disabled={disabled || !canSelectMode}
                onPress={handleModePress}
                style={modePressableStyle}
                accessibilityRole="button"
                accessibilityLabel={`Select agent mode (${selectedModeId ?? ""})`}
                testID="agent-mode-selector"
              >
                {ModeIconComponent ? (
                  <ModeIconComponent size={theme.iconSize.md} color={modeIconColor} />
                ) : (
                  <ShieldCheck size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
                )}
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{getAgentControlHint("mode")}</Text>
            </TooltipContent>
          </Tooltip>
          <Combobox
            options={comboboxModeOptions}
            value={selectedModeId ?? ""}
            onSelect={handleModeSelect}
            searchable={comboboxModeOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "mode"}
            onOpenChange={handleModeOpenChange}
            anchorRef={modeAnchorRef}
            desktopPlacement="top-start"
            renderOption={renderModeOption}
          />
        </>
      ) : null}

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
  modelGatewayOptions?: StatusOption[];
  selectedModelGatewayId?: string;
  canSelectModelGateway: boolean;
  disabled: boolean;
  displayModelGateway: string;
  comboboxModelGatewayOptions: ComboboxOption[];
  openSelector: StatusSelector | null;
  gatewayAnchorRef: RefObject<View | null>;
  gatewayPressableStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  handleGatewayPress: () => void;
  handleGatewaySelect: (id: string) => void;
  handleGatewayOpenChange: (open: boolean) => void;
}) {
  const { theme } = useUnistyles();
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
            accessibilityLabel={`Select model gateway (${displayModelGateway})`}
            testID="agent-model-gateway-selector"
          >
            <Route size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
            <Text style={styles.modeBadgeText}>{displayModelGateway}</Text>
            <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{getAgentControlHint("gateway")}</Text>
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

interface SheetStatusBarContentProps {
  provider: string;
  selectedModeId?: string;
  selectedModelId?: string;
  modelGatewayOptions?: StatusOption[];
  selectedModelGatewayId?: string;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectMode: boolean;
  canSelectModel: boolean;
  canSelectModelGateway: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxModeOptions: ComboboxOption[];
  comboboxModelGatewayOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  ModeIconComponent: (typeof MODE_ICONS)[keyof typeof MODE_ICONS] | null;
  modeIconColor: string;
  openSelector: StatusSelector | null;
  ProviderIcon: ReturnType<typeof getProviderIcon> | null;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  handleSelectGatewayAndClose: (gatewayId: string) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleSelectModeAndClose: (modeId: string) => void;
  handleOpenChange: (selector: StatusSelector) => (nextOpen: boolean) => void;
  renderModeOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

function SheetStatusBarContent(props: SheetStatusBarContentProps) {
  const { theme } = useUnistyles();
  const {
    provider,
    selectedModeId,
    selectedModelId,
    modelGatewayOptions,
    selectedModelGatewayId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectMode,
    canSelectModel,
    canSelectModelGateway,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxModeOptions,
    comboboxModelGatewayOptions,
    comboboxThinkingOptions,
    ModeIconComponent,
    modeIconColor,
    openSelector,
    ProviderIcon,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectGatewayAndClose,
    handleSelectThinkingAndClose,
    handleSelectModeAndClose,
    handleOpenChange,
    renderModeOption,
    renderThinkingOption,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);
  const modeAnchorRef = useRef<View | null>(null);

  const hasThinking = comboboxThinkingOptions.length > 0;
  const hasMode = Boolean(canSelectMode && comboboxModeOptions.length > 0);
  const hasFeatures = Boolean(features && features.length > 0);

  const handleOpenThinking = useCallback(() => handleOpenSheet("thinking"), [handleOpenSheet]);
  const handleOpenMode = useCallback(() => handleOpenSheet("mode"), [handleOpenSheet]);
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
  const handleModeSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("mode");
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
      <View pointerEvents="none" style={styles.prefsButton} testID="agent-status-bar-model">
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
  const modeButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled || !canSelectMode,
    activeSheet === "mode",
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
          renderTrigger={renderModelTrigger}
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
          accessibilityLabel="Select thinking option"
          testID="agent-status-bar-thinking"
        >
          <Brain size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}

      {hasMode ? (
        <Pressable
          ref={modeAnchorRef}
          onPress={handleOpenMode}
          disabled={disabled || !canSelectMode}
          style={modeButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select agent mode (${selectedModeId ?? ""})`}
          testID="agent-preferences-mode"
        >
          {ModeIconComponent ? (
            <ModeIconComponent size={theme.iconSize.md} color={modeIconColor} />
          ) : (
            <ShieldCheck size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
          )}
        </Pressable>
      ) : null}

      {hasFeatures ? (
        <Pressable
          onPress={handleOpenFeatures}
          disabled={disabled}
          style={featuresButtonStyle}
          accessibilityRole="button"
          accessibilityLabel="Open agent features"
          testID="agent-status-bar-features"
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
          title="Thinking"
          open={activeSheet === "thinking"}
          onOpenChange={handleThinkingSheetOpenChange}
          anchorRef={thinkingAnchorRef}
          renderOption={renderThinkingOption}
        />
      ) : null}

      {hasMode ? (
        <Combobox
          options={comboboxModeOptions}
          value={selectedModeId ?? ""}
          onSelect={handleSelectModeAndClose}
          searchable={false}
          title="Mode"
          open={activeSheet === "mode"}
          onOpenChange={handleModeSheetOpenChange}
          renderOption={renderModeOption}
          anchorRef={modeAnchorRef}
        />
      ) : null}

      <AdaptiveModalSheet
        header={FEATURES_SHEET_HEADER}
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
  modelGatewayOptions?: StatusOption[];
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
        accessibilityLabel="Select model gateway"
        testID="agent-status-bar-gateway"
      >
        <Route size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Combobox
        options={comboboxModelGatewayOptions}
        value={selectedModelGatewayId ?? ""}
        onSelect={handleSelectGatewayAndClose}
        searchable={false}
        title="Model Gateway"
        open={activeSheet === "gateway"}
        onOpenChange={handleGatewaySheetOpenChange}
        anchorRef={gatewayAnchorRef}
      />
    </>
  );
}

function DesktopFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: StatusSelector | null;
  handleOpenChange: (selector: StatusSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const featureSelector: StatusSelector = `feature-${feature.id}`;

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
    const FeatureIcon = getFeatureIcon(feature.icon);
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
              color={getFeatureIconColor(
                feature.id,
                feature.value,
                theme.colors.palette,
                theme.colors.foregroundMuted,
              )}
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
    const FeatureIcon = getFeatureIcon(feature.icon);
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
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: StatusSelector | null;
  handleOpenChange: (selector: StatusSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { theme } = useUnistyles();
  const featureSelector: StatusSelector = `feature-${feature.id}`;

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
    const FeatureIcon = getFeatureIcon(feature.icon);
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
            color={getFeatureIconColor(
              feature.id,
              feature.value,
              theme.colors.palette,
              theme.colors.foregroundMuted,
            )}
          />
          <Text style={styles.sheetSelectText}>{feature.label}</Text>
          <Text style={styles.modeBadgeText}>{feature.value ? "On" : "Off"}</Text>
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

function ModeComboboxOption({
  option,
  selected,
  active,
  onPress,
  provider,
  providerDefinitions,
  iconColor,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  iconColor: string;
}) {
  const visuals = getModeVisuals(provider, option.id, providerDefinitions);
  const IconComponent = resolveModeIcon(visuals?.icon) ?? ShieldCheck;
  const leadingSlot = useMemo(
    () => <IconComponent size={16} color={iconColor} />,
    [IconComponent, iconColor],
  );
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

const EMPTY_MODES: AgentMode[] = [];
const FEATURES_SHEET_HEADER: SheetHeader = { title: "Features" };

function useAgentStatusActions(input: {
  agentId: string;
  agentProvider: string | undefined;
  activeModelId: string | null | undefined;
  client: DaemonClient | null;
  toast: ReturnType<typeof useToast>;
  updatePreferences: UseFormPreferencesReturn["updatePreferences"];
}) {
  const { activeModelId, agentId, agentProvider, client, toast, updatePreferences } = input;
  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (!client) {
        return;
      }
      void client.setAgentMode(agentId, modeId).catch((error) => {
        console.warn("[AgentStatusBar] setAgentMode failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, client, toast],
  );

  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: { model: modelId },
        }),
      ).catch((error) => {
        console.warn("[AgentStatusBar] persist model preference failed", error);
      });
      void client.setAgentModel(agentId, modelId).catch((error) => {
        console.warn("[AgentStatusBar] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
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
              thinkingByModel: { [activeModelId]: thinkingOptionId },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentStatusBar] persist thinking preference failed", error);
        });
      }
      void client.setAgentThinkingOption(agentId, thinkingOptionId).catch((error) => {
        console.warn("[AgentStatusBar] setAgentThinkingOption failed", error);
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
          updates: { featureValues: { [featureId]: value } },
        }),
      ).catch((error) => {
        console.warn("[AgentStatusBar] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentStatusBar] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  return { handleSelectMode, handleSelectModel, handleSelectThinkingOption, handleSetFeature };
}

export const AgentStatusBar = memo(function AgentStatusBar({
  agentId,
  serverId,
  onDropdownClose,
}: AgentStatusBarProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const agent = useSessionStore(
    useShallow((state) => selectAgentStatusBarSlice(state, serverId, agentId)),
  );
  const availableModes = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.availableModes ?? EMPTY_MODES,
    compareAvailableModes,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId);
  const { config: daemonConfig } = useDaemonConfig(serverId);

  const snapshotSelectedEntry = useMemo(
    () => resolveSnapshotSelectedEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );

  const models = snapshotSelectedEntry?.models ?? null;
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
    [activeModels, agent?.provider],
  );
  const agentModelSelectorProviders = useMemo(
    () =>
      buildAgentModelSelectorProviders({
        agentProvider: agent?.provider,
        gatewayLabel: agent?.modelGatewayLabel,
        configuredModelGateway,
        gatewayModels,
        providerDefinitions: agentProviderDefinitions,
        providerModels: agentProviderModels,
      }),
    [
      agent?.modelGatewayLabel,
      agent?.provider,
      agentProviderDefinitions,
      agentProviderModels,
      configuredModelGateway,
      gatewayModels,
    ],
  );

  const displayMode = resolveAgentDisplayMode(availableModes, agent?.currentModeId);

  const modelSelection = resolveAgentModelSelection({
    models: activeModels,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modeOptions = useMemo<StatusOption[]>(() => {
    return availableModes.map((mode) => ({
      id: mode.id,
      label: mode.label,
    }));
  }, [availableModes]);

  const modelOptions = useMemo<StatusOption[]>(() => {
    return (activeModels ?? []).map((model) => ({ id: model.id, label: model.label }));
  }, [activeModels]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const thinkingOptions = useMemo<StatusOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: option.label,
    }));
  }, [modelSelection.thinkingOptions]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;

  const { handleSelectMode, handleSelectModel, handleSelectThinkingOption, handleSetFeature } =
    useAgentStatusActions({
      agentId,
      agentProvider,
      activeModelId,
      client,
      toast,
      updatePreferences,
    });

  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[AgentStatusBar] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale(agentProvider);
  }, [agentProvider, refetchSnapshotIfStale]);

  const fallbackModeOptions = useMemo<StatusOption[]>(
    () => buildFallbackModeOptions(modeOptions, agent?.currentModeId, displayMode),
    [agent?.currentModeId, displayMode, modeOptions],
  );
  const activeModelGatewayStatus = useActiveModelGatewayStatus(agent);

  if (!agent) {
    return null;
  }

  return (
    <ControlledStatusBar
      provider={agent.provider}
      modeOptions={fallbackModeOptions}
      selectedModeId={agent.currentModeId ?? undefined}
      providerDefinitions={agentProviderDefinitions}
      modelSelectorProviders={agentModelSelectorProviders}
      onSelectMode={handleSelectMode}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      onSelectModel={handleSelectModel}
      modelGatewayOptions={activeModelGatewayStatus.options}
      selectedModelGatewayId={activeModelGatewayStatus.selectedId}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      thinkingOptions={resolveVisibleThinkingOptions(thinkingOptions)}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={snapshotIsLoading || selectedProviderIsLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onDropdownClose={onDropdownClose}
      disabled={!client}
    />
  );
});

export function DraftAgentStatusBar({
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
  disabled = false,
}: DraftAgentStatusBarProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const isCompact = useIsCompactFormFactor();

  const mappedModeOptions = useMemo<StatusOption[]>(() => {
    if (modeOptions.length === 0) {
      return [{ id: "", label: "Default" }];
    }
    return modeOptions.map((mode) => ({
      id: mode.id,
      label: mode.label,
    }));
  }, [modeOptions]);

  const mappedThinkingOptions = useMemo<StatusOption[]>(() => {
    return thinkingOptions.map((option) => ({ id: option.id, label: option.label }));
  }, [thinkingOptions]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const effectiveSelectedMode = selectedMode || mappedModeOptions[0]?.id || "";
  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;
  const hasSelectedProvider = selectedProvider !== null;

  const modelOptions = useMemo<StatusOption[]>(
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
        console.warn("[DraftAgentStatusBar] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
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
        />
        {selectedProvider ? (
          <ControlledStatusBar
            provider={selectedProvider}
            providerDefinitions={providerDefinitions}
            modeOptions={mappedModeOptions}
            selectedModeId={effectiveSelectedMode}
            onSelectMode={onSelectMode}
            modelGatewayOptions={modelGatewayOptions}
            selectedModelGatewayId={selectedModelGatewayId}
            onSelectModelGateway={onSelectModelGateway}
            thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
            selectedThinkingOptionId={effectiveSelectedThinkingOption}
            onSelectThinkingOption={onSelectThinkingOption}
            features={features}
            onSetFeature={onSetFeature}
            onDropdownClose={onDropdownClose}
            disabled={disabled}
          />
        ) : null}
      </View>
    );
  }

  return (
    <ControlledStatusBar
      provider={selectedProvider ?? ""}
      providerDefinitions={providerDefinitions}
      modelSelectorProviders={modelSelectorProviders}
      modeOptions={hasSelectedProvider ? mappedModeOptions : undefined}
      selectedModeId={effectiveSelectedMode}
      onSelectMode={onSelectMode}
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
      disabled={disabled}
    />
  );
}

export const AgentControls = AgentStatusBar;
export const DraftAgentControls = DraftAgentStatusBar;

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
