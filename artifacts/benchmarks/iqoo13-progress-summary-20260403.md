# iQOO13 Inference + TurboQuant Progress Summary (April 3, 2026)

## What we have completed

### 1. Baseline stabilization and automation hardening
- Stabilized benchmark automation and deep-link command handling to run unattended from ADB.
- Added timeout/retry hardening in the headless matrix runner.
- Fixed command queue/re-init behavior in benchmark automation flow.
- Produced and validated CPU/OpenCL benchmark artifacts for iQOO13.

Key baseline artifacts:
- `artifacts/benchmarks/iqoo13-cpu-opencl-final-20260403-094415/`
- `artifacts/benchmarks/iqoo13-phase-summary-20260403.md`

### 2. Product/runtime recommendations from measured data
- Confirmed on iQOO13:
  - `CPU` is best default for interactive token generation.
  - `OpenCL` is useful selectively for prompt-heavy throughput cases.
  - `Hexagon` is not reliable in this branch/runtime path and remains disabled/not recommended.

### 3. TurboQuant branch bootstrap and integration start
- Traced TurboQuant source to TheTom fork branch `feature/turboquant-kv-cache` (not `master`).
- Integrated TurboQuant-capable source as `llama.rn-upstream/cpp-turbo` (parallel path, not destructive replacement).
- Extended app + llama.rn config types to accept:
  - `turbo2_0`
  - `turbo3_0`
  - `turbo4_0`
- Wired TurboQuant cache values through deep-link benchmark automation.
- Added TurboQuant-aware cache compatibility logic (backend/flash-attn restrictions).
- Added/updated tests for cache types, parsing, and estimators.

### 4. Android build/install status
- TurboQuant-integrated debug APK build succeeded previously and installed.
- App launch on device is stable (no immediate crash).
- Current APK on disk:
  - `android/app/build/outputs/apk/debug/app-debug.apk`
  - timestamp: `2026-04-03 09:42:43 +0530`

### 5. TurboQuant smoke-run status
- Cold-start automation command with TurboQuant reached app and entered `running`.
- Confirmed command payload used requested overrides (`cache_type_k/v=turbo2_0`).
- Run stalled during native model/context initialization path (no success/failure completion).
- Documented in:
  - `artifacts/benchmarks/iqoo13-turboquant-smoke-20260403.md`

## Current state / blocker

- Integration is partly successful: build/install/dispatch/path plumbing is working.
- Primary blocker is native runtime behavior for TurboQuant context init (CPU smoke run stalls).
- JS automation timeout did not recover this stall case cleanly, indicating synchronous/native blocking behavior.

## What is next (ordered)

1. Rebuild and install latest instrumentation build.
- We already added extra native logs around:
  - requested cache types at `rn-llama` load entry
  - translated llama context params
  - context construction entry/exit
  - Turbo KV padding/allocation points
- Next: produce fresh APK and install to capture these new breadcrumbs in logcat.

2. Run controlled TurboQuant isolation matrix (small model first).
- Start with `gemma-3-270m-it-IQ4_NL.gguf`, backend `cpu`, cold-start each run.
- Test these combinations in order:
  - `K=turbo2_0, V=f16`
  - `K=f16, V=turbo2_0`
  - `K=turbo2_0, V=turbo2_0`
  - then `turbo3_0`, `turbo4_0` only if turbo2 path works.
- Keep `flash_attn_type=on` for quantized V compatibility checks.

3. Make automation failure handling robust for native stalls.
- Add explicit watchdog/fail-safe that can mark command failed if native init blocks and no forward progress event appears.

4. Promote only after objective pass criteria.
- TurboQuant phase can move forward only if:
  - context init completes reliably
  - benchmark run returns succeeded/failed deterministically
  - no hangs on repeated unattended runs
  - benchmark deltas are measurable against the existing CPU/OpenCL baseline.

## Operational note

- Repo is currently dirty with many in-progress files (expected for this phase).
- No destructive resets were done; work is preserved for continued iteration.
