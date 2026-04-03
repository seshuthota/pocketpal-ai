# iQOO 13 Inference Summary (April 3, 2026)

## Artifact Sources

- Non-Q6 post-fix matrix:
  - `artifacts/benchmarks/iqoo13-nonq6-postfix-20260403-085348/results.tsv`
- Hexagon-inclusive check (partial; enough to validate availability):
  - `artifacts/benchmarks/iqoo13-nonq6-postfix-hex-20260403-085548/results.tsv`
- Auto-routing verification after code updates:
  - `artifacts/benchmarks/iqoo13-auto-verify2-20260403-091123/results.tsv`
- Final controlled CPU/OpenCL matrix:
  - `artifacts/benchmarks/iqoo13-cpu-opencl-final-20260403-094415/results.tsv`

## Confirmed Findings

1. Backend-switch contamination is fixed in benchmark automation.
   - Sequential same-model `cpu` vs `opencl` runs now report the requested backend correctly.

2. Hexagon is not currently usable on this build/device path.
   - Command fails with:
     - `Requested backend is not available on this device: hexagon`

3. OpenCL is available and stable, but decode performance tradeoff is model-dependent.
   - For tested Q4_0 / IQ4_NL models, OpenCL improved prompt processing (`pp`) but often reduced token generation (`tg`) versus CPU.

4. Auto-routing still requires conservative interpretation in practice.
   - Verify artifacts show mixed backend choices depending on runtime state and model metadata availability.

5. Final controlled CPU/OpenCL runs confirm the product recommendation.
   - `gemma-3-1b-it-Q4_0.gguf`
     - CPU: `pp=156.73`, `tg=48.52`
     - OpenCL: `pp=334.26`, `tg=33.42`
   - `Qwen3.5-4B-Q4_0.gguf`
     - CPU: `pp=27.40`, `tg=11.51`
     - OpenCL: `pp=60.01`, `tg=4.41`
   - `gemma-3-270m-it-IQ4_NL.gguf`
     - CPU: `pp=397.93`, `tg=129.84`
     - OpenCL: `pp=575.58`, `tg=25.53`
   - Interpretation:
     - OpenCL consistently improves prompt processing.
     - CPU consistently wins token generation for interactive decode on this device/config set.

## Implemented Changes

### Benchmark reliability

- `src/hooks/useBenchmarkAutomation.ts`
  - Force-releases existing context before benchmark model re-init to guarantee backend/config changes are applied.
  - Added benchmark/model-load timeouts, serialized queue draining, and duplicate command hardening.

- `src/hooks/useDeepLinking.ts`
  - Removed premature benchmark ownership state so the automation runner, not the deep-link handler, owns execution lifecycle.

- `scripts/benchmark/run_headless_matrix.sh`
  - Added robust ADB runner with:
    - matrix execution (`MODELS_CSV`, `BACKENDS_CSV`)
    - artifact outputs (`results.tsv`, `results.md`, per-run JSON)
    - optional app reset between runs
    - deep-link ACK retry controls:
      - `START_ACK_TIMEOUT_SECS`
      - `START_RETRIES`
      - `START_CMD_TIMEOUT_SECS`
      - `READ_STATUS_TIMEOUT_SECS`

- `scripts/benchmark/README.md`
  - Documented override knobs and reliability controls.
  - Added guidance for cold-start-safe launch settings on Android devices.

### Hardware routing hardening

- `src/utils/hardwareProfiles.ts`
  - Added filename-based parameter inference (`4B`, `270M`) when model metadata params are missing.
  - Added caching/retry behavior for hardware optimized config resolution.
  - Added fallback behavior: keep OpenCL profile if a GPU device is present even when capability probe is transiently false.

- `src/utils/__tests__/hardwareProfiles.test.ts`
  - Added/updated tests for:
    - missing-metadata param inference
    - transient GPU capability false handling

## Current Recommendation for iQOO 13

1. Use CPU as the stability baseline for interactive chat latency.
2. Use OpenCL selectively for prompt-heavy workloads and specific model/quants where measured `tg` remains acceptable.
3. Keep Hexagon as disabled/unsupported for now in this branch until backend availability changes in `llama.rn` runtime detection.
4. Continue with headless matrix runs using only `cpu` + `opencl` for next tuning loop; treat Hexagon as a separate future work item.
5. Product defaults should stay:
   - `Interactive`: CPU
   - `Throughput`: OpenCL

## Open Technical Risk

- Cold-start ACK timing can still lag on Android if retries are aggressive.
  - For unattended runs on this device, use `START_RETRIES=1` with a longer `START_ACK_TIMEOUT_SECS` to avoid duplicate dispatch of the same command ID.
