import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHINESE_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_STT_MODEL,
  getSherpaOnnxModelSpec,
  resolveDefaultLocalSttModel,
} from "./model-catalog.js";
import { buildOfflineRecognizerModel } from "./sherpa-offline-recognizer.js";

describe("buildOfflineRecognizerModel", () => {
  it("wires SenseVoice as a single-file model", () => {
    const spec = getSherpaOnnxModelSpec("sense-voice-zh-en-ja-ko-yue-int8");
    expect(buildOfflineRecognizerModel("/models/sv", spec)).toEqual({
      kind: "sense_voice",
      model: "/models/sv/model.int8.onnx",
      tokens: "/models/sv/tokens.txt",
    });
  });

  it("passes an optional language hint through to SenseVoice", () => {
    const spec = getSherpaOnnxModelSpec("sense-voice-zh-en-ja-ko-yue-int8");
    expect(buildOfflineRecognizerModel("/models/sv", spec, { language: "zh" })).toMatchObject({
      kind: "sense_voice",
      language: "zh",
    });
  });

  it("wires Parakeet as a NeMo transducer triple", () => {
    const spec = getSherpaOnnxModelSpec("parakeet-tdt-0.6b-v2-int8");
    expect(buildOfflineRecognizerModel("/models/pk", spec)).toEqual({
      kind: "nemo_transducer",
      encoder: "/models/pk/encoder.int8.onnx",
      decoder: "/models/pk/decoder.int8.onnx",
      joiner: "/models/pk/joiner.int8.onnx",
      tokens: "/models/pk/tokens.txt",
    });
  });
});

describe("resolveDefaultLocalSttModel", () => {
  it("defaults Chinese (and Cantonese) to SenseVoice", () => {
    expect(resolveDefaultLocalSttModel("zh")).toBe(DEFAULT_CHINESE_LOCAL_STT_MODEL);
    expect(resolveDefaultLocalSttModel("zh-CN")).toBe(DEFAULT_CHINESE_LOCAL_STT_MODEL);
    expect(resolveDefaultLocalSttModel("zh-Hans")).toBe(DEFAULT_CHINESE_LOCAL_STT_MODEL);
    expect(resolveDefaultLocalSttModel("yue")).toBe(DEFAULT_CHINESE_LOCAL_STT_MODEL);
  });

  it("keeps the Parakeet default for English and unknown languages", () => {
    expect(resolveDefaultLocalSttModel("en")).toBe(DEFAULT_LOCAL_STT_MODEL);
    expect(resolveDefaultLocalSttModel(undefined)).toBe(DEFAULT_LOCAL_STT_MODEL);
    expect(resolveDefaultLocalSttModel("fr")).toBe(DEFAULT_LOCAL_STT_MODEL);
  });
});

describe("SenseVoice catalog entry", () => {
  it("advertises Chinese among its supported languages", () => {
    const spec = getSherpaOnnxModelSpec("sense-voice-zh-en-ja-ko-yue-int8");
    expect(spec.architecture).toBe("sense_voice");
    expect(spec.kind).toBe("stt-offline");
    expect(spec.languages).toContain("zh");
  });
});
