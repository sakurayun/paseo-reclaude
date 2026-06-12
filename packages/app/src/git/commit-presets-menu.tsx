import { useCallback, useMemo, useState } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, ChevronRight, MessageSquareQuote } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Theme } from "@/styles/theme";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { sendComposerInsert } from "@/composer/draft/composer-insert-bus";
import { useCommitMessagePresetsStore } from "./commit-message-presets-store";

const ThemedMessageSquareQuote = withUnistyles(MessageSquareQuote);
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const BACK_LEADING = <ThemedChevronLeft size={14} uniProps={mutedIconMapping} />;
const MANAGE_TRAILING = <ThemedChevronRight size={14} uniProps={mutedIconMapping} />;

/**
 * Preset commit messages behind a button at the end of the changes action row.
 * Picking a preset only fills the message box — sending stays manual. Presets
 * are user-managed: save the current draft, add via a text modal, or delete
 * from the in-menu manage page.
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

interface CommitPresetsMenuProps {
  serverId: string;
  cwd: string;
  /** Explicit workspace identity; directory matching is only a fallback. */
  workspaceId?: string | null;
  /** Current commit message draft (used by "save current as preset"). */
  message: string;
}

/** Candidate workspace persistence keys: explicit id first, then directory match, then raw cwd. */
function resolveWorkspacePersistenceKeys(input: {
  serverId: string;
  cwd: string;
  workspaceId?: string | null;
}): string[] {
  const workspaces = useSessionStore.getState().sessions[input.serverId]?.workspaces;
  const resolvedByDirectory = resolveWorkspaceIdByExecutionDirectory({
    workspaces: workspaces?.values(),
    workspaceDirectory: input.cwd,
  });
  const workspaceIds = [
    ...new Set(
      [input.workspaceId, resolvedByDirectory, input.cwd].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ];
  const keys: string[] = [];
  for (const workspaceId of workspaceIds) {
    const persistenceKey = buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId,
    });
    if (persistenceKey) {
      keys.push(persistenceKey);
    }
  }
  return keys;
}

/**
 * Resolve the draft key of the composer in the workspace's focused tab.
 * Falls back to any open agent/draft tab; null when none is open.
 */
function resolveActiveComposerDraftKey(input: {
  serverId: string;
  cwd: string;
  workspaceId?: string | null;
}): string | null {
  const tabsState = useWorkspaceTabsStore.getState();
  for (const persistenceKey of resolveWorkspacePersistenceKeys(input)) {
    const tabs = tabsState.uiTabsByWorkspace[persistenceKey] ?? [];
    if (tabs.length === 0) {
      continue;
    }
    const focusedTabId = tabsState.focusedTabIdByWorkspace[persistenceKey];
    const focusedTab = tabs.find((tab) => tab.tabId === focusedTabId);
    const candidates = focusedTab ? [focusedTab, ...tabs] : tabs;
    for (const tab of candidates) {
      if (tab.target.kind === "agent") {
        return buildDraftStoreKey({ serverId: input.serverId, agentId: tab.target.agentId });
      }
      if (tab.target.kind === "draft") {
        // Must mirror workspace-tab.tsx, which keys its composer draft by
        // buildDraftStoreKey({ serverId, agentId: tabId, draftId }).
        return buildDraftStoreKey({
          serverId: input.serverId,
          agentId: tab.tabId,
          draftId: tab.target.draftId,
        });
      }
    }
  }
  return null;
}

/**
 * No agent/draft tab is open: open a fresh "new agent" draft tab and seed its
 * composer draft with the preset text (the composer hydrates from the draft
 * store on mount, so the text is waiting in the input).
 */
function insertIntoNewDraftTab(input: {
  serverId: string;
  cwd: string;
  workspaceId?: string | null;
  text: string;
}): boolean {
  const [persistenceKey] = resolveWorkspacePersistenceKeys(input);
  if (!persistenceKey) {
    return false;
  }
  const draftId = generateDraftId();
  const draftKey = buildDraftStoreKey({ serverId: input.serverId, agentId: "", draftId });
  useDraftStore.getState().saveDraftInput({
    draftKey,
    draft: { text: input.text, attachments: [] },
  });
  const tabId = useWorkspaceLayoutStore
    .getState()
    .openTabFocused(persistenceKey, { kind: "draft", draftId });
  return tabId !== null;
}

export function CommitPresetsMenu({ serverId, cwd, workspaceId, message }: CommitPresetsMenuProps) {
  const { t } = useTranslation();
  const toast = useToast();
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
    return buildRootEntries({ t, presets, hasDraft: message.trim().length > 0 });
  }, [page, t, presets, message]);

  // Picking a preset fills the focused tab's agent composer (so the user can
  // ask the agent to commit/push) — never the manual commit box, never sent.
  const handlePick = useCallback(
    (text: string) => {
      const draftKey = resolveActiveComposerDraftKey({ serverId, cwd, workspaceId });
      if (draftKey) {
        sendComposerInsert({ draftKey, text });
        toast.show(t("workspace.sourceControl.presets.inserted"), { variant: "success" });
        return;
      }
      // No agent tab open — open a fresh "new agent" tab seeded with the text.
      if (insertIntoNewDraftTab({ serverId, cwd, workspaceId, text })) {
        toast.show(t("workspace.sourceControl.presets.inserted"), { variant: "success" });
        return;
      }
      toast.error(t("workspace.sourceControl.presets.noAgentTab"));
    },
    [cwd, serverId, t, toast, workspaceId],
  );

  const handleAction = useCallback(
    (entry: PresetsEntry) => {
      switch (entry.type) {
        case "pick":
          handlePick(entry.label);
          break;
        case "save-current":
          addPreset(message);
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
    [addPreset, handlePick, message, removePreset],
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
          style={styles.triggerButton}
          testID="source-control-presets-menu"
        >
          <ThemedMessageSquareQuote size={12} uniProps={mutedIconMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={260} testID="source-control-presets-content">
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
  triggerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
