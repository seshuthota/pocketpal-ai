# iQOO 13 TurboQuant Bootstrap Notes (April 3, 2026)

## Baseline Before TurboQuant

- Stable PocketPal baseline is now measured against:
  - `artifacts/benchmarks/iqoo13-cpu-opencl-final-20260403-094415/results.tsv`
- Current product recommendation remains:
  - `Interactive`: CPU
  - `Throughput`: OpenCL

## Local Source State

- PocketPal links `llama.rn` from the local checkout:
  - `llama.rn-upstream`
- `package.json` points to:
  - `llama.rn: link:./llama.rn-upstream`
- Current local `llama.rn-upstream` HEAD:
  - `0fd7f4d`

## TurboQuant Candidate Repos

- TheTom fork `master`:
  - local clone: `../llama-cpp-turboquant-upstream`
  - HEAD: `a1cfb64`
  - observation: Android/OpenCL/Hexagon work is present, but TurboQuant KV types are not on `master`

- TheTom TurboQuant branch:
  - local clone: `../llama-cpp-turboquant-kv-cache`
  - branch: `feature/turboquant-kv-cache`
  - HEAD: `63b832b`
  - observation: this branch contains the actual TurboQuant cache implementation

## Confirmed TurboQuant Surface On The Feature Branch

- New KV cache types exist in `ggml/include/ggml.h`:
  - `GGML_TYPE_TURBO2_0`
  - `GGML_TYPE_TURBO3_0`
  - `GGML_TYPE_TURBO4_0`
- CLI cache parsing in `common/arg.cpp` includes:
  - `turbo2_0`
  - `turbo3_0`
  - `turbo4_0`
- Core implementation is present in:
  - `ggml/src/ggml-turbo-quant.c`
  - `src/llama-kv-cache.cpp`
  - `src/llama-context.cpp`

## Why This Is Not A Drop-In Swap

1. `llama.rn-upstream/cpp` is a vendored, patched tree, not a clean submodule checkout.
2. `llama.rn-upstream` expects a flat legacy-ish source layout:
   - `cpp/llama.cpp`
   - `cpp/llama.h`
   - `cpp/ggml-opencl/*`
   - `cpp/ggml-hexagon/*`
3. The TurboQuant branch uses the newer upstream layout:
   - `include/llama.h`
   - `src/*`
   - `ggml/src/*`
   - `ggml/include/*`
4. `llama.rn-upstream` has its own bridge layer that must be preserved:
   - `cpp/rn-llama.cpp`
   - `cpp/rn-completion.cpp`
   - `cpp/rn-slot.cpp`
   - `cpp/rn-slot-manager.cpp`
   - `cpp/rn-tts.cpp`
   - `cpp/jsi/*`
5. Current `llama.rn-upstream` cache-type parsing only supports:
   - `f32`
   - `f16`
   - `bf16`
   - `q8_0`
   - `q4_0`
   - `q4_1`
   - `iq4_nl`
   - `q5_0`
   - `q5_1`
   - It does not yet expose `turbo2_0`, `turbo3_0`, or `turbo4_0`

## Required Integration Work

1. Create a dedicated `llama.rn-upstream` integration branch for TurboQuant.
2. Port the `llama.rn` bridge layer onto the TurboQuant source layout instead of replacing `cpp/` blindly.
3. Update Android CMake in `llama.rn-upstream/android/src/main/rnllama/CMakeLists.txt` for the new upstream directory structure.
4. Update iOS CMake in `llama.rn-upstream/ios/CMakeLists.txt` for the new upstream directory structure.
5. Extend `llama.rn-upstream` cache-type validation and parsing to allow:
   - `turbo2_0`
   - `turbo3_0`
   - `turbo4_0`
6. Verify whether OpenCL kernels on the TurboQuant branch are CPU-fallback only for KV dequant on Android or whether any new OpenCL path is present for TurboQuant itself.
7. Build a dedicated APK and compare against the current baseline artifacts before changing product defaults.

## Recommended Next Phase

1. Branch `llama.rn-upstream` as `turboquant-integration`.
2. Add a separate vendor import path for `feature/turboquant-kv-cache`.
3. Port the `rn-*` bridge files and `jsi/*` bindings to that tree.
4. Add TurboQuant cache enums through TypeScript, JSI, and native parsing.
5. Build Android debug APK with OpenCL still enabled.
6. Run long-context benchmark matrix on iQOO 13:
   - CPU baseline
   - OpenCL baseline
   - TurboQuant `turbo3_0`
   - TurboQuant `turbo4_0`
7. Decide whether TurboQuant should become:
   - benchmark-only experimental mode first
   - or a user-visible advanced cache option
