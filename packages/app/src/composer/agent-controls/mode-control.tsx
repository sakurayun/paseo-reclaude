import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  Bot,
  ChevronDown,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldQuestionMark,
} from "lucide-react-native";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { useToast } from "@/contexts/toast-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { toErrorMessage } from "@/utils/error-messages";
import { formatAgentModeLabel } from "@/composer/agent-controls/utils";
import type { AgentMode, AgentProvider } from "@getpaseo/protocol/agent-types";
import {
  getModeVisuals,
  type AgentModeColorTier,
  type AgentProviderDefinition,
} from "@getpaseo/protocol/provider-manifest";

export type AgentModeControlPlacement = "toolbar" | "footer";

// Cyan-blue accent for planning modes (the theme palette has no cyan scale).
const PLAN_MODE_COLOR = "#1ba6c4";

// Maps a mode's permission tier to an accent color so the selected chip and the
// dropdown icons signal risk: bypass/dangerous → red, auto-accept/moderate → yellow,
// plan/planning → cyan-blue. Safe and unknown tiers stay muted (return null).
function getModeTierColor(
  colorTier: AgentModeColorTier | undefined,
  theme: ReturnType<typeof useUnistyles>["theme"],
): string | null {
  if (!colorTier) return null;
  if (colorTier.startsWith("#")) return colorTier;
  switch (colorTier) {
    case "dangerous":
      return theme.colors.palette.red[500];
    case "moderate":
      return theme.colors.palette.yellow[400];
    case "planning":
      return PLAN_MODE_COLOR;
    default:
      return null;
  }
}

function shouldRenderForPlacement(placement: AgentModeControlPlacement, isCompact: boolean) {
  return placement === "footer" ? isCompact : !isCompact;
}

interface ModeIconProps {
  size?: number;
  color?: string;
}

const MODE_ICONS: Record<string, ComponentType<ModeIconProps>> = {
  Bot,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  ShieldQuestionMark,
};

interface ModeComboboxOptionProps {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  iconColor: string;
}

function ModeComboboxOption({
  option,
  selected,
  active,
  onPress,
  provider,
  providerDefinitions,
  iconColor,
}: ModeComboboxOptionProps) {
  const { theme } = useUnistyles();
  const visuals = getModeVisuals(provider, option.id, providerDefinitions);
  const IconComponent = visuals?.icon ? MODE_ICONS[visuals.icon] : undefined;
  const optionIconColor = getModeTierColor(visuals?.colorTier, theme) ?? iconColor;
  const leadingSlot = useMemo(
    () => (IconComponent ? <IconComponent size={16} color={optionIconColor} /> : null),
    [IconComponent, optionIconColor],
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

interface AgentModeControlViewProps {
  provider: string;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedModeId: string | null | undefined;
  onSelectMode: (modeId: string) => void;
  disabled?: boolean;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function AgentModeControlView({
  provider,
  providerDefinitions,
  modeOptions,
  selectedModeId,
  onSelectMode,
  disabled = false,
}: AgentModeControlViewProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("composer");
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedMode = useMemo(() => {
    if (modeOptions.length === 0) return null;
    return modeOptions.find((m) => m.id === selectedModeId) ?? modeOptions[0];
  }, [modeOptions, selectedModeId]);

  const visuals = selectedMode
    ? getModeVisuals(provider, selectedMode.id, providerDefinitions)
    : undefined;
  const Icon = visuals?.icon ? MODE_ICONS[visuals.icon] : undefined;
  const tierColor = getModeTierColor(visuals?.colorTier, theme);
  const iconColor = tierColor ?? theme.colors.foregroundMuted;
  const selectedModeLabel = selectedMode ? formatAgentModeLabel(selectedMode) : "";

  const allOptions = useMemo<ComboboxOption[]>(
    () => modeOptions.map((m) => ({ id: m.id, label: formatAgentModeLabel(m) })),
    [modeOptions],
  );
  const options = useMemo<ComboboxOption[]>(() => {
    const q = normalizeSearchQuery(searchQuery);
    if (!q) return allOptions;
    return allOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [allOptions, searchQuery]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setSearchQuery("");
  }, []);

  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelectMode(id);
      handleOpenChange(false);
    },
    [onSelectMode, handleOpenChange],
  );

  const renderOption = useCallback(
    (args: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => (
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

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.chip,
      hovered && styles.chipHovered,
      (pressed || open) && styles.chipPressed,
      disabled && styles.chipDisabled,
    ],
    [open, disabled],
  );

  const labelStyle = useMemo(
    () => (tierColor ? [styles.chipLabel, { color: tierColor }] : styles.chipLabel),
    [tierColor],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: t("controls.mode.sheetTitle"),
      search: {
        onChange: setSearchQuery,
        placeholder: t("controls.mode.searchPlaceholder"),
        testID: "mode-search-input",
      },
    }),
    [t],
  );

  if (!selectedMode) return null;

  return (
    <>
      <Pressable
        ref={anchorRef}
        collapsable={false}
        disabled={disabled}
        onPress={handlePress}
        style={pressableStyle}
        accessibilityRole="button"
        accessibilityLabel={t("controls.mode.selectAccessibilityLabelWithValue", {
          value: selectedModeLabel,
        })}
        testID="mode-control"
      >
        {Icon ? <Icon size={theme.iconSize.md} color={iconColor} /> : null}
        <Text style={labelStyle}>{selectedModeLabel}</Text>
        <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Combobox
        options={options}
        value={selectedMode.id}
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        header={sheetHeader}
        renderOption={renderOption}
      />
    </>
  );
}

const EMPTY_MODES: AgentMode[] = [];

function compareAvailableModes(a: AgentMode[], b: AgentMode[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

interface AgentModeControlProps {
  serverId: string;
  agentId: string;
  placement: AgentModeControlPlacement;
  isCompactLayout?: boolean;
}

export const AgentModeControl = memo(function AgentModeControl({
  serverId,
  agentId,
  placement,
  isCompactLayout,
}: AgentModeControlProps) {
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const slice = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      if (!agent) return null;
      return {
        provider: agent.provider,
        cwd: agent.cwd,
        currentModeId: agent.currentModeId,
      };
    }),
  );
  const availableModes = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.availableModes ?? EMPTY_MODES,
    compareAvailableModes,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId, { cwd: slice?.cwd });

  const providerDefinitions = useMemo<AgentProviderDefinition[]>(() => {
    if (!slice?.provider) return [];
    const definition = resolveProviderDefinition(slice.provider, snapshotEntries);
    return definition ? [definition] : [];
  }, [slice?.provider, snapshotEntries]);

  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (!client) return;
      void client.setAgentMode(agentId, modeId).catch((error) => {
        console.warn("[AgentModeControl] setAgentMode failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, client, toast],
  );

  if (!slice || availableModes.length === 0) return null;
  if (!shouldRenderForPlacement(placement, isCompact)) return null;

  return (
    <AgentModeControlView
      provider={slice.provider}
      providerDefinitions={providerDefinitions}
      modeOptions={availableModes}
      selectedModeId={slice.currentModeId}
      onSelectMode={handleSelectMode}
      disabled={!client}
    />
  );
});

export interface DraftAgentModeControlProps {
  selectedProvider: AgentProvider | null;
  providerDefinitions: AgentProviderDefinition[];
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  disabled?: boolean;
  placement: AgentModeControlPlacement;
  isCompactLayout?: boolean;
}

export function DraftAgentModeControl({
  selectedProvider,
  providerDefinitions,
  modeOptions,
  selectedMode,
  onSelectMode,
  disabled,
  placement,
  isCompactLayout,
}: DraftAgentModeControlProps) {
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  if (!selectedProvider || modeOptions.length === 0) return null;
  if (!shouldRenderForPlacement(placement, isCompact)) return null;
  return (
    <AgentModeControlView
      provider={selectedProvider}
      providerDefinitions={providerDefinitions}
      modeOptions={modeOptions}
      selectedModeId={selectedMode}
      onSelectMode={onSelectMode}
      disabled={disabled}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipPressed: {
    backgroundColor: theme.colors.surface0,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
