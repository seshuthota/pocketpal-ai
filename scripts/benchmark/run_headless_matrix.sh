#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ADB_BIN="${ADB_BIN:-}"
if [[ -z "${ADB_BIN}" ]]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  elif [[ -x "$HOME/Android/Sdk/platform-tools/adb" ]]; then
    ADB_BIN="$HOME/Android/Sdk/platform-tools/adb"
  else
    echo "ERROR: adb not found. Set ADB_BIN=/full/path/to/adb." >&2
    exit 1
  fi
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required." >&2
  exit 1
fi

PACKAGE_NAME="${PACKAGE_NAME:-com.pocketpalai}"
LATEST_STATUS_PATH="${LATEST_STATUS_PATH:-files/debug-benchmark/latest-status.json}"
RUN_ID="${RUN_ID:-matrix-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/artifacts/benchmarks/$RUN_ID}"

PP="${PP:-64}"
TG="${TG:-32}"
PL="${PL:-1}"
NR="${NR:-1}"
N_CTX="${N_CTX:-1024}"
N_BATCH="${N_BATCH:-128}"
N_UBATCH="${N_UBATCH:-64}"
N_THREADS="${N_THREADS:-6}"
TIMEOUT_SECS="${TIMEOUT_SECS:-900}"
RESET_APP_BETWEEN_RUNS="${RESET_APP_BETWEEN_RUNS:-0}"
RESET_SLEEP_SECS="${RESET_SLEEP_SECS:-1}"
START_ACK_TIMEOUT_SECS="${START_ACK_TIMEOUT_SECS:-20}"
START_RETRIES="${START_RETRIES:-3}"
START_CMD_TIMEOUT_SECS="${START_CMD_TIMEOUT_SECS:-20}"
READ_STATUS_TIMEOUT_SECS="${READ_STATUS_TIMEOUT_SECS:-5}"
FLASH_ATTN_TYPE="${FLASH_ATTN_TYPE:-}"
CACHE_TYPE_K="${CACHE_TYPE_K:-}"
CACHE_TYPE_V="${CACHE_TYPE_V:-}"
KV_UNIFIED="${KV_UNIFIED:-}"
NO_EXTRA_BUFTS="${NO_EXTRA_BUFTS:-}"
USE_MMAP="${USE_MMAP:-}"
USE_MLOCK="${USE_MLOCK:-}"

MODELS_CSV="${MODELS_CSV:-gemma-3-1b-it-Q4_0.gguf,Qwen3.5-4B-Q4_0.gguf,gemma-3-270m-it-IQ4_NL.gguf}"
BACKENDS_CSV="${BACKENDS_CSV:-auto,cpu,opencl}"

mkdir -p "$OUT_DIR"

TSV_PATH="$OUT_DIR/results.tsv"
MD_PATH="$OUT_DIR/results.md"
RUN_LOG="$OUT_DIR/run.log"

echo -e "command_id\tmodel\tbackend_requested\tstatus\tbackend_selected\tpp\ttg\tdevices\terror\ttimestamp" >"$TSV_PATH"
echo "Run ID: $RUN_ID" >"$RUN_LOG"
echo "Started: $(date --iso-8601=seconds)" >>"$RUN_LOG"
echo "ADB: $ADB_BIN" >>"$RUN_LOG"
echo "Package: $PACKAGE_NAME" >>"$RUN_LOG"
echo "Models: $MODELS_CSV" >>"$RUN_LOG"
echo "Backends: $BACKENDS_CSV" >>"$RUN_LOG"
echo "Config: pp=$PP tg=$TG pl=$PL nr=$NR n_ctx=$N_CTX n_batch=$N_BATCH n_ubatch=$N_UBATCH n_threads=$N_THREADS" >>"$RUN_LOG"
echo "Overrides: flash_attn_type=${FLASH_ATTN_TYPE:-<default>} cache_type_k=${CACHE_TYPE_K:-<default>} cache_type_v=${CACHE_TYPE_V:-<default>} kv_unified=${KV_UNIFIED:-<default>} no_extra_bufts=${NO_EXTRA_BUFTS:-<default>} use_mmap=${USE_MMAP:-<default>} use_mlock=${USE_MLOCK:-<default>}" >>"$RUN_LOG"
echo "Reset app between runs: $RESET_APP_BETWEEN_RUNS (sleep ${RESET_SLEEP_SECS}s)" >>"$RUN_LOG"
echo "Start ack timeout: ${START_ACK_TIMEOUT_SECS}s, retries: ${START_RETRIES}" >>"$RUN_LOG"
echo "Start command timeout: ${START_CMD_TIMEOUT_SECS}s" >>"$RUN_LOG"
echo "Read status timeout: ${READ_STATUS_TIMEOUT_SECS}s" >>"$RUN_LOG"

device_count="$("$ADB_BIN" devices | awk 'NR>1 && $2=="device" {c++} END {print c+0}')"
if [[ "$device_count" -lt 1 ]]; then
  echo "ERROR: no ADB device connected." | tee -a "$RUN_LOG" >&2
  exit 1
fi

urlencode_label() {
  local raw="$1"
  echo "${raw// /%20}"
}

read_latest_status() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${READ_STATUS_TIMEOUT_SECS}s" \
      "$ADB_BIN" shell run-as "$PACKAGE_NAME" cat "$LATEST_STATUS_PATH" 2>/dev/null || true
  else
    "$ADB_BIN" shell run-as "$PACKAGE_NAME" cat "$LATEST_STATUS_PATH" 2>/dev/null || true
  fi
}

reset_app_state() {
  "$ADB_BIN" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
  sleep "$RESET_SLEEP_SECS"
}

start_benchmark_command() {
  local deeplink_escaped="$1"
  if command -v timeout >/dev/null 2>&1; then
    timeout "${START_CMD_TIMEOUT_SECS}s" \
      "$ADB_BIN" shell am start -W -a android.intent.action.VIEW -d "$deeplink_escaped" "$PACKAGE_NAME" >/dev/null
  else
    "$ADB_BIN" shell am start -W -a android.intent.action.VIEW -d "$deeplink_escaped" "$PACKAGE_NAME" >/dev/null
  fi
}

start_main_activity() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${START_CMD_TIMEOUT_SECS}s" \
      "$ADB_BIN" shell am start -W -n "$PACKAGE_NAME/com.pocketpal.MainActivity" >/dev/null 2>&1 || true
  else
    "$ADB_BIN" shell am start -W -n "$PACKAGE_NAME/com.pocketpal.MainActivity" >/dev/null 2>&1 || true
  fi
}

run_one() {
  local model="$1"
  local backend="$2"

  local model_tag
  model_tag="$(echo "$model" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  model_tag="${model_tag:0:48}"
  local command_id="${RUN_ID}-${model_tag}-${backend}"
  local label
  label="$(urlencode_label "$command_id")"

  local deeplink
  deeplink="pocketpal://benchmark?filename=${model}&backend=${backend}&pp=${PP}&tg=${TG}&pl=${PL}&nr=${NR}&n_ctx=${N_CTX}&n_batch=${N_BATCH}&n_ubatch=${N_UBATCH}&n_threads=${N_THREADS}&label=${label}&commandId=${command_id}"

  if [[ -n "$FLASH_ATTN_TYPE" ]]; then
    deeplink="${deeplink}&flash_attn_type=${FLASH_ATTN_TYPE}"
  fi
  if [[ -n "$CACHE_TYPE_K" ]]; then
    deeplink="${deeplink}&cache_type_k=${CACHE_TYPE_K}"
  fi
  if [[ -n "$CACHE_TYPE_V" ]]; then
    deeplink="${deeplink}&cache_type_v=${CACHE_TYPE_V}"
  fi
  if [[ -n "$KV_UNIFIED" ]]; then
    deeplink="${deeplink}&kv_unified=${KV_UNIFIED}"
  fi
  if [[ -n "$NO_EXTRA_BUFTS" ]]; then
    deeplink="${deeplink}&no_extra_bufts=${NO_EXTRA_BUFTS}"
  fi
  if [[ -n "$USE_MMAP" ]]; then
    deeplink="${deeplink}&use_mmap=${USE_MMAP}"
  fi
  if [[ -n "$USE_MLOCK" ]]; then
    deeplink="${deeplink}&use_mlock=${USE_MLOCK}"
  fi

  local deeplink_escaped="${deeplink//&/\\&}"

  echo "RUN $command_id" | tee -a "$RUN_LOG"
  local acked=0
  local attempt
  for attempt in $(seq 1 "$START_RETRIES"); do
    if [[ "$RESET_APP_BETWEEN_RUNS" == "1" ]]; then
      reset_app_state
    fi

    if ! start_benchmark_command "$deeplink_escaped"; then
      echo "START_FAIL $command_id attempt=$attempt/$START_RETRIES" | tee -a "$RUN_LOG"
    fi

    local ack_start_ts ack_now
    ack_start_ts="$(date +%s)"
    while true; do
      local ack_raw ack_id
      ack_raw="$(read_latest_status)"
      ack_id="$(printf '%s' "$ack_raw" | jq -r '.command.id // empty' 2>/dev/null || true)"
      if [[ "$ack_id" == "$command_id" ]]; then
        acked=1
        break
      fi

      ack_now="$(date +%s)"
      if ((ack_now - ack_start_ts > START_ACK_TIMEOUT_SECS)); then
        break
      fi
      sleep 1
    done

    if [[ "$acked" == "1" ]]; then
      break
    fi

    echo "ACK_MISS $command_id attempt=$attempt/$START_RETRIES" | tee -a "$RUN_LOG"
    start_main_activity
    sleep 1
  done

  if [[ "$acked" != "1" ]]; then
    echo -e "${command_id}\t${model}\t${backend}\tfailed\tn/a\tn/a\tn/a\t\tCommand was not acknowledged by app\t$(date --iso-8601=seconds)" >>"$TSV_PATH"
    echo "FAILED $command_id ack not received after $START_RETRIES attempts" | tee -a "$RUN_LOG"
    return 0
  fi

  local start_ts now last_progress_ts
  start_ts="$(date +%s)"
  last_progress_ts="$start_ts"

  while true; do
    local raw latest_id latest_status
    raw="$(read_latest_status)"
    if [[ -n "$raw" ]]; then
      latest_id="$(printf '%s' "$raw" | jq -r '.command.id // empty' 2>/dev/null || true)"
      latest_status="$(printf '%s' "$raw" | jq -r '.status // empty' 2>/dev/null || true)"
      if [[ "$latest_id" == "$command_id" ]]; then
        if [[ "$latest_status" == "succeeded" || "$latest_status" == "failed" ]]; then
          local out_json="$OUT_DIR/${command_id}-${latest_status}.json"
          printf '%s' "$raw" >"$out_json"

          local selected pp tg devices err ts
          selected="$(printf '%s' "$raw" | jq -r '.result.selectedBackend // "n/a"')"
          pp="$(printf '%s' "$raw" | jq -r '.result.ppAvg // "n/a"')"
          tg="$(printf '%s' "$raw" | jq -r '.result.tgAvg // "n/a"')"
          devices="$(printf '%s' "$raw" | jq -r '(.result.runtimeDevices // []) | join(",")')"
          err="$(printf '%s' "$raw" | jq -r '.error // ""' | tr '\t' ' ')"
          ts="$(printf '%s' "$raw" | jq -r '.timestamp // ""')"

          echo -e "${command_id}\t${model}\t${backend}\t${latest_status}\t${selected}\t${pp}\t${tg}\t${devices}\t${err}\t${ts}" >>"$TSV_PATH"
          echo "DONE $command_id status=$latest_status selected=$selected pp=$pp tg=$tg devices=$devices" | tee -a "$RUN_LOG"
          return 0
        fi
        
        # If status is "running", check if we have native progress in logcat
        if [[ "$latest_status" == "running" ]]; then
            # Look for recent llama/rnllama logs (last 30s)
            if "$ADB_BIN" logcat -d -t 300 | grep -iE "RNLlama|RNLLAMA_LOG_ANDROID" >/dev/null; then
                last_progress_ts="$(date +%s)"
            fi
        fi
      fi
    fi

    now="$(date +%s)"
    
    # Watchdog for native stalls (if in running state but no logcat activity for 60s)
    if [[ -n "${latest_status:-}" && "$latest_status" == "running" ]]; then
        if ((now - last_progress_ts > 60)); then
            echo -e "${command_id}\t${model}\t${backend}\tfailed\tn/a\tn/a\tn/a\t\tNATIVE_STALL (no logcat activity for 60s)\t$(date --iso-8601=seconds)" >>"$TSV_PATH"
            echo "STALL $command_id detected via logcat watchdog" | tee -a "$RUN_LOG"
            reset_app_state
            return 0
        fi
    fi

    if ((now - start_ts > TIMEOUT_SECS)); then
      echo -e "${command_id}\t${model}\t${backend}\ttimeout\tn/a\tn/a\tn/a\t\tTimed out waiting for status\t$(date --iso-8601=seconds)" >>"$TSV_PATH"
      echo "TIMEOUT $command_id" | tee -a "$RUN_LOG"
      if [[ "$RESET_APP_BETWEEN_RUNS" == "1" ]]; then
        reset_app_state
      fi
      return 0
    fi

    sleep 2
  done
}

IFS=',' read -r -a MODELS <<<"$MODELS_CSV"
IFS=',' read -r -a BACKENDS <<<"$BACKENDS_CSV"

for model in "${MODELS[@]}"; do
  for backend in "${BACKENDS[@]}"; do
    run_one "$model" "$backend"
  done
done

{
  echo "# Benchmark Matrix ($RUN_ID)"
  echo
  echo "- Started: $(sed -n '2p' "$RUN_LOG" | sed 's/^Started: //')"
  echo "- Finished: $(date --iso-8601=seconds)"
  echo "- Device package: \`$PACKAGE_NAME\`"
  echo "- Config: pp=$PP tg=$TG pl=$PL nr=$NR n_ctx=$N_CTX n_batch=$N_BATCH n_ubatch=$N_UBATCH n_threads=$N_THREADS"
  echo
  echo "| Command ID | Model | Backend Req | Status | Backend Selected | PP | TG | Devices | Error |"
  echo "|---|---|---|---|---|---:|---:|---|---|"
  tail -n +2 "$TSV_PATH" | awk -F '\t' '{
    printf("| `%s` | `%s` | `%s` | `%s` | `%s` | %s | %s | `%s` | %s |\n",
      $1, $2, $3, $4, $5, $6, $7, $8, ($9==""?"":$9))
  }'
} >"$MD_PATH"

echo "Matrix complete."
echo "TSV: $TSV_PATH"
echo "Markdown: $MD_PATH"
