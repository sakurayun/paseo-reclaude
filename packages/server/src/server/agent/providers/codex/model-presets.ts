/**
 * Built-in Codex model presets used when the local Codex app-server catalog is
 * older or incomplete (e.g. missing GPT-5.6 Sol/Terra/Luna).
 *
 * Source of truth for field values: Codex CLI 0.144+ `model/list` responses.
 * Runtime catalog entries always win for matching IDs; presets only fill gaps
 * and ensure reasoning-effort options stay complete.
 */

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface CodexReasoningEffortPreset {
  reasoningEffort: CodexReasoningEffort;
  description: string;
}

export interface CodexModelPreset {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault?: boolean;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: readonly CodexReasoningEffortPreset[];
}

/** Minimal shape shared with the app-server model/list payload. */
export interface CodexCatalogModel {
  id: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  model?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
}

const REASONING_EFFORT_PRESETS = {
  low: {
    reasoningEffort: "low",
    description: "Fast responses with lighter reasoning",
  },
  medium: {
    reasoningEffort: "medium",
    description: "Balances speed and reasoning depth for everyday tasks",
  },
  high: {
    reasoningEffort: "high",
    description: "Greater reasoning depth for complex problems",
  },
  xhigh: {
    reasoningEffort: "xhigh",
    description: "Extra high reasoning depth for complex problems",
  },
  max: {
    reasoningEffort: "max",
    description: "Maximum reasoning depth for the hardest problems",
  },
  ultra: {
    reasoningEffort: "ultra",
    description: "Maximum reasoning with automatic task delegation",
  },
} as const satisfies Record<CodexReasoningEffort, CodexReasoningEffortPreset>;

const SOL_TERRA_EFFORTS = [
  REASONING_EFFORT_PRESETS.low,
  REASONING_EFFORT_PRESETS.medium,
  REASONING_EFFORT_PRESETS.high,
  REASONING_EFFORT_PRESETS.xhigh,
  REASONING_EFFORT_PRESETS.max,
  REASONING_EFFORT_PRESETS.ultra,
] as const;

const LUNA_EFFORTS = [
  REASONING_EFFORT_PRESETS.low,
  REASONING_EFFORT_PRESETS.medium,
  REASONING_EFFORT_PRESETS.high,
  REASONING_EFFORT_PRESETS.xhigh,
  REASONING_EFFORT_PRESETS.max,
] as const;

export const CODEX_MODEL_PRESETS = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6-Sol",
    description: "Latest frontier agentic coding model.",
    isDefault: true,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: SOL_TERRA_EFFORTS,
  },
  {
    id: "gpt-5.6-terra",
    model: "gpt-5.6-terra",
    displayName: "GPT-5.6-Terra",
    description: "Balanced agentic coding model for everyday work.",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: SOL_TERRA_EFFORTS,
  },
  {
    id: "gpt-5.6-luna",
    model: "gpt-5.6-luna",
    displayName: "GPT-5.6-Luna",
    description: "Fast and affordable agentic coding model.",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: LUNA_EFFORTS,
  },
] as const satisfies readonly CodexModelPreset[];

function toCatalogModel(preset: CodexModelPreset, isDefault: boolean): CodexCatalogModel {
  return {
    id: preset.id,
    model: preset.model,
    displayName: preset.displayName,
    description: preset.description,
    isDefault,
    defaultReasoningEffort: preset.defaultReasoningEffort,
    supportedReasoningEfforts: preset.supportedReasoningEfforts.map((entry) => ({
      reasoningEffort: entry.reasoningEffort,
      description: entry.description,
    })),
  };
}

function enrichCatalogModelFromPreset(
  runtime: CodexCatalogModel,
  preset: CodexModelPreset,
): CodexCatalogModel {
  const runtimeEfforts = Array.isArray(runtime.supportedReasoningEfforts)
    ? runtime.supportedReasoningEfforts
    : [];
  const effortById = new Map<string, { reasoningEffort?: string; description?: string }>();

  for (const entry of runtimeEfforts) {
    const id = typeof entry?.reasoningEffort === "string" ? entry.reasoningEffort.trim() : "";
    if (id) {
      effortById.set(id, entry);
    }
  }

  for (const presetEffort of preset.supportedReasoningEfforts) {
    if (!effortById.has(presetEffort.reasoningEffort)) {
      effortById.set(presetEffort.reasoningEffort, {
        reasoningEffort: presetEffort.reasoningEffort,
        description: presetEffort.description,
      });
    }
  }

  const supportedReasoningEfforts = Array.from(effortById.values());
  const defaultReasoningEffort =
    typeof runtime.defaultReasoningEffort === "string" &&
    runtime.defaultReasoningEffort.trim().length > 0
      ? runtime.defaultReasoningEffort
      : preset.defaultReasoningEffort;

  return {
    ...runtime,
    displayName:
      typeof runtime.displayName === "string" && runtime.displayName.trim().length > 0
        ? runtime.displayName
        : preset.displayName,
    description:
      typeof runtime.description === "string" && runtime.description.trim().length > 0
        ? runtime.description
        : preset.description,
    model:
      typeof runtime.model === "string" && runtime.model.trim().length > 0
        ? runtime.model
        : preset.model,
    defaultReasoningEffort,
    supportedReasoningEfforts:
      supportedReasoningEfforts.length > 0 ? supportedReasoningEfforts : undefined,
  };
}

/**
 * Ensure GPT-5.6 Sol/Terra/Luna appear in the catalog with complete effort
 * presets. Runtime entries for the same id win; missing models are inserted
 * ahead of the rest of the list (matching current Codex ordering).
 */
export function mergeCodexModelPresets(runtimeModels: CodexCatalogModel[]): CodexCatalogModel[] {
  const runtimeById = new Map(
    runtimeModels
      .filter((model) => typeof model?.id === "string" && model.id.trim().length > 0)
      .map((model) => [model.id, model]),
  );
  const runtimeDefaultId = runtimeModels.find((model) => model.isDefault === true)?.id;
  const seen = new Set<string>();
  const merged: CodexCatalogModel[] = [];

  for (const preset of CODEX_MODEL_PRESETS) {
    const runtime = runtimeById.get(preset.id);
    if (runtime) {
      merged.push(enrichCatalogModelFromPreset(runtime, preset));
    } else {
      // Only claim default when the runtime catalog has no default of its own.
      const isDefault = runtimeDefaultId == null && preset.isDefault === true;
      merged.push(toCatalogModel(preset, isDefault));
    }
    seen.add(preset.id);
  }

  for (const model of runtimeModels) {
    if (typeof model?.id !== "string" || model.id.trim().length === 0 || seen.has(model.id)) {
      continue;
    }
    merged.push(model);
  }

  if (runtimeDefaultId) {
    return merged.map((model) => ({
      ...model,
      isDefault: model.id === runtimeDefaultId,
    }));
  }

  const presetDefaultId = CODEX_MODEL_PRESETS.find((preset) => preset.isDefault)?.id;
  if (presetDefaultId && merged.some((model) => model.id === presetDefaultId)) {
    return merged.map((model) => ({
      ...model,
      isDefault: model.id === presetDefaultId,
    }));
  }

  return merged;
}
