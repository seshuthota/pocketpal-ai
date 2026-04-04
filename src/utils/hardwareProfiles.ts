import {Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {getBackendDevicesInfo} from 'llama.rn';

import NativeHardwareInfo from '../specs/NativeHardwareInfo';
import {checkGpuSupport} from './deviceCapabilities';
import type {ContextInitParams, Model} from './types';

export type HardwareProfileId = 'snapdragon-8-elite-adreno';

export interface HardwareProfile {
  id: HardwareProfileId;
  label: string;
  preferredBackend: 'opencl';
  preferredQuantizations: string[];
  socModels: string[];
}

export interface HardwareOptimizedDeviceConfig {
  profile: HardwareProfile;
  devices: string[];
  n_gpu_layers: number;
  default_flash_attn_type: 'off';
}

export interface HardwareRoutingDecision {
  backend: 'cpu' | 'opencl';
  devices: string[];
  n_gpu_layers: number;
  default_flash_attn_type: 'off';
  reason: string;
}

export type HardwareRuntimeProfileId = 'interactive' | 'throughput';

export interface HardwareRuntimeProfile {
  id: HardwareRuntimeProfileId | 'long-context';
  label: string;
  description: string;
  devices: string[];
  n_gpu_layers: number;
  flash_attn_type: 'off' | 'on' | 'auto';
  cache_type_k?: string;
  cache_type_v?: string;
  n_ctx?: number;
  n_batch: number;
  n_ubatch: number;
  n_threads: number;
}

const SNAPDRAGON_8_ELITE_ADRENO_PROFILE: HardwareProfile = {
  id: 'snapdragon-8-elite-adreno',
  label: 'Snapdragon 8 Elite (SM8750) / Adreno',
  preferredBackend: 'opencl',
  preferredQuantizations: ['q4_0', 'q6_k'],
  socModels: ['sm8750'],
};

let cachedHardwareProfilePromise: Promise<HardwareProfile | null> | null = null;
let cachedOptimizedConfigPromise: Promise<HardwareOptimizedDeviceConfig | null> | null =
  null;
const MIN_OPENCL_MODEL_PARAMS = 900_000_000;
const MAX_OPENCL_MODEL_PARAMS = 2_500_000_000;

function normalize(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function detectQuantizationType(filename?: string): string | null {
  const normalized = normalize(filename);

  const quantPatterns = [
    'f32',
    'f16',
    'q8_0',
    'q6_k',
    'q5_k_m',
    'q5_k_s',
    'q5_1',
    'q5_0',
    'q4_k_m',
    'q4_k_s',
    'q4_1',
    'q4_0',
    'q3_k_l',
    'q3_k_m',
    'q3_k_s',
    'q2_k',
    'iq4_nl',
  ];

  for (const pattern of quantPatterns) {
    if (normalized.includes(pattern)) {
      return pattern;
    }
  }

  return null;
}

function inferModelParamsFromFilename(filename?: string): number | null {
  const normalized = normalize(filename);
  if (!normalized) {
    return null;
  }

  const billionMatch = normalized.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (billionMatch?.[1]) {
    return Math.round(parseFloat(billionMatch[1]) * 1_000_000_000);
  }

  const millionMatch = normalized.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (millionMatch?.[1]) {
    return Math.round(parseFloat(millionMatch[1]) * 1_000_000);
  }

  return null;
}

export function isQuantizationRecommendedForHardwareProfile(
  filename: string,
  profile?: HardwareProfile | null,
): boolean {
  if (!profile) {
    return false;
  }

  const quantization = detectQuantizationType(filename);

  return (
    !!quantization && profile.preferredQuantizations.includes(quantization)
  );
}

async function detectAndroidHardwareProfile(): Promise<HardwareProfile | null> {
  try {
    const [cpuInfo, gpuInfo, chipset] = await Promise.all([
      NativeHardwareInfo.getCPUInfo(),
      NativeHardwareInfo.getGPUInfo(),
      NativeHardwareInfo.getChipset?.(),
    ]);

    const candidates = [
      cpuInfo?.socModel,
      chipset,
      DeviceInfo.getDeviceId(),
      DeviceInfo.getModel(),
      DeviceInfo.getBrand(),
    ].map(normalize);

    const hasMatchingSoc = SNAPDRAGON_8_ELITE_ADRENO_PROFILE.socModels.some(
      socModel => candidates.some(candidate => candidate.includes(socModel)),
    );

    if (hasMatchingSoc && gpuInfo?.hasAdreno) {
      return SNAPDRAGON_8_ELITE_ADRENO_PROFILE;
    }
  } catch (error) {
    console.warn('Failed to detect Android hardware profile:', error);
  }

  return null;
}

export async function getHardwareProfile(): Promise<HardwareProfile | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  if (!cachedHardwareProfilePromise) {
    cachedHardwareProfilePromise = detectAndroidHardwareProfile();
  }

  return cachedHardwareProfilePromise;
}

export async function getHardwareOptimizedDeviceConfig(): Promise<HardwareOptimizedDeviceConfig | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  if (!cachedOptimizedConfigPromise) {
    cachedOptimizedConfigPromise = (async () => {
      try {
        const [profile, gpuCapabilities, availableDevices] = await Promise.all([
          getHardwareProfile(),
          checkGpuSupport(),
          getBackendDevicesInfo(),
        ]);

        if (!profile) {
          return null;
        }

        const gpuDevice = availableDevices.find(
          device => device.type === 'gpu' && device.deviceName,
        );

        if (!gpuDevice?.deviceName) {
          return null;
        }

        if (!gpuCapabilities.isSupported) {
          console.warn(
            '[HardwareProfiles] GPU capability probe reported unsupported, but OpenCL device is present; using OpenCL profile.',
          );
        }

        return {
          profile,
          devices: [gpuDevice.deviceName],
          n_gpu_layers: 99,
          default_flash_attn_type: 'off',
        };
      } catch (error) {
        console.warn('Failed to resolve optimized device config:', error);
        return null;
      }
    })();
  }

  const config = await cachedOptimizedConfigPromise;
  if (!config) {
    cachedOptimizedConfigPromise = null;
  }

  return config;
}

export function shouldApplyHardwareProfileDefaults(
  params: Pick<
    ContextInitParams,
    'devices' | 'n_gpu_layers' | 'flash_attn_type' | 'no_gpu_devices'
  >,
): boolean {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (params.no_gpu_devices === true) {
    return false;
  }

  const devices = params.devices;
  const usesCpuOnly =
    !devices ||
    devices.length === 0 ||
    devices.every(device => device === 'CPU');
  const gpuLayers = params.n_gpu_layers ?? 0;
  const flashAttnType = params.flash_attn_type ?? 'off';

  return usesCpuOnly && gpuLayers === 0 && flashAttnType === 'off';
}

export function shouldAutoRouteHardwareProfile(
  params: Pick<
    ContextInitParams,
    'devices' | 'n_gpu_layers' | 'flash_attn_type' | 'no_gpu_devices'
  >,
  optimizedConfig?: HardwareOptimizedDeviceConfig | null,
): boolean {
  if (shouldApplyHardwareProfileDefaults(params)) {
    return true;
  }

  if (!optimizedConfig) {
    return false;
  }

  const devices = params.devices ?? [];
  const matchesOptimizedDevices =
    devices.length === optimizedConfig.devices.length &&
    devices.every((device, index) => device === optimizedConfig.devices[index]);

  return (
    matchesOptimizedDevices &&
    (params.n_gpu_layers ?? 0) === optimizedConfig.n_gpu_layers &&
    (params.flash_attn_type ?? 'off') ===
      optimizedConfig.default_flash_attn_type
  );
}

export function getHardwareRoutingDecisionForModel(
  model: Pick<Model, 'filename' | 'params' | 'size'>,
  optimizedConfig: HardwareOptimizedDeviceConfig,
): HardwareRoutingDecision {
  const quantization = detectQuantizationType(model.filename);
  const normalizedQuantization = normalize(quantization);
  const hasPreferredQuantization =
    !!normalizedQuantization &&
    optimizedConfig.profile.preferredQuantizations.includes(
      normalizedQuantization,
    );
  const inferredParams = inferModelParamsFromFilename(model.filename);
  const modelParams = model.params || inferredParams || 0;

  if (!hasPreferredQuantization) {
    return {
      backend: 'cpu',
      devices: ['CPU'],
      n_gpu_layers: 0,
      default_flash_attn_type: 'off',
      reason: `quantization ${quantization ?? 'unknown'} is not tuned for OpenCL`,
    };
  }

  if (modelParams > 0 && modelParams < MIN_OPENCL_MODEL_PARAMS) {
    return {
      backend: 'cpu',
      devices: ['CPU'],
      n_gpu_layers: 0,
      default_flash_attn_type: 'off',
      reason: `model is below ${MIN_OPENCL_MODEL_PARAMS} params and decodes faster on CPU`,
    };
  }

  if (modelParams > MAX_OPENCL_MODEL_PARAMS) {
    return {
      backend: 'cpu',
      devices: ['CPU'],
      n_gpu_layers: 0,
      default_flash_attn_type: 'off',
      reason: `model exceeds the current OpenCL tuning window on this device`,
    };
  }

  return {
    backend: 'opencl',
    devices: optimizedConfig.devices,
    n_gpu_layers: optimizedConfig.n_gpu_layers,
    default_flash_attn_type: optimizedConfig.default_flash_attn_type,
    reason: `preferred ${normalizedQuantization.toUpperCase()} model fits the Snapdragon 8 Elite OpenCL tuning window`,
  };
}

export function getHardwareRuntimeProfiles(
  optimizedConfig: HardwareOptimizedDeviceConfig,
): HardwareRuntimeProfile[] {
  if (optimizedConfig.profile.id !== 'snapdragon-8-elite-adreno') {
    return [];
  }

  return [
    {
      id: 'interactive',
      label: 'Interactive',
      description: 'CPU-first profile tuned for stable token generation.',
      devices: ['CPU'],
      n_gpu_layers: 0,
      flash_attn_type: 'off',
      cache_type_k: 'f16',
      cache_type_v: 'f16',
      n_ctx: 8192,
      n_batch: 128,
      n_ubatch: 64,
      n_threads: 6,
    },
    {
      id: 'throughput',
      label: 'Throughput',
      description: 'OpenCL profile tuned for prompt processing on Adreno.',
      devices: optimizedConfig.devices,
      n_gpu_layers: optimizedConfig.n_gpu_layers,
      flash_attn_type: optimizedConfig.default_flash_attn_type,
      n_batch: 128,
      n_ubatch: 64,
      n_threads: 6,
    },
    {
      id: 'long-context',
      label: 'Long Context',
      description: 'CPU TurboQuant profile for extreme context sizes.',
      devices: ['CPU'],
      n_gpu_layers: 0,
      flash_attn_type: 'on',
      cache_type_k: 'turbo4_0',
      cache_type_v: 'turbo4_0',
      n_ctx: 65536,
      n_batch: 128,
      n_ubatch: 64,
      n_threads: 6,
    },
  ];
}

export function getMatchingHardwareRuntimeProfile(
  params: Pick<
    ContextInitParams,
    | 'devices'
    | 'n_gpu_layers'
    | 'flash_attn_type'
    | 'cache_type_k'
    | 'cache_type_v'
    | 'n_ctx'
    | 'n_batch'
    | 'n_ubatch'
    | 'n_threads'
  >,
  runtimeProfiles: HardwareRuntimeProfile[],
): HardwareRuntimeProfileId | 'long-context' | null {
  const devices = params.devices ?? ['CPU'];

  const match = runtimeProfiles.find(profile => {
    const sameDevices =
      profile.devices.length === devices.length &&
      profile.devices.every((device, index) => device === devices[index]);

    return (
      sameDevices &&
      (params.n_gpu_layers ?? 0) === profile.n_gpu_layers &&
      (params.flash_attn_type ?? 'off') === profile.flash_attn_type &&
      params.cache_type_k === profile.cache_type_k &&
      params.cache_type_v === profile.cache_type_v &&
      (profile.n_ctx === undefined || params.n_ctx === profile.n_ctx) &&
      params.n_batch === profile.n_batch &&
      params.n_ubatch === profile.n_ubatch &&
      params.n_threads === profile.n_threads
    );
  });

  return (match?.id as HardwareRuntimeProfileId | 'long-context') ?? null;
}

export function applyHardwareRuntimeProfile(
  baseParams: ContextInitParams,
  runtimeProfile: HardwareRuntimeProfile,
): ContextInitParams {
  return {
    ...baseParams,
    devices: runtimeProfile.devices,
    n_gpu_layers: runtimeProfile.n_gpu_layers,
    flash_attn_type: runtimeProfile.flash_attn_type,
    cache_type_k: runtimeProfile.cache_type_k,
    cache_type_v: runtimeProfile.cache_type_v,
    n_ctx: runtimeProfile.n_ctx ?? baseParams.n_ctx,
    n_batch: runtimeProfile.n_batch,
    n_ubatch: runtimeProfile.n_ubatch,
    n_threads: runtimeProfile.n_threads,
    no_gpu_devices: runtimeProfile.n_gpu_layers === 0,
  };
}

export function resetHardwareProfileCacheForTests() {
  cachedHardwareProfilePromise = null;
  cachedOptimizedConfigPromise = null;
}
