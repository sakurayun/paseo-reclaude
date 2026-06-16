import { useCallback, useMemo, useState } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, ChevronRight, MessageSquareQuote } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCommitMessagePresetsStore } from "@/git/commit-message-presets-store";

const ThemedMessageSquareQuote = withUnistyles(MessageSquareQuote);
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const BACK_LEADING = <ThemedChevronLeft size={14} uniProps={mutedIconMapping} />;
const MANAGE_TRAILING = <ThemedChevronRight size={14} uniProps={mutedIconMapping} />;

const TRIGGER_ICON_SIZE = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;

/**
 * Reusable preset-message picker rendered at the composer's bottom-right.
 * Picking a preset fills the composer it lives in (never sends); presets are
 * user-managed via the global {@link useCommitMessagePresetsStore}: save the
 * current draft, add via a text modal, or delete from the in-menu manage page.
 */
type PresetsPage = "root" | "delete";

type PresetsEntry =
  | { type: "separator"; key: string }
  | { type: "info"; key: string; label: string }
  | { type: "pick"; key: string; label: string }
  | { type: "save-current"; key: string; label: string; disabled: boolean }
  | { type: "add"; key: string; label: string }
  | { type: "manage"; key: string; label: string }
  | { type: "back"; key: string; label: string }
  | { type: "remove"; key: string; label: string };

function buildRootEntries(input: {
  t: TFunction;
  presets: string[];
  hasDraft: boolean;
}): PresetsEntry[] {
  const { t, presets, hasDraft } = input;
  const entries: PresetsEntry[] = [];
  if (presets.length === 0) {
    entries.push({
      type: "info",
      key: "empty",
      label: t("workspace.sourceControl.presets.empty"),
    });
  } else {
    for (const preset of presets) {
      entries.push({ type: "pick", key: preset, label: preset });
    }
  }
  entries.push({ type: "separator", key: "sep-1" });
  entries.push({
    type: "save-current",
    key: "save-current",
    label: t("workspace.sourceControl.presets.saveCurrent"),
    disabled: !hasDraft,
  });
  entries.push({ type: "add", key: "add", label: t("workspace.sourceControl.presets.add") });
  if (presets.length > 0) {
    entries.push({
      type: "manage",
      key: "manage",
      label: t("workspace.sourceControl.presets.delete"),
    });
  }
  return entries;
}

function buildDeleteEntries(input: { t: TFunction; presets: string[] }): PresetsEntry[] {
  const { t, presets } = input;
  const entries: PresetsEntry[] = [
    { type: "back", key: "back", label: t("workspace.sourceControl.presets.delete") },
  ];
  if (presets.length === 0) {
    entries.push({
      type: "info",
      key: "empty",
      label: t("workspace.sourceControl.presets.empty"),
    });
    return entries;
  }
  for (const preset of presets) {
    entries.push({ type: "remove", key: preset, label: preset });
  }
  return entries;
}

interface ComposerPresetsMenuProps {
  /** Current composer text — enables "save current" and is the text it saves. */
  currentText: string;
  /** Fills the composer input with the chosen preset text. */
  onPick: (text: string) => void;
}

export function ComposerPresetsMenu({ currentText, onPick }: ComposerPresetsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<PresetsPage>("root");
  const [addOpen, setAddOpen] = useState(false);

  const presets = useCommitMessagePresetsStore((s) => s.presets);
  const addPreset = useCommitMessagePresetsStore((s) => s.addPreset);
  const removePreset = useCommitMessagePresetsStore((s) => s.removePreset);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setPage("root");
    }
  }, []);

  const entries = useMemo<PresetsEntry[]>(() => {
    if (page === "delete") {
      return buildDeleteEntries({ t, presets });
    }
    return buildRootEntries({ t, presets, hasDraft: currentText.trim().length > 0 });
  }, [page, t, presets, currentText]);

  const handleAction = useCallback(
    (entry: PresetsEntry) => {
      switch (entry.type) {
        case "pick":
          onPick(entry.label);
          break;
        case "save-current":
          addPreset(currentText);
          break;
        case "add":
          setAddOpen(true);
          break;
        case "manage":
          setPage("delete");
          break;
        case "back":
          setPage("root");
          break;
        case "remove":
          removePreset(entry.label);
          break;
        default:
          break;
      }
    },
    [addPreset, currentText, onPick, removePreset],
  );

  const handleAddClose = useCallback(() => setAddOpen(false), []);
  const handleAddSubmit = useCallback(
    (value: string) => {
      addPreset(value);
    },
    [addPreset],
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("workspace.sourceControl.presets.trigger")}
          style={triggerButtonStyle}
          testID="composer-presets-menu"
        >
          <ThemedMessageSquareQuote size={TRIGGER_ICON_SIZE} uniProps={mutedIconMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          offset={8}
          width={260}
          testID="composer-presets-content"
        >
          {entries.map((entry) => (
            <PresetsEntryItem
              key={`${entry.type}-${entry.key}`}
              entry={entry}
              onAction={handleAction}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AdaptiveRenameModal
        visible={addOpen}
        title={t("workspace.sourceControl.presets.addTitle")}
        initialValue=""
        placeholder={t("workspace.sourceControl.presets.placeholder")}
        multiline
        onClose={handleAddClose}
        onSubmit={handleAddSubmit}
      />
    </>
  );
}

function PresetsEntryItem({
  entry,
  onAction,
}: {
  entry: PresetsEntry;
  onAction: (entry: PresetsEntry) => void;
}) {
  const handleSelect = useCallback(() => onAction(entry), [entry, onAction]);

  if (entry.type === "separator") {
    return <DropdownMenuSeparator />;
  }
  if (entry.type === "info") {
    return <DropdownMenuItem disabled>{entry.label}</DropdownMenuItem>;
  }
  if (entry.type === "back") {
    return (
      <>
        <DropdownMenuItem closeOnSelect={false} onSelect={handleSelect} leading={BACK_LEADING}>
          {entry.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </>
    );
  }
  if (entry.type === "manage") {
    return (
      <DropdownMenuItem closeOnSelect={false} onSelect={handleSelect} trailing={MANAGE_TRAILING}>
        {entry.label}
      </DropdownMenuItem>
    );
  }
  if (entry.type === "remove") {
    // Stay on the manage page so several presets can be removed in a row.
    return (
      <DropdownMenuItem closeOnSelect={false} onSelect={handleSelect} destructive>
        {entry.label}
      </DropdownMenuItem>
    );
  }
  if (entry.type === "save-current") {
    return (
      <DropdownMenuItem onSelect={handleSelect} disabled={entry.disabled}>
        {entry.label}
      </DropdownMenuItem>
    );
  }
  return <DropdownMenuItem onSelect={handleSelect}>{entry.label}</DropdownMenuItem>;
}

const styles = StyleSheet.create((theme) => ({
  // Match the round 28×28 icon buttons in the composer toolbar (attach/voice).
  triggerButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));

function triggerButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.triggerButton, Boolean(hovered) && styles.triggerButtonHovered];
}
