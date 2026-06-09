import { existsSync } from "node:fs";
import type pino from "pino";

import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.js";
import type { SherpaOnnxModelSpec } from "./model-catalog.js";

function assertFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

export interface SherpaNemoTransducerModel {
  kind: "nemo_transducer";
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export interface SherpaSenseVoiceModel {
  kind: "sense_voice";
  model: string;
  tokens: string;
  /** Decoding language hint: "auto" (default) or a tag such as "zh"/"en"/"ja"/"ko"/"yue". */
  language?: string;
  /** Inverse text normalization (punctuation/numerals). Defaults to enabled. */
  useInverseTextNormalization?: boolean;
}

export type SherpaOfflineRecognizerModel = SherpaNemoTransducerModel | SherpaSenseVoiceModel;

export interface SherpaOfflineRecognizerConfig {
  model: SherpaOfflineRecognizerModel;
  numThreads?: number;
  provider?: "cpu";
  debug?: 0 | 1;
  sampleRate?: number;
  featureDim?: number;
  decodingMethod?: "greedy_search";
  maxActivePaths?: number;
}

interface SherpaOfflineRecognizerNative {
  config?: { featConfig?: { sampleRate?: number } };
  createStream: () => unknown;
  decode: (stream: unknown) => void;
  getResult: (stream: unknown) => { text?: string } | string | undefined;
  free?: () => void;
}

interface SherpaOfflineStreamNative {
  acceptWaveform: ((arg: { samples: Float32Array; sampleRate: number }) => void) &
    ((sampleRate: number, samples: Float32Array) => void);
  free?: () => void;
}

export class SherpaOfflineRecognizerEngine {
  public readonly recognizer: SherpaOfflineRecognizerNative;
  public readonly sampleRate: number;
  private readonly logger: pino.Logger;

  constructor(config: SherpaOfflineRecognizerConfig, logger: pino.Logger) {
    this.logger = logger.child({
      module: "speech",
      provider: "local",
      component: "offline-recognizer",
    });

    const model = config.model;
    if (model.kind === "sense_voice") {
      assertFileExists(model.model, "offline model");
      assertFileExists(model.tokens, "tokens");
    } else {
      assertFileExists(model.encoder, "offline encoder");
      assertFileExists(model.decoder, "offline decoder");
      assertFileExists(model.joiner, "offline joiner");
      assertFileExists(model.tokens, "tokens");
    }

    const sherpa = loadSherpaOnnxNode();

    // sherpa-onnx wires the modelConfig differently per architecture: a transducer
    // triple (encoder/decoder/joiner) vs. a single-file SenseVoice model.
    const modelSpecificConfig =
      model.kind === "sense_voice"
        ? {
            senseVoice: {
              model: model.model,
              language: model.language ?? "auto",
              useInverseTextNormalization: (model.useInverseTextNormalization ?? true) ? 1 : 0,
            },
            tokens: model.tokens,
          }
        : {
            transducer: {
              encoder: model.encoder,
              decoder: model.decoder,
              joiner: model.joiner,
            },
            tokens: model.tokens,
            modelType: "nemo_transducer" as const,
          };

    const recognizerConfig = {
      featConfig: {
        sampleRate: config.sampleRate ?? 16000,
        featureDim: config.featureDim ?? 80,
      },
      modelConfig: {
        ...modelSpecificConfig,
        numThreads: config.numThreads ?? 1,
        provider: config.provider ?? "cpu",
        debug: config.debug ?? 0,
      },
      decodingMethod: config.decodingMethod ?? "greedy_search",
      maxActivePaths: config.maxActivePaths ?? 4,
    };

    this.recognizer = new (
      sherpa as unknown as {
        OfflineRecognizer: new (config: unknown) => SherpaOfflineRecognizerNative;
      }
    ).OfflineRecognizer(recognizerConfig);
    const sr = this.recognizer?.config?.featConfig?.sampleRate;
    this.sampleRate =
      typeof sr === "number" && Number.isFinite(sr) && sr > 0
        ? sr
        : recognizerConfig.featConfig.sampleRate;

    this.logger.info(
      { sampleRate: this.sampleRate, numThreads: recognizerConfig.modelConfig.numThreads },
      "Sherpa offline recognizer initialized",
    );
  }

  createStream(): SherpaOfflineStreamNative {
    return this.recognizer.createStream() as SherpaOfflineStreamNative;
  }

  acceptWaveform(
    stream: SherpaOfflineStreamNative,
    sampleRate: number,
    samples: Float32Array,
  ): void {
    if (!stream || typeof stream.acceptWaveform !== "function") {
      throw new Error("Unexpected sherpa offline stream: missing acceptWaveform()");
    }

    // sherpa-onnx-node expects: acceptWaveform({ samples, sampleRate })
    // sherpa-onnx (WASM) expects: acceptWaveform(sampleRate, samples)
    if (stream.acceptWaveform.length <= 1) {
      stream.acceptWaveform({ samples, sampleRate });
    } else {
      stream.acceptWaveform(sampleRate, samples);
    }
  }

  free(): void {
    try {
      this.recognizer?.free?.();
    } catch (err) {
      this.logger.warn({ err }, "Failed to free sherpa offline recognizer");
    }
  }
}

/**
 * Build the offline-recognizer model descriptor for a catalog entry, resolving the
 * required model files inside `modelDir`. The wiring (transducer triple vs. single-file
 * SenseVoice) is selected from the entry's `architecture`.
 */
export function buildOfflineRecognizerModel(
  modelDir: string,
  spec: SherpaOnnxModelSpec,
  options?: { language?: string },
): SherpaOfflineRecognizerModel {
  const file = (name: string): string => `${modelDir}/${name}`;
  if (spec.architecture === "sense_voice") {
    return {
      kind: "sense_voice",
      model: file("model.int8.onnx"),
      tokens: file("tokens.txt"),
      ...(options?.language ? { language: options.language } : {}),
    };
  }
  return {
    kind: "nemo_transducer",
    encoder: file("encoder.int8.onnx"),
    decoder: file("decoder.int8.onnx"),
    joiner: file("joiner.int8.onnx"),
    tokens: file("tokens.txt"),
  };
}
