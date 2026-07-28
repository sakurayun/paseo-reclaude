# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name    | Package ID       |
| ------------- | ----------- | ---------------- |
| `production`  | Paseo       | `sh.paseo`       |
| `development` | Paseo Debug | `sh.paseo.debug` |

EAS profiles (optional store / manual cloud builds only): `development`, `production`, and `production-apk` in `packages/app/eas.json`. GitHub Release APKs do **not** use these — see **Android APK (GitHub Actions, no EAS)** below.

`development` uses Android `debug`.

## Version codes

`packages/app/app.config.js` derives Android `versionCode` from the package version with:

```text
major * 1_000_000 + minor * 1_000 + patch
```

Prerelease metadata is ignored, so `0.1.102-beta.1` and `0.1.102` both produce `1102`. The same value is used as the iOS `buildNumber` because `packages/app/eas.json` uses EAS's local app version source. Do not re-enable EAS remote version counters or Android `autoIncrement`; F-Droid and other source-based builders need the native build number to be visible in the repo.

The formula reserves three digits each for minor and patch. If either reaches `1000`, change the formula before cutting that release.

## Prerequisites (local dev)

Local Android builds run on macOS (or Linux) and need the Android toolchain, pinned in `.tool-versions` (`java 21`, `android-sdk 21.0`) and wired up by `.mise.toml` (which derives `ANDROID_HOME` and the command-line tool paths from the `android-sdk` entry). With [mise](https://mise.jdx.dev):

```bash
mise install        # java 21 + android-sdk 21.0 command-line tools
```

> **Pin a real `android-sdk` version, not `latest`.** The mise `android-sdk` plugin's `latest` resolved to the ancient `1.0` bundle, whose `sdkmanager` (3.6.0) predates the `emulator` package and fails with `Failed to find package emulator`. `21.0` ships a current `sdkmanager`. If you bump it, update only the version in `.tool-versions`; `.mise.toml` derives its paths from that tool entry.

`mise install` only lays down the command-line tools. Install the rest and create an emulator. On Apple Silicon:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;arm64-v8a"
avdmanager create avd -n paseo -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7
emulator @paseo     # start it; leave running
```

On an Intel Mac, use the `x86_64` system image:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n paseo -k "system-images;android-35;google_apis;x86_64" -d pixel_7
emulator @paseo     # start it; leave running
```

Gradle auto-fetches the platform/build-tools it needs once licenses are accepted, so adjust `android-35` only if it asks for a different level.

## Local build + install

From repo root:

```bash
npm run android:development    # Debug build
npm run android:production     # Release build
npm run android:clear          # Remove generated Android project
```

Or from `packages/app`:

```bash
# Debug
npx cross-env APP_VARIANT=development expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=development expo run:android --variant=debug

# Release
npx cross-env APP_VARIANT=production expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=production expo run:android --variant=release

# Clear generated Android project
rm -rf android
```

## Running on an emulator against a worktree daemon

`npm run android` builds and installs the dev client, but two connections have to reach your Mac from inside the emulator — Metro (the JS bundle) and the Paseo daemon — and **the emulator does not share the host's loopback**: `localhost` inside the emulator is the emulator itself. Reach the host at `10.0.2.2` (the standard AVD's host alias) for both:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:$PASEO_SERVICE_DAEMON_PORT \
  npm run android
```

- **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** — without it, Expo bakes your Mac's LAN IP into the dev client's Metro URL, which the emulator can't route to, and the app dies with `Failed to connect to /<lan-ip>:8081` before any JS loads.
- **`EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:<port>`** — the client's daemon endpoint (`packages/app/src/runtime/host-runtime.ts`); when unset it defaults to `localhost:6767`, the production daemon. Use `$PASEO_SERVICE_DAEMON_PORT` for a worktree daemon running as a Paseo service, or `6768` for a standalone `npm run dev:server`. It is inlined into the JS bundle at Metro bundle time, so set it on the build command and clear the Metro cache (`npx expo start -c`) if a change doesn't take.

**Alternative — `adb reverse` + `localhost`** (if `10.0.2.2` misbehaves):

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:$PASEO_SERVICE_DAEMON_PORT tcp:$PASEO_SERVICE_DAEMON_PORT
REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  EXPO_PUBLIC_LOCAL_DAEMON=localhost:$PASEO_SERVICE_DAEMON_PORT \
  npm run android
```

This is the Android counterpart of the iOS local-simulator flow in [development.md](development.md): on iOS the simulator shares the Mac's loopback so `localhost:<port>` works directly; on Android you need `10.0.2.2` or `adb reverse`.

## F-Droid / source-only Android builds

F-Droid builds should set `PASEO_FDROID_BUILD=1` when running Expo prebuild:

```bash
cd packages/app
PASEO_FDROID_BUILD=1 APP_VARIANT=production npx expo prebuild --platform android --clean --non-interactive
cd android
PASEO_FDROID_BUILD=1 ./gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

The flag must be present for both prebuild and Gradle because Gradle starts Metro for the release bundle. Keep the source build serial and daemon-free as shown above: compiling every Expo module can exhaust memory when Gradle workers run in parallel. The profile enables source-built Expo modules, excludes the proprietary camera, Firebase notification, and Expo development-client native modules, disables EAS updates and Gradle dependency metadata, and substitutes JavaScript stubs for camera and notifications. The resulting app supports direct and pasted-link pairing but not QR scanning or push notifications.

For a single-ABI APK, pass React Native's architecture property to Gradle:

```bash
PASEO_FDROID_BUILD=1 ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

Supported values are `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`. The F-Droid profile filters native libraries to that ABI and changes the APK version code to `baseVersionCode * 10 + abiSuffix`, where the suffixes are ordered `1` through `4` in that same sequence. F-Droid metadata should use four build blocks with `VercodeOperation` entries `10 * %c + 1` through `10 * %c + 4` and pass the matching `reactNativeArchitectures` value in each build command. Builds without a single architecture keep the base version code.

Keep the excluded npm packages installed. Normal builds use them, while the F-Droid profile removes only their Android native modules and config plugins. Paseo always applies `expo-gradle-jvmargs` with `-Xmx4096m` and `-XX:MaxMetaspaceSize=1024m` so local Expo prebuilds have enough Gradle heap whether they use precompiled AARs or source-built Expo modules.

Release builds compile native ABIs and run Hermes bundling in the same Gradle invocation; constrained CI runners can OOM-kill Hermes with exit code 137. GitHub Actions APK builds set `PASEO_APK_LOW_MEM=1` (alias: `PASEO_EAS_APK_LOW_MEM`):

- Gradle heap `-Xmx2048m` (leave RAM for `hermesc`) and `buildArchs: ["arm64-v8a"]` only
- Gradle uses `--no-daemon` with a low worker cap so native compile and the JS/Hermes step do not pile up

Other Android builds keep `armeabi-v7a` + `arm64-v8a` and the larger Gradle heap. The low-mem APK will not run on 32-bit-only phones or x86 emulators.

### React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

### Runtime version

`packages/app/app.config.js` sets `runtimeVersion` explicitly from `packages/app/package.json` (`pkg.version`). Keep it that way. Do not switch back to `{ policy: "appVersion" }` while `packages/app/eas.json` uses `cli.appVersionSource = "remote"`: local config evaluation can resolve the policy to the package version, while EAS remote build evaluation can resolve it to `null`, causing the build to fail with a local/EAS runtime version mismatch.

Keep `packages/app/app.config.js` as CommonJS (`module.exports`). EAS Build's app-config read phase must load the dynamic config; if it falls back to package defaults like `name: @getpaseo/app`, `runtimeVersion` is omitted and expo-updates resolves the in-build runtime as `null`.

Do not ignore `packages/app/app.config.js`. EAS Build's archive step applies ignore rules, and excluding this tracked config file causes the remote worker to fall back to package defaults.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Android APK (GitHub Actions, no EAS)

Sideload APKs are built **entirely on GitHub Actions** by `.github/workflows/android-apk-release.yml`. The workflow does **not** call `eas build` and does not need `EXPO_TOKEN`.

Stable / beta tags (`v*`) and `android-v*` tags trigger it. `workflow_dispatch` accepts an existing `tag` input so you can rebuild without cutting a new tag.

Pipeline on the runner:

1. Install Node 22, Java 21, Android SDK (`platforms;android-36`, `build-tools;36.0.0`, NDK `27.1.12297006`)
2. `npm ci` + `node scripts/build-github-android-apk.mjs`
   - `build:app-deps`, terminal/mermaid webviews
   - `expo prebuild --platform android --clean` with `APP_VARIANT=production` and `PASEO_APK_LOW_MEM=1`
   - optional release keystore from repo secrets (see below)
   - `./gradlew :app:assembleRelease`
3. Upload `paseo-<tag>-android.apk` to the GitHub Release (and as a workflow artifact)

Local parity (needs Android SDK + Java 21 on your machine):

```bash
# From repo root after npm install
PASEO_APK_LOW_MEM=1 npm run android:apk --workspace=@getpaseo/app
# or
PASEO_APK_LOW_MEM=1 node scripts/build-github-android-apk.mjs
```

### Optional release keystore secrets

Without secrets, the APK is signed with Expo's default **debug** keystore (works for sideload; upgrades from a differently signed package require uninstall first).

To sign with your own keystore, set these repository secrets:

| Secret                      | Meaning                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | Base64 of the `.jks` / `.keystore` file                                                    |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password                                                                          |
| `ANDROID_KEY_ALIAS`         | Key alias                                                                                  |
| `ANDROID_KEY_PASSWORD`      | Key password (falls back to store password if unset in the script path that requires both) |

### Store builds (EAS, optional)

Store iOS / Play Store Android builds are a separate path and may still be driven by the EAS GitHub app when configured on the Expo project. They are **not** used for the GitHub Release APK asset.

See [docs/release.md](release.md) for the full release babysitting flow.
