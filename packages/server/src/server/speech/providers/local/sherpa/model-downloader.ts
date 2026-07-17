import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pino from "pino";

import { getSherpaOnnxModelSpec, type SherpaOnnxModelId } from "./model-catalog.js";
import { spawnProcess } from "../../../../../utils/spawn.js";

/** Download lifecycle progress for a single local speech model archive. */
export interface ModelDownloadProgress {
  modelId: SherpaOnnxModelId;
  /** Overall 0–100 estimate (download 0–90, extract 90–99, complete 100). */
  percent: number;
  phase: "download" | "extract" | "complete";
  receivedBytes: number;
  totalBytes: number | null;
  /** Instantaneous download speed in bytes/sec (0 while extracting / complete). */
  bytesPerSecond: number;
}

export type ModelDownloadProgressListener = (progress: ModelDownloadProgress) => void;

export interface EnsureSherpaOnnxModelOptions {
  modelsDir: string;
  modelId: SherpaOnnxModelId;
  logger: pino.Logger;
  onProgress?: ModelDownloadProgressListener;
}

export function getSherpaOnnxModelDir(modelsDir: string, modelId: SherpaOnnxModelId): string {
  const spec = getSherpaOnnxModelSpec(modelId);
  return path.join(modelsDir, spec.extractedDir);
}

async function hasRequiredFiles(modelDir: string, requiredFiles: string[]): Promise<boolean> {
  const results = await Promise.all(
    requiredFiles.map(async (rel) => {
      const abs = path.join(modelDir, rel);
      try {
        const s = await stat(abs);
        if (s.isDirectory()) {
          return true;
        }
        return s.isFile() && s.size > 0;
      } catch {
        return false;
      }
    }),
  );
  return results.every((present) => present);
}

interface DownloadToFileOptions {
  url: string;
  outputPath: string;
  onBytes?: (receivedBytes: number, totalBytes: number | null, bytesPerSecond: number) => void;
}

/**
 * Count bytes via a Transform in the pipeline. Attaching only a `data` listener is unreliable
 * with `pipeline()` (flowing-mode races); the transform always sees every chunk.
 */
async function downloadToFile(options: DownloadToFileOptions): Promise<void> {
  const { url, outputPath, onBytes } = options;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Failed to download ${url}: missing response body`);
  }

  const contentLengthHeader = res.headers.get("content-length");
  const totalBytes =
    contentLengthHeader && Number.isFinite(Number(contentLengthHeader))
      ? Number(contentLengthHeader)
      : null;

  const tmpPath = `${outputPath}.tmp-${Date.now()}`;
  await mkdir(path.dirname(outputPath), { recursive: true });

  // The fetch ReadableStream type is slightly different from what Readable.fromWeb expects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeStream = Readable.fromWeb(res.body as any);
  let receivedBytes = 0;
  const startedAt = Date.now();
  // Rolling window for a smoother instantaneous speed (last ~1s of samples).
  let windowBytes = 0;
  let windowStartedAt = startedAt;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const size = chunk.byteLength;
      receivedBytes += size;
      windowBytes += size;
      const now = Date.now();
      const windowElapsedSec = (now - windowStartedAt) / 1000;
      let bytesPerSecond = 0;
      if (windowElapsedSec >= 0.25) {
        bytesPerSecond = windowBytes / windowElapsedSec;
        // Slide the window forward so speed tracks recent throughput.
        if (windowElapsedSec >= 1) {
          windowBytes = 0;
          windowStartedAt = now;
        }
      } else {
        const totalElapsedSec = (now - startedAt) / 1000;
        bytesPerSecond = totalElapsedSec > 0 ? receivedBytes / totalElapsedSec : 0;
      }
      onBytes?.(receivedBytes, totalBytes, bytesPerSecond);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(nodeStream, counter, createWriteStream(tmpPath));
    await rename(tmpPath, outputPath);
    const totalElapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const avgSpeed = receivedBytes / totalElapsedSec;
    onBytes?.(
      receivedBytes > 0 ? receivedBytes : (totalBytes ?? receivedBytes),
      totalBytes,
      avgSpeed,
    );
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function extractTarArchive(archivePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess("tar", ["xf", archivePath, "-C", destDir], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function downloadPhasePercent(receivedBytes: number, totalBytes: number | null): number {
  if (totalBytes && totalBytes > 0) {
    return clampPercent((receivedBytes / totalBytes) * 90);
  }
  // No Content-Length (common on some CDNs). Use a soft asymptotic curve so the bar
  // keeps creeping as bytes arrive, without ever claiming completion before extract.
  // ~50% at 50MB, ~70% at 200MB, asymptote at 85%.
  const mb = receivedBytes / (1024 * 1024);
  return clampPercent(85 * (1 - Math.exp(-mb / 80)));
}

export async function ensureSherpaOnnxModel(
  options: EnsureSherpaOnnxModelOptions,
): Promise<string> {
  const logger = options.logger.child({
    module: "speech",
    provider: "local",
    component: "model-downloader",
    modelId: options.modelId,
  });
  const report = (progress: Omit<ModelDownloadProgress, "modelId">): void => {
    options.onProgress?.({ modelId: options.modelId, ...progress });
  };

  const spec = getSherpaOnnxModelSpec(options.modelId);
  const modelDir = path.join(options.modelsDir, spec.extractedDir);
  if (await hasRequiredFiles(modelDir, spec.requiredFiles)) {
    report({
      percent: 100,
      phase: "complete",
      receivedBytes: 0,
      totalBytes: null,
      bytesPerSecond: 0,
    });
    return modelDir;
  }

  logger.info({ modelsDir: options.modelsDir }, "Starting model download");
  report({
    percent: 0,
    phase: "download",
    receivedBytes: 0,
    totalBytes: null,
    bytesPerSecond: 0,
  });

  try {
    const downloadsDir = path.join(options.modelsDir, ".downloads");
    const archiveFilename = path.basename(new URL(spec.archiveUrl).pathname);
    const archivePath = path.join(downloadsDir, archiveFilename);

    if (!(await isNonEmptyFile(archivePath))) {
      // Throttle progress callbacks so high-frequency chunks don't flood listeners.
      let lastReportAt = 0;
      let lastReportedPercent = -1;
      await downloadToFile({
        url: spec.archiveUrl,
        outputPath: archivePath,
        onBytes: (receivedBytes, totalBytes, bytesPerSecond) => {
          const percent = downloadPhasePercent(receivedBytes, totalBytes);
          const now = Date.now();
          const shouldReport =
            percent !== lastReportedPercent ||
            now - lastReportAt >= 200 ||
            percent >= 90 ||
            (totalBytes !== null && receivedBytes >= totalBytes);
          if (!shouldReport) {
            return;
          }
          lastReportAt = now;
          lastReportedPercent = percent;
          report({
            percent,
            phase: "download",
            receivedBytes,
            totalBytes,
            bytesPerSecond,
          });
        },
      });
    } else {
      report({
        percent: 90,
        phase: "download",
        receivedBytes: 0,
        totalBytes: null,
        bytesPerSecond: 0,
      });
    }

    logger.info(
      {
        modelId: options.modelId,
        archivePath,
        modelDir,
      },
      "Extracting model archive",
    );
    report({
      percent: 92,
      phase: "extract",
      receivedBytes: 0,
      totalBytes: null,
      bytesPerSecond: 0,
    });
    await extractTarArchive(archivePath, options.modelsDir);

    logger.info(
      {
        modelId: options.modelId,
        modelDir,
      },
      "Verifying downloaded model files",
    );
    report({
      percent: 98,
      phase: "extract",
      receivedBytes: 0,
      totalBytes: null,
      bytesPerSecond: 0,
    });
    if (!(await hasRequiredFiles(modelDir, spec.requiredFiles))) {
      throw new Error(
        `Downloaded and extracted ${archiveFilename}, but required files are still missing in ${modelDir}.`,
      );
    }

    logger.info(
      {
        modelId: options.modelId,
        archivePath,
      },
      "Finalizing model artifacts",
    );
    try {
      await rm(archivePath, { force: true });
    } catch {
      // ignore
    }

    logger.info({ modelDir }, "Model download completed");
    report({
      percent: 100,
      phase: "complete",
      receivedBytes: 0,
      totalBytes: null,
      bytesPerSecond: 0,
    });
    return modelDir;
  } catch (error) {
    logger.error({ err: error }, "Model download failed");
    throw error;
  }
}

export async function ensureSherpaOnnxModels(options: {
  modelsDir: string;
  modelIds: SherpaOnnxModelId[];
  logger: pino.Logger;
  onProgress?: ModelDownloadProgressListener;
}): Promise<Record<SherpaOnnxModelId, string>> {
  const uniq = Array.from(new Set(options.modelIds));
  const entries: Array<[SherpaOnnxModelId, string]> = await Promise.all(
    uniq.map(async (id) => {
      const modelPath = await ensureSherpaOnnxModel({
        modelsDir: options.modelsDir,
        modelId: id,
        logger: options.logger,
        onProgress: options.onProgress,
      });
      return [id, modelPath] as [SherpaOnnxModelId, string];
    }),
  );
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<SherpaOnnxModelId, string>;
}
