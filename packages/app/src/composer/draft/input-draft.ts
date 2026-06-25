import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  areAttachmentsEqual,
  buildDraftAgentControls,
  hasDraftContent,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftConflictStore } from "@/stores/draft-conflict-store";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady } from "@/stores/draft-store/state";

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  isVisible?: boolean;
  onlineServerIds?: string[];
  lockedWorkingDir?: string;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  agentControls: DraftAgentControlsProps;
  commandDraftConfig: DraftCommandConfig | undefined;
};

export interface AgentInputDraft {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  composerState: DraftComposerState | null;
  // Remote draft text that diverges from the local in-progress edit, surfaced so
  // the composer can offer it in a drawer without touching the local input. null
  // when there is no conflict.
  remoteConflict: { text: string } | null;
  // Overwrite the local input with the remote conflict text and dismiss the conflict.
  acceptRemoteDraft: () => void;
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const formState = useAgentFormState({
    initialServerId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
    onlineServerIds: composerOptions?.onlineServerIds ?? [],
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const [text, setText] = useState("");
  const [attachments, setAttachmentsState] = useState<UserComposerAttachment[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const draftGenerationRef = useRef(0);
  const hydratedGenerationRef = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;
  // Baseline for telling a local edit apart from a remote draft-sync update: the
  // last store text we reflected into `text` (on hydrate or remote apply). Once
  // `text` moves off this baseline the user is editing, so remote updates to this
  // draft are held back instead of clobbering the in-progress text.
  const lastReflectedTextRef = useRef("");

  const setAttachments = useCallback((updater: AttachmentUpdater) => {
    setAttachmentsState((previousAttachments) => {
      if (typeof updater === "function") {
        return updater(previousAttachments);
      }
      return updater;
    });
  }, []);

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      const store = useDraftStore.getState();
      store.clearDraftInput({ draftKey, lifecycle });

      const generation = store.beginDraftGeneration(draftKey);
      draftGenerationRef.current = generation;
      hydratedGenerationRef.current = generation;

      setText("");
      setAttachmentsState([]);
      setIsHydrated(true);
      lastReflectedTextRef.current = "";
    },
    [draftKey],
  );

  useEffect(() => {
    const store = useDraftStore.getState();
    const generation = store.beginDraftGeneration(draftKey);
    draftGenerationRef.current = generation;
    hydratedGenerationRef.current = 0;

    setText("");
    setAttachmentsState([]);
    setIsHydrated(false);
    lastReflectedTextRef.current = "";

    let cancelled = false;

    void (async () => {
      const draft = await store.hydrateDraftInput({
        draftKey,
      });
      if (cancelled) {
        return;
      }
      if (!useDraftStore.getState().isDraftGenerationCurrent({ draftKey, generation })) {
        return;
      }

      if (draft) {
        setText(draft.text);
        setAttachmentsState(draft.attachments);
        lastReflectedTextRef.current = draft.text;
      }

      hydratedGenerationRef.current = generation;
      setIsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    const currentGeneration = draftGenerationRef.current;
    if (currentGeneration <= 0) {
      return;
    }

    const store = useDraftStore.getState();
    const isCurrentGeneration = store.isDraftGenerationCurrent({
      draftKey,
      generation: currentGeneration,
    });
    if (!isCurrentGeneration) {
      return;
    }
    if (hydratedGenerationRef.current !== currentGeneration) {
      return;
    }

    const existing = store.getDraftInput(draftKey);
    const isSameDraft =
      existing !== undefined &&
      existing.text === text &&
      areAttachmentsEqual({
        left: existing.attachments,
        right: attachments,
      });
    if (isSameDraft) {
      return;
    }

    if (!hasDraftContent({ text, attachments })) {
      if (existing) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
      }
      return;
    }

    store.saveDraftInput({
      draftKey,
      draft: {
        text,
        attachments,
      },
    });
  }, [attachments, draftKey, text]);

  // Reflect remote draft-sync updates into the live composer text. The sync
  // bridge only writes the store for drafts the user is NOT editing (it protects
  // in-progress edits at the store layer); `lastReflectedTextRef` additionally
  // guards the one-frame window where a local keystroke hasn't reached the store
  // yet. Reflecting back into the store is a no-op (text already equal).
  useEffect(() => {
    const unsubscribe = useDraftStore.subscribe((state) => {
      if (hydratedGenerationRef.current !== draftGenerationRef.current) {
        return;
      }
      const storeText = toDraftInputIfReady(state.drafts[draftKey])?.text ?? "";
      if (storeText === textRef.current) {
        lastReflectedTextRef.current = storeText;
        return;
      }
      if (textRef.current !== lastReflectedTextRef.current) {
        return;
      }
      setText(storeText);
      lastReflectedTextRef.current = storeText;
    });
    return unsubscribe;
  }, [draftKey]);

  const lockedWorkingDir = composerOptions?.lockedWorkingDir?.trim() ?? "";
  useEffect(() => {
    if (!composerOptions || !lockedWorkingDir) {
      return;
    }
    if (formState.workingDir.trim() === lockedWorkingDir) {
      return;
    }
    formState.setWorkingDir(lockedWorkingDir);
  }, [composerOptions, formState, lockedWorkingDir]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const workingDir = lockedWorkingDir || formState.workingDir;
  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });

  const commandDraftConfig = useMemo(
    () =>
      composerOptions
        ? buildDraftCommandConfig({
            selection: providerSelection,
            cwd: workingDir,
            effectiveModelId,
            effectiveThinkingOptionId,
            featureValues: draftFeatureValues,
          })
        : undefined,
    [
      composerOptions,
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      workingDir,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      agentControls: buildDraftAgentControls({
        formState,
        features: draftFeatures,
        onSetFeature: setDraftFeatureValue,
      }),
      commandDraftConfig,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    draftFeatureValues,
    formState,
    setDraftFeatureValue,
    workingDir,
  ]);

  const remoteConflictText = useDraftConflictStore((state) => state.conflicts[draftKey]);
  const remoteConflict = useMemo(
    () => (remoteConflictText !== undefined ? { text: remoteConflictText } : null),
    [remoteConflictText],
  );
  const acceptRemoteDraft = useCallback(() => {
    const conflictText = useDraftConflictStore.getState().conflicts[draftKey];
    if (conflictText === undefined) {
      return;
    }
    // Overwrite local with the remote text; the save effect persists it and the
    // sync bridge pushes it out. lastReflectedTextRef keeps the store-subscription
    // effect from treating this as a fresh local edit.
    setText(conflictText);
    lastReflectedTextRef.current = conflictText;
    useDraftConflictStore.getState().clearConflict(draftKey);
  }, [draftKey]);

  return {
    text,
    setText,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    composerState,
    remoteConflict,
    acceptRemoteDraft,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandConfig,
  buildDraftComposerCommandConfig: buildDraftCommandConfig,
  buildDraftAgentControls,
};
