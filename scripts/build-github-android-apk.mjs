#!/usr/bin/env node
/**
 * Build a production Android APK entirely on the local machine / CI runner.
 *
 * Does not call EAS. Flow:
 *   build app deps → expo prebuild → optional release keystore → gradle assembleRelease
 *
 * Optional signing secrets (recommended for install-over-update stability):
 *   ANDROID_KEYSTORE_BASE64  base64-encoded .jks / .keystore
 *   ANDROID_KEYSTORE_PASSWORD
 *   ANDROID_KEY_ALIAS
 *   ANDROID_KEY_PASSWORD
 *
 * Without those secrets, the generated project keeps Expo's default debug keystore
 * for the release build (fine for sideload APKs; installers must uninstall older
 * differently-signed packages first).
 *
 * Prints the absolute APK path on the last stdout line for CI consumption.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const appDir = path.join(rootDir, "packages", "app");
const androidDir = path.join(appDir, "android");
const appGradlePath = path.join(androidDir, "app", "build.gradle");

function run(command, args, { cwd = rootDir, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

function npm(args, options) {
  run(process.platform === "win32" ? "npm.cmd" : "npm", args, options);
}

function findReleaseApks(dir, found = []) {
  if (!existsSync(dir)) {
    return found;
  }
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      findReleaseApks(full, found);
      continue;
    }
    if (name.endsWith(".apk") && !name.includes("unaligned")) {
      found.push(full);
    }
  }
  return found;
}

function pickReleaseApk() {
  const outputs = path.join(androidDir, "app", "build", "outputs", "apk");
  const apks = findReleaseApks(outputs);
  if (apks.length === 0) {
    throw new Error(`No APK found under ${outputs}`);
  }

  // Prefer classic assembleRelease path, then largest file as a fallback.
  const preferred = apks.find((p) => /[/\\]release[/\\]app-release\.apk$/i.test(p));
  if (preferred) {
    return preferred;
  }
  return apks.map((p) => ({ p, size: statSync(p).size })).sort((a, b) => b.size - a.size)[0].p;
}

function configureReleaseSigningFromEnv() {
  const base64 = process.env.ANDROID_KEYSTORE_BASE64?.trim() ?? "";
  const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD?.trim() ?? "";
  const keyAlias = process.env.ANDROID_KEY_ALIAS?.trim() ?? "";
  const keyPassword = process.env.ANDROID_KEY_PASSWORD?.trim() ?? storePassword;

  if (!base64) {
    console.log("No ANDROID_KEYSTORE_BASE64 set; release APK will use the Expo debug keystore.");
    return;
  }

  for (const [name, value] of [
    ["ANDROID_KEYSTORE_PASSWORD", storePassword],
    ["ANDROID_KEY_ALIAS", keyAlias],
    ["ANDROID_KEY_PASSWORD", keyPassword],
  ]) {
    if (!value) {
      throw new Error(`${name} is required when ANDROID_KEYSTORE_BASE64 is set`);
    }
  }

  const storeFileName = "release.keystore";
  const storeFilePath = path.join(androidDir, "app", storeFileName);
  writeFileSync(storeFilePath, Buffer.from(base64, "base64"));

  let gradle = readFileSync(appGradlePath, "utf8");

  if (!gradle.includes("signingConfigs {")) {
    throw new Error(`Could not find signingConfigs in ${appGradlePath}`);
  }

  // Replace the whole signingConfigs block with debug + release.
  const signingConfigsBlock = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('${storeFileName}')
            storePassword ${JSON.stringify(storePassword)}
            keyAlias ${JSON.stringify(keyAlias)}
            keyPassword ${JSON.stringify(keyPassword)}
        }
    }`;

  gradle = gradle.replace(/signingConfigs\s*\{[\s\S]*?\n    \}/, signingConfigsBlock);

  // Point the release buildType at signingConfigs.release (default template uses debug).
  gradle = gradle.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    "$1signingConfig signingConfigs.release",
  );

  if (!gradle.includes("signingConfig signingConfigs.release")) {
    throw new Error("Failed to wire release signingConfig in app/build.gradle");
  }

  writeFileSync(appGradlePath, gradle);
  console.log(`Configured release signing with keystore alias ${keyAlias}`);
}

function main() {
  const lowMem = process.env.PASEO_APK_LOW_MEM ?? process.env.PASEO_EAS_APK_LOW_MEM ?? "1";
  const prebuildEnv = {
    ...process.env,
    APP_VARIANT: "production",
    // Prefer the generic name; keep EAS alias for local/EAS profile parity.
    PASEO_APK_LOW_MEM: lowMem,
    PASEO_EAS_APK_LOW_MEM: lowMem,
  };

  console.log("==> Building app workspace deps");
  npm(["run", "build:app-deps"], { cwd: rootDir, env: prebuildEnv });
  npm(["run", "build:terminal-webview"], { cwd: appDir, env: prebuildEnv });
  npm(["run", "build:mermaid-webview"], { cwd: appDir, env: prebuildEnv });

  console.log("==> Expo prebuild (production Android)");
  if (existsSync(androidDir)) {
    rmSync(androidDir, { recursive: true, force: true });
  }
  run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["expo", "prebuild", "--platform", "android", "--clean", "--non-interactive"],
    { cwd: appDir, env: prebuildEnv },
  );

  if (!existsSync(appGradlePath)) {
    throw new Error(`prebuild did not create ${appGradlePath}`);
  }

  configureReleaseSigningFromEnv();

  console.log("==> Gradle assembleRelease");
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  // Single-worker assemble: Metro/hermesc + native compile peak together; more
  // workers on GHA runners commonly get the job SIGTERM'd ("operation canceled").
  run(
    gradlew,
    [
      ":app:assembleRelease",
      "-x",
      "lint",
      "-x",
      "lintVitalAnalyzeRelease",
      "-x",
      "lintVitalRelease",
      "-x",
      "generateReleaseLintModel",
      "-x",
      "generateReleaseLintVitalModel",
      "--no-daemon",
      "--max-workers=1",
      "-Dorg.gradle.parallel=false",
      "-Dorg.gradle.workers.max=1",
      "-PreactNativeArchitectures=arm64-v8a",
    ],
    {
      cwd: androidDir,
      env: {
        ...prebuildEnv,
        // Metro/Hermes for the release JS bundle.
        NODE_ENV: "production",
        CI: "true",
        ORG_GRADLE_PROJECT_reactNativeArchitectures:
          process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures ?? "arm64-v8a",
      },
    },
  );

  const apkPath = pickReleaseApk();
  const outDir = process.env.ANDROID_APK_OUTPUT_DIR?.trim();
  let finalPath = apkPath;

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const name = process.env.ANDROID_APK_OUTPUT_NAME?.trim() || path.basename(apkPath);
    finalPath = path.join(outDir, name);
    copyFileSync(apkPath, finalPath);
  }

  console.log(`Built Android APK: ${finalPath}`);

  // Machine-readable handoff for CI (avoid scraping mixed Gradle/npm stdout).
  const pathFile = process.env.ANDROID_APK_PATH_FILE?.trim();
  if (pathFile) {
    mkdirSync(path.dirname(pathFile), { recursive: true });
    writeFileSync(pathFile, `${finalPath}\n`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT?.trim();
  if (githubOutput) {
    writeFileSync(
      githubOutput,
      `asset_path=${finalPath}\nasset_name=${path.basename(finalPath)}\n`,
      {
        flag: "a",
      },
    );
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
