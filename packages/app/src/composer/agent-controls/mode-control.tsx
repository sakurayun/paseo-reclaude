import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  Bot,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  ShieldOff,
  ShieldPlus,
  ShieldQuestionMark,
} from "lucide-react-native";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { formatAgentModeLabel, getAgentControlHintKey } from "@/composer/agent-controls/utils";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { resolveNextAgentModeId } from "@/composer/agent-controls/mode";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import type { AgentMode, AgentProvider } from "@getpaseo/protocol/agent-types";
import {
  getModeVisuals,
  type AgentModeColorTier,
  type AgentProviderDefinition,
} from "@getpaseo/protocol/provider-manifest";

export type AgentModeControlPlacement = "toolbar" | "footer";

function shouldRenderForPlacement(placement: AgentModeControlPlacement, isCompact: boolean) {
  return placement === "footer" ? isCompact : !isCompact;
}

interface ModeIconProps {
  size?: number;
  color?: string;
}

const MODE_ICONS: Record<string, ComponentType<ModeIconProps>> = {
  Bot,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldEllipsis,
  ShieldOff,
  ShieldPlus,
  ShieldQuestionMark,
};

// Color the mode by what it does: red for bypass (dangerous), cyan for plan
// (planning), purple for accept-file-edits, orange for the remaining
// auto-approval tiers. "safe" modes keep the default muted styling (null).
function getModeAccentColor(
  modeId: string,
  colorTier: AgentModeColorTier | undefined,
  theme: Theme,
): string | null {
  if (colorTier?.startsWith("#")) return colorTier;
  if (modeId === "acceptEdits") return theme.colors.statusMerged;
  switch (colorTier) {
    case "dangerous":
      return theme.colors.statusDanger;
    case "planning":
      return theme.colors.statusPlanning;
    case "moderate":
      return theme.colors.statusWarning;
    default:
      return null;
  }
}

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
  const accentColor = getModeAccentColor(option.id, visuals?.colorTier, theme);
  const IconComponent = visuals?.icon ? MODE_ICONS[visuals.icon] : undefined;
  const resolvedIconColor = accentColor ?? iconColor;
  const leadingSlot = useMemo(
    () => (IconComponent ? <IconComponent size={16} color={resolvedIconColor} /> : null),
    [IconComponent, resolvedIconColor],
  );
  const labelStyle = useMemo(
    () =>
      accentColor ? { color: accentColor, fontWeight: theme.fontWeight.bold as "bold" } : null,
    [accentColor, theme.fontWeight.bold],
  );
  return (
    <ComboboxItem
      label={option.label}
      labelStyle={labelStyle}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export interface AgentModeControlValue {
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

export function AgentModeControl({
  provider,
  providerDefinitions,
  modeOptions,
  selectedModeId,
  onSelectMode,
  disabled = false,
  surface = "toolbar",
  onClose,
}: AgentModeControlValue & { surface?: "toolbar" | "sheet"; onClose?: () => void }) {
  const { theme } = useUnistyles();
  const { presentation } = useComposerControlLayout();
  const { t } = useTranslation();
  const { isActiveComposer } = useComposerKeyboardScope();
  const cycleShortcutKeys = useShortcutKeys("cycle-agent-mode");
  const anchorRef = useRef<View>(null);
  const keyboardHandlerIdRef = useRef(`mode-control:${Math.random().toString(36).slice(2)}`);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedMode = useMemo(() => {
    if (modeOptions.length === 0) return null;
    return modeOptions.find((m) => m.id === selectedModeId) ?? modeOptions[0];
  }, [modeOptions, selectedModeId]);

  const visuals = selectedMode
    ? getModeVisuals(provider, selectedMode.id, providerDefinitions)
    : undefined;
  const Icon = visuals?.icon ? (MODE_ICONS[visuals.icon] ?? Bot) : Bot;
  const accentColor = selectedMode
    ? getModeAccentColor(selectedMode.id, visuals?.colorTier, theme)
    : null;
  const iconColor = accentColor ?? theme.colors.foregroundMuted;
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

  const handleOpenChange = useCallback(
    (next: boolean) => {
      const wasOpen = openRef.current;
      openRef.current = next;
      setOpen(next);
      if (!next) {
        setSearchQuery("");
        if (wasOpen) onClose?.();
      }
    },
    [onClose],
  );

  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelectMode(id);
      handleOpenChange(false);
    },
    [onSelectMode, handleOpenChange],
  );

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.mode-cycle") return false;
      if (disabled || !isActiveComposer) return false;
      const nextModeId = resolveNextAgentModeId({ modeOptions, selectedMode: selectedModeId });
      if (!nextModeId) return false;
      onSelectMode(nextModeId);
      return true;
    },
    [disabled, isActiveComposer, modeOptions, onSelectMode, selectedModeId],
  );

  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: ["message-input.mode-cycle"],
    enabled: isActiveComposer && !disabled && modeOptions.length > 1,
    priority: 200,
    handle: handleKeyboardAction,
  });

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

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: t("agentControls.mode.title"),
      search: {
        onChange: setSearchQuery,
        placeholder: t("agentControls.mode.searchPlaceholder"),
        testID: "mode-search-input",
      },
    }),
    [t],
  );

  if (!selectedMode) return null;

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            ref={anchorRef}
            icon={Icon}
            iconColor={iconColor}
            surface={surface}
            label={t("agentControls.mode.title")}
            value={selectedModeLabel}
            showToolbarLabel={presentation.showModeLabel}
            showCaret={surface === "toolbar" && presentation.showCarets}
            open={open}
            disabled={disabled}
            onPress={handlePress}
            accessibilityLabel={t("agentControls.mode.selectWithValue", {
              value: selectedModeLabel,
            })}
            testID="mode-control"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{t(getAgentControlHintKey("mode"))}</Text>
            {isActiveComposer && cycleShortcutKeys ? <Shortcut chord={cycleShortcutKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={options}
        value={selectedMode.id}
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={260}
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

export function useLiveAgentModeControl(
  serverId: string,
  agentId: string,
): AgentModeControlValue | null {
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
  const { updatePreferences } = useFormPreferences();
  const toast = useToast();
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId, { cwd: slice?.cwd });

  const providerDefinitions = useMemo<AgentProviderDefinition[]>(() => {
    if (!slice?.provider) return [];
    const definition = resolveProviderDefinition(slice.provider, snapshotEntries);
    return definition ? [definition] : [];
  }, [slice?.provider, snapshotEntries]);

  const handleSelectMode = useCallback(
    (modeId: string) => {
      if (!client || !slice?.provider) return;
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: slice.provider,
          updates: {
            mode: modeId || undefined,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentModeControl] persist mode preference failed", error);
      });
      void client
        .setAgentMode(agentId, modeId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentModeControl] setAgentMode failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [agentId, client, slice?.provider, toast, updatePreferences],
  );

  return useMemo(() => {
    if (!slice || availableModes.length === 0) return null;
    return {
      provider: slice.provider,
      providerDefinitions,
      modeOptions: availableModes,
      selectedModeId: slice.currentModeId,
      onSelectMode: handleSelectMode,
      disabled: !client,
    };
  }, [availableModes, client, handleSelectMode, providerDefinitions, slice]);
}

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
    <AgentModeControl
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
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
