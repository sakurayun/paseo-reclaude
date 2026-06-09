import { z } from "zod";

export type SherpaOnnxModelKind = "stt-offline" | "tts";

/**
 * Offline STT model architecture. Drives how {@link SherpaOfflineRecognizerEngine}
 * wires the sherpa-onnx `modelConfig`: a NeMo transducer triple (encoder/decoder/joiner)
 * vs. a single-file SenseVoice model. Omitted for TTS entries.
 */
export type SherpaSttArchitecture = "nemo_transducer" | "sense_voice";

type DefaultModelRole = "stt" | "tts";

interface SherpaOnnxCatalogEntry {
  kind: SherpaOnnxModelKind;
  archiveUrl: string;
  extractedDir: string;
  requiredFiles: string[];
  description: string;
  defaultFor?: DefaultModelRole;
  /** STT model architecture; drives offline-recognizer construction. Omitted for TTS entries. */
  architecture?: SherpaSttArchitecture;
  /** Language tags the model can transcribe (BCP-47-ish), surfaced in the settings UI. */
  languages: readonly string[];
}

export const SHERPA_ONNX_MODEL_CATALOG = {
  "parakeet-tdt-0.6b-v2-int8": {
    kind: "stt-offline",
    architecture: "nemo_transducer",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",
    languages: ["en"],
    defaultFor: "stt",
  },
  "parakeet-tdt-0.6b-v3-int8": {
    kind: "stt-offline",
    architecture: "nemo_transducer",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    description:
      "NVIDIA Parakeet TDT v3 (offline NeMo transducer, 25 European languages, auto-detected).",
    languages: [
      "bg",
      "hr",
      "cs",
      "da",
      "nl",
      "en",
      "et",
      "fi",
      "fr",
      "de",
      "el",
      "hu",
      "it",
      "lv",
      "lt",
      "mt",
      "pl",
      "pt",
      "ro",
      "sk",
      "sl",
      "es",
      "sv",
      "ru",
      "uk",
    ],
  },
  "sense-voice-zh-en-ja-ko-yue-int8": {
    kind: "stt-offline",
    architecture: "sense_voice",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2",
    extractedDir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
    requiredFiles: ["model.int8.onnx", "tokens.txt"],
    description:
      "SenseVoice (offline, multilingual: Chinese, Cantonese, English, Japanese, Korean).",
    languages: ["zh", "yue", "en", "ja", "ko"],
  },
  "kokoro-en-v0_19": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
    extractedDir: "kokoro-en-v0_19",
    requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
    description: "Kokoro TTS (higher quality; larger).",
    languages: ["en"],
    defaultFor: "tts",
  },
} as const satisfies Record<string, SherpaOnnxCatalogEntry>;

export type SherpaOnnxModelId = keyof typeof SHERPA_ONNX_MODEL_CATALOG;
export type LocalSpeechModelId = SherpaOnnxModelId;

type ModelIdByKind<K extends SherpaOnnxModelKind> = {
  [Id in SherpaOnnxModelId]: (typeof SHERPA_ONNX_MODEL_CATALOG)[Id]["kind"] extends K ? Id : never;
}[SherpaOnnxModelId];

export type LocalSttModelId = ModelIdByKind<"stt-offline">;
export type LocalTtsModelId = ModelIdByKind<"tts">;

const ALL_MODEL_IDS: SherpaOnnxModelId[] = Object.keys(SHERPA_ONNX_MODEL_CATALOG).filter(
  (k): k is SherpaOnnxModelId => k in SHERPA_ONNX_MODEL_CATALOG,
);

function isLocalSttModelId(id: SherpaOnnxModelId): id is LocalSttModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind !== "tts";
}

function isLocalTtsModelId(id: SherpaOnnxModelId): id is LocalTtsModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind === "tts";
}

export const LOCAL_STT_MODEL_IDS: LocalSttModelId[] = ALL_MODEL_IDS.filter(isLocalSttModelId);

export const LOCAL_TTS_MODEL_IDS: LocalTtsModelId[] = ALL_MODEL_IDS.filter(isLocalTtsModelId);

function resolveDefaultModelId(role: "stt"): LocalSttModelId;
function resolveDefaultModelId(role: "tts"): LocalTtsModelId;
function resolveDefaultModelId(role: DefaultModelRole): SherpaOnnxModelId {
  const match = ALL_MODEL_IDS.find((id) => {
    const entry: SherpaOnnxCatalogEntry = SHERPA_ONNX_MODEL_CATALOG[id];
    return entry.defaultFor === role;
  });
  if (!match) {
    throw new Error(`No default model configured for role '${role}'`);
  }
  return match;
}

export const DEFAULT_LOCAL_STT_MODEL = resolveDefaultModelId("stt");
export const DEFAULT_LOCAL_TTS_MODEL = resolveDefaultModelId("tts");

/** Local STT model used by default when the dictation/voice language is Chinese (incl. Cantonese). */
export const DEFAULT_CHINESE_LOCAL_STT_MODEL: LocalSttModelId = "sense-voice-zh-en-ja-ko-yue-int8";

const CHINESE_LANGUAGE_PREFIXES = ["zh", "yue", "cmn"];

/**
 * Pick the local STT model that should be the default for a given language. Chinese (and
 * Cantonese) default to the multilingual SenseVoice model; every other language keeps the
 * English-first Parakeet default. An explicit user/env model selection is resolved upstream
 * and is never overridden here.
 */
export function resolveDefaultLocalSttModel(language: string | undefined): LocalSttModelId {
  const normalized = language?.trim().toLowerCase();
  if (normalized) {
    const isChinese = CHINESE_LANGUAGE_PREFIXES.some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(`${prefix}-`) ||
        normalized.startsWith(`${prefix}_`),
    );
    if (isChinese) {
      return DEFAULT_CHINESE_LOCAL_STT_MODEL;
    }
  }
  return DEFAULT_LOCAL_STT_MODEL;
}

function createModelIdSchema<T extends string>(
  modelIds: readonly T[],
): z.ZodType<T, z.ZodTypeDef, string> {
  const validIds = new Set<string>(modelIds);
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => validIds.has(value), {
      message: "Invalid model id",
    })
    .transform((value) => value as T);
}

export const LocalSttModelIdSchema = createModelIdSchema(LOCAL_STT_MODEL_IDS);
export const LocalTtsModelIdSchema = createModelIdSchema(LOCAL_TTS_MODEL_IDS);

export type SherpaOnnxModelSpec = SherpaOnnxCatalogEntry & {
  id: SherpaOnnxModelId;
};

export function listSherpaOnnxModels(): SherpaOnnxModelSpec[] {
  return ALL_MODEL_IDS.map((id) => Object.assign({ id }, SHERPA_ONNX_MODEL_CATALOG[id]));
}

export function getSherpaOnnxModelSpec(id: SherpaOnnxModelId): SherpaOnnxModelSpec {
  const spec = SHERPA_ONNX_MODEL_CATALOG[id];
  if (!spec) {
    throw new Error(`Unknown local speech model id: ${id}`);
  }
  return {
    id,
    ...spec,
  };
}
