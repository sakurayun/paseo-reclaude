import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";

import {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  getLocalSpeechModelDir,
  listLocalSpeechModels,
  LocalSttModelIdSchema,
  type LocalSpeechModelId,
} from "./providers/local/models.js";
import type {
  DictationCurrentSelection,
  DictationModelInfo,
  DictationReadiness,
} from "@getpaseo/protocol/messages";
import type { SpeechService } from "./speech-runtime.js";

export interface DictationSettingsSnapshot {
  models: DictationModelInfo[];
  current: DictationCurrentSelection;
  readiness: DictationReadiness;
}

export interface DictationSettingsController {
  /** Available local STT models + the active selection + current speech readiness. */
  getSnapshot: () => Promise<DictationSettingsSnapshot>;
  /** Persist the chosen dictation STT model and hot-swap the speech stack in place. */
  setModel: (modelId: string) => Promise<DictationSettingsSnapshot>;
}

const DEFAULT_LOCAL_MODELS_SUBDIR = join("models", "local-speech");

/**
 * Backs the `speech.dictation.*` RPCs: lists local STT models with their supported
 * languages and install state, and switches the active dictation model at runtime by
 * persisting it and calling {@link SpeechService.reconfigure} (no daemon restart needed).
 */
export function createDictationSettingsController(params: {
  paseoHome: string;
  env: NodeJS.ProcessEnv;
  speechService: SpeechService;
  logger: Logger;
}): DictationSettingsController {
  const { paseoHome, env, speechService } = params;
  const logger = params.logger.child({ module: "dictation-settings" });

  const resolveModelsDir = (
    persisted: PersistedConfig,
    localModelsDir: string | undefined,
  ): string =>
    localModelsDir ??
    env.PASEO_LOCAL_MODELS_DIR ??
    persisted.providers?.local?.modelsDir ??
    join(paseoHome, DEFAULT_LOCAL_MODELS_SUBDIR);

  const isInstalled = async (
    modelsDir: string,
    modelId: LocalSpeechModelId,
    requiredFiles: readonly string[],
  ): Promise<boolean> => {
    const modelDir = getLocalSpeechModelDir(modelsDir, modelId);
    const checks = await Promise.all(
      requiredFiles.map(async (rel) => {
        try {
          const s = await stat(join(modelDir, rel));
          return s.isDirectory() || (s.isFile() && s.size > 0);
        } catch {
          return false;
        }
      }),
    );
    return checks.every(Boolean);
  };

  const buildSnapshot = async (persisted: PersistedConfig): Promise<DictationSettingsSnapshot> => {
    const resolved = resolveSpeechConfig({ paseoHome, env, persisted });
    const modelsDir = resolveModelsDir(persisted, resolved.speech.local?.modelsDir);
    const sttModels = listLocalSpeechModels().filter((m) => m.kind === "stt-offline");

    const models = await Promise.all(
      sttModels.map(
        async (m): Promise<DictationModelInfo> => ({
          id: m.id,
          description: m.description,
          languages: [...m.languages],
          installed: await isInstalled(modelsDir, m.id, m.requiredFiles),
        }),
      ),
    );

    const current: DictationCurrentSelection = {
      provider: resolved.speech.providers.dictationStt.provider,
      model: resolved.speech.local?.models.dictationStt ?? DEFAULT_LOCAL_STT_MODEL,
      language: resolved.speech.sttLanguages?.dictation ?? "en",
    };

    const r = speechService.getReadiness();
    const readiness: DictationReadiness = {
      available: r.dictation.available,
      downloading: r.download.inProgress,
      missingModelIds: [...r.missingLocalModelIds],
      reasonCode: r.dictation.reasonCode,
      message: r.dictation.message,
    };

    return { models, current, readiness };
  };

  return {
    getSnapshot: () => buildSnapshot(loadPersistedConfig(paseoHome, logger)),
    setModel: async (modelId: string) => {
      // Throws ZodError for unknown ids; the RPC handler maps that to an error response.
      const parsed = LocalSttModelIdSchema.parse(modelId);
      const persisted = loadPersistedConfig(paseoHome, logger);
      const next: PersistedConfig = {
        ...persisted,
        features: {
          ...persisted.features,
          dictation: {
            ...persisted.features?.dictation,
            stt: {
              ...persisted.features?.dictation?.stt,
              model: parsed,
            },
          },
        },
      };
      savePersistedConfig(paseoHome, next, logger);

      const resolved = resolveSpeechConfig({ paseoHome, env, persisted: next });
      speechService.reconfigure({ speechConfig: resolved.speech, openaiConfig: resolved.openai });
      logger.info({ model: parsed }, "Dictation STT model updated");

      return buildSnapshot(next);
    },
  };
}
