import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHINESE_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_STT_MODEL,
  getSherpaOnnxModelSpec,
  resolveDefaultLocalSttModel,
} from "./model-catalog.js";
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
    const spec = getSherpaOnnxModelSpec("sense-voice-int8");
    expect(spec.kind === "stt-offline" && spec.engine.family).toBe("sense_voice");
    expect(spec.kind).toBe("stt-offline");
    expect(spec.languages).toContain("zh");
  });
});
