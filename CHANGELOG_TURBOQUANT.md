# Release Notes - TurboQuant Milestone (v1.14.0-RC)

This release introduces **TurboQuant** support, enabling extreme context sizes on mobile devices by significantly reducing KV cache memory consumption.

## Key Features

### 1. TurboQuant KV Cache Optimization
- **Extreme Context Scaling**: Verified up to **768k context** on Qwen 4B (Snapdragon 8 Elite).
- **Memory Efficiency**: ~4-8x reduction in KV cache footprint compared to f16.
- **Hardware Profile**: New "Long Context" profile added for Snapdragon 8 Elite (Gen 4).

### 2. Stability & Guardrails
- **Native Stall Watchdog**: Real-time monitoring of llama context initialization. Both shell-side and app-side watchdogs included to recover from native hangs.
- **CPU Fallback**: Automatic redirection to CPU when TurboQuant is used on Android with GPU backends (currently required for stability).
- **UX Warnings**: In-app notifications in Settings when unstable configurations (TurboQuant + OpenCL) are attempted.

## Validated Limits (iQOO13 / Snapdragon 8 Elite)
- **Stable Range**: <= 768,432 tokens (Qwen 4B / turbo4_0).
- **Unsupported**: 1,048,576 tokens (Triggers native stall/OOM).
- **Backends**: CPU recommended for all TurboQuant usage.

## Technical Improvements
- Integrated `cpp-turbo` parallel path in `llama.rn-upstream`.
- Updated `llama.rn` type definitions to support `turbo2_0`, `turbo3_0`, and `turbo4_0` cache types.
- Hardened benchmark automation for unattended high-context matrix runs.

---
*PocketPal AI - Local Intelligence, Unlimited Context.*
