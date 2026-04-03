# iQOO13 TurboQuant Reviewed Results (April 3, 2026)

This file reconciles `iqoo13-turboquant-final-results-20260403.md` with raw benchmark artifacts under `artifacts/benchmarks/matrix-20260403-*`.

## Verified outcomes

1. TurboQuant functional status on CPU:
- Verified successful benchmark runs with TurboQuant cache types:
  - `turbo2_0`, `turbo3_0`, `turbo4_0`
  - Models verified in artifacts:
    - `gemma-3-270m-it-IQ4_NL.gguf`
    - `gemma-3-1b-it-Q4_0.gguf`
    - `Qwen3.5-4B-Q4_0.gguf`

2. High-context scaling on `Qwen3.5-4B-Q4_0.gguf` with `turbo4_0`:
- Verified `succeeded` at:
  - `131072` (`128k`)
  - `262144` (`256k`)
  - `786432` (`768k`)
- Verified `failed` (`NATIVE_STALL`) at:
  - `1048576` (`1M`)

3. Watchdog hardening in runner:
- Confirmed in `scripts/benchmark/run_headless_matrix.sh`:
  - `NATIVE_STALL` detection path and failure record.

## Artifact-backed table (Qwen 4B)

Values below come from succeeded JSON artifacts (`result.peakMemoryUsage.used`, `ppAvg`, `tgAvg`):

| N_CTX | Cache | Status | Peak Memory (GiB) | PP | TG |
|---|---|---|---:|---:|---:|
| 8192 (8k) | f16 | SUCCESS | 3.35 | 25.93 | 12.94 |
| 131072 (128k) | turbo4_0 | SUCCESS | 4.42 | 27.39 | 11.68 |
| 262144 (256k) | turbo4_0 | SUCCESS | 5.07 | 27.00 | 11.25 |
| 786432 (768k) | turbo4_0 | SUCCESS | 8.85 | 31.18 | 13.08 |
| 1048576 (1M) | turbo4_0 | FAILED (`NATIVE_STALL`) | N/A | N/A | N/A |

## Important reconciliation notes

1. `512k` row from the generated summary is not currently artifact-verified:
- `matrix-20260403-154532/results.tsv` has header only (no completed row).
- Treat `512k SUCCESS` as unconfirmed until rerun.

2. Speed trend:
- For verified high-context TurboQuant runs, TG remains in the same practical band (~11-13 tok/s), consistent with "no major penalty" for this setup.

3. Memory claim phrasing:
- Theoretical/comparative compression claims may still be valid, but this repo currently has direct measured points listed above; use those as source-of-truth in project docs.

## Recommended next execution set

1. Re-run `512k` once with `RESET_APP_BETWEEN_RUNS=1` to fill the gap.
2. Run OpenCL compatibility matrix at `128k` and `256k` with `turbo4_0` (expect stricter behavior).
3. Do one `flash_attn=off` control run at `128k` to validate expected safety/failure behavior.
