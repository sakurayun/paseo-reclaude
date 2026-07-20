#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
PERF_DAEMON_HOME="${PASEO_DESKTOP_PERF_HOME:-${REPOSITORY_ROOT}/.dev/desktop-version-comparison/paseo-home}"
PERF_DAEMON_LISTEN="${PASEO_DESKTOP_PERF_LISTEN:-127.0.0.1:17677}"
PERF_DAEMON_CORS_ORIGINS="${PASEO_DESKTOP_PERF_CORS_ORIGINS:-http://localhost:8082}"
PERF_DAEMON_SERVER_ID="${PASEO_DESKTOP_PERF_SERVER_ID:-srv_desktop_version_perf_v1}"

if [[ "${PERF_DAEMON_LISTEN}" == *":6767" ]]; then
  echo "Refusing to use the production daemon port 6767" >&2
  exit 1
fi

mkdir -p "${PERF_DAEMON_HOME}"
cd "${REPOSITORY_ROOT}/packages/server"

exec env \
  PASEO_HOME="${PERF_DAEMON_HOME}" \
  PASEO_SERVER_ID="${PERF_DAEMON_SERVER_ID}" \
  PASEO_LISTEN="${PERF_DAEMON_LISTEN}" \
  PASEO_CORS_ORIGINS="${PERF_DAEMON_CORS_ORIGINS}" \
  PASEO_NODE_ENV="development" \
  NODE_ENV="development" \
  PASEO_RELAY_ENABLED="0" \
  PASEO_NODE_INSPECT="0" \
  PASEO_DICTATION_ENABLED="0" \
  PASEO_VOICE_MODE_ENABLED="0" \
  PASEO_DICTATION_STT_PROVIDER="openai" \
  PASEO_VOICE_TURN_DETECTION_PROVIDER="openai" \
  PASEO_VOICE_STT_PROVIDER="openai" \
  PASEO_VOICE_TTS_PROVIDER="openai" \
  npx tsx scripts/supervisor-entrypoint.ts --dev
