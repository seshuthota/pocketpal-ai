# iQOO13 TurboQuant Smoke - 2026-04-03

## Scope

- Branch state: local TurboQuant integration in `llama.rn-upstream/cpp-turbo`
- Device: iQOO 13 (`I2401`)
- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Model: `gemma-3-270m-it-IQ4_NL.gguf`
- Requested backend: `cpu`
- Requested overrides:
  - `flash_attn_type=on`
  - `cache_type_k=turbo2_0`
  - `cache_type_v=turbo2_0`
  - `n_ctx=512`
  - `n_batch=64`
  - `n_ubatch=64`
  - `n_threads=6`

## What Worked

- Android debug APK built and installed successfully.
- App cold-started on device without immediate crash.
- Benchmark deep link was received and parsed by JS.
- Benchmark automation acknowledged the command and wrote `queued` then `running` status files.
- The requested TurboQuant cache types reached the automation command payload intact.

## Current Failure Mode

- Command ID: `tq-cold-turbo2-1775193798`
- Latest observed status: `running`
- The run progressed through:
  - deep link handling
  - benchmark command queueing
  - model resolution
  - context param resolution
- The run did **not** progress to:
  - `Model selected`
  - benchmark completion
  - explicit JS-side failure

## Interpretation

- JS automation is functioning.
- The stall is most likely inside native `initLlama(...)` / context initialization for TurboQuant KV cache settings, not in deep-link dispatch or benchmark orchestration.
- The JS-side model-load timeout did not trip after the nominal 180-second limit, which strongly suggests the TurboQuant stall is blocking the JS thread synchronously enough that timer-based recovery is ineffective.
- This is an integration checkpoint, not a recommendation-ready result.

## Next Debug Targets

1. Add native logging around TurboQuant cache-type parsing and context creation entry/exit.
2. Check whether `turbo2_0` with `cache_type_v=f16` still stalls, to isolate K vs V handling.
3. Check whether the command fails cleanly after the automation model-load timeout.
4. Only after CPU bring-up works, expand to `turbo3_0` and `turbo4_0`.
