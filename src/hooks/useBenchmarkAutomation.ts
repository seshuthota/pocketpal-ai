import {v4 as uuidv4} from 'uuid';
import RNDeviceInfo from 'react-native-device-info';

import {benchmarkStore, deepLinkStore, modelStore} from '../store';
import {ModelOrigin} from '../utils/types';
import {
  detectQuantizationType,
  getDefaultDeviceConfig,
  getDeviceOptions,
} from '../utils/deviceSelection';
import {inferBackendType} from '../utils/flashAttnCompatibility';
import {getHardwareProfile} from '../utils/hardwareProfiles';
import {
  getLatestBenchmarkAutomationStatusPath,
  writeBenchmarkAutomationStatus,
} from '../utils/benchmarkAutomation';

import type {
  BenchmarkAutomationCommand,
  BenchmarkAutomationStatus,
  BenchmarkResult,
  ContextInitParams,
  Model,
} from '../utils/types';

let runningCommandId: string | null = null;
const pendingCommands: BenchmarkAutomationCommand[] = [];
const pendingCommandIds = new Set<string>();
const AUTOMATION_MODEL_LOAD_TIMEOUT_MS = 180000;
const AUTOMATION_BENCH_TIMEOUT_MS = 420000;
const AUTOMATION_MIN_TIMEOUT_MS = 30000;

const cloneContextInitParams = (params: ContextInitParams): ContextInitParams =>
  JSON.parse(JSON.stringify(params));

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const getObservedBackend = async (): Promise<
  BenchmarkResult['selectedBackend']
> => {
  const inferredBackend = await inferBackendType(
    modelStore.activeContextSettings?.devices,
  );

  if (!modelStore.context?.gpu) {
    return 'cpu';
  }

  if (modelStore.context.devices?.some(device => device.startsWith('HTP'))) {
    return 'hexagon';
  }

  return inferredBackend;
};

const trackPeakMemoryUsage = async () => {
  try {
    const total = await RNDeviceInfo.getTotalMemory();
    const used = await RNDeviceInfo.getUsedMemory();
    const percentage = (used / total) * 100;
    return {total, used, percentage};
  } catch (error) {
    console.error('Failed to fetch memory stats:', error);
    return null;
  }
};

const resolveAutomationModel = (
  command: BenchmarkAutomationCommand,
  availableModels: Model[],
): Model | null => {
  const availableLocalModels = availableModels.filter(
    model => model.origin !== ModelOrigin.REMOTE,
  );

  const model = availableLocalModels.find(candidate => {
    if (command.modelId && candidate.id === command.modelId) {
      return true;
    }
    if (command.filename && candidate.filename === command.filename) {
      return true;
    }
    return false;
  });

  if (!model) {
    return null;
  }

  if (!model.isDownloaded) {
    throw new Error(`Benchmark model is not downloaded: ${model.name}`);
  }

  return model;
};

const waitForAutomationModel = async (
  command: BenchmarkAutomationCommand,
  timeoutMs = 15000,
): Promise<Model> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const model = resolveAutomationModel(command, modelStore.availableModels);
    if (model) {
      return model;
    }

    await sleep(250);
  }

  throw new Error(
    `Benchmark model not found: ${command.modelId || command.filename}`,
  );
};

const waitForModelStoreIdle = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!modelStore.isContextLoading) {
      return;
    }
    await sleep(250);
  }

  throw new Error('Timed out waiting for model store to become idle');
};

const resolveContextParamsForCommand = async (
  command: BenchmarkAutomationCommand,
  previousParams: ContextInitParams,
): Promise<ContextInitParams> => {
  const nextParams = cloneContextInitParams(previousParams);

  if (command.backend === 'auto') {
    const defaultConfig = await withTimeout(
      getDefaultDeviceConfig(),
      5000,
      'Timed out while resolving default device configuration',
    ).catch(error => {
      console.error('[BenchmarkAutomation] Falling back to CPU config:', error);
      return {
        devices: ['CPU'],
        n_gpu_layers: 0,
        default_flash_attn_type: 'off' as const,
      };
    });
    nextParams.devices = defaultConfig.devices;
    nextParams.n_gpu_layers = defaultConfig.n_gpu_layers;
    nextParams.flash_attn_type = defaultConfig.default_flash_attn_type;
    nextParams.no_gpu_devices =
      defaultConfig.n_gpu_layers === 0 &&
      (defaultConfig.devices?.length
        ? defaultConfig.devices.every(device => device === 'CPU')
        : true);
  } else {
    if (command.backend === 'cpu') {
      nextParams.devices = ['CPU'];
      nextParams.n_gpu_layers = 0;
      nextParams.flash_attn_type = 'off';
      nextParams.no_gpu_devices = true;

      if (command.overrides) {
        Object.assign(nextParams, command.overrides);
      }

      return nextParams;
    }

    const deviceOptions = await withTimeout(
      getDeviceOptions(),
      20000,
      'Timed out while reading available device options',
    );
    const optionId =
      command.backend === 'opencl'
        ? 'gpu'
        : command.backend === 'hexagon'
          ? 'hexagon'
          : command.backend === 'metal'
            ? 'gpu'
            : 'cpu';
    const option = deviceOptions.find(device => device.id === optionId);

    if (!option) {
      throw new Error(
        `Requested backend is not available on this device: ${command.backend}`,
      );
    }

    nextParams.devices = option.devices;
    nextParams.n_gpu_layers = option.n_gpu_layers;
    nextParams.flash_attn_type = option.default_flash_attn_type;
    nextParams.no_gpu_devices = option.id === 'cpu';
  }

  if (command.overrides) {
    Object.assign(nextParams, command.overrides);
  }

  return nextParams;
};

const publishAutomationStatus = (status: BenchmarkAutomationStatus) => {
  deepLinkStore.setLatestBenchmarkAutomationStatus(status);
  const outputPath =
    status.outputPath || getLatestBenchmarkAutomationStatusPath();

  console.error(
    `[BenchmarkAutomation] ${status.status} ${status.command.id} -> ${outputPath}`,
  );

  writeBenchmarkAutomationStatus(status).catch(error => {
    console.error('[BenchmarkAutomation] Failed to persist status:', error);
  });

  return outputPath;
};

const getBenchmarkTimeoutMs = (command: BenchmarkAutomationCommand) =>
  Math.max(
    command.timeout_ms ?? AUTOMATION_BENCH_TIMEOUT_MS,
    AUTOMATION_MIN_TIMEOUT_MS,
  );

const isCommandAlreadyKnown = (command: BenchmarkAutomationCommand) => {
  if (runningCommandId === command.id || pendingCommandIds.has(command.id)) {
    return true;
  }

  const latestStatus = deepLinkStore.latestBenchmarkAutomationStatus;
  if (latestStatus?.command.id !== command.id) {
    return false;
  }

  return latestStatus.status !== 'queued';
};

const drainNextBenchmarkAutomationCommand = () => {
  const nextCommand = pendingCommands.shift();
  if (!nextCommand) {
    return;
  }

  pendingCommandIds.delete(nextCommand.id);
  executeBenchmarkAutomationCommand(nextCommand).catch(error => {
    console.error(
      '[BenchmarkAutomation] Failed to run queued benchmark command:',
      error,
    );
  });
};

const executeBenchmarkAutomationCommand = async (
  command: BenchmarkAutomationCommand,
) => {
  if (runningCommandId === command.id) {
    console.error(
      `[BenchmarkAutomation] Ignoring duplicate command: ${command.id}`,
    );
    return;
  }

  console.error(
    `[BenchmarkAutomation] Starting command: ${command.id} (backend=${command.backend})`,
  );

  runningCommandId = command.id;
  deepLinkStore.setPendingBenchmarkCommand(command);
  const previousParams = cloneContextInitParams(modelStore.contextInitParams);
  let memoryCheckInterval: ReturnType<typeof setInterval> | undefined;

  try {
    console.error(
      `[BenchmarkAutomation] Waiting for model store idle: ${command.id}`,
    );
    await waitForModelStoreIdle();

    console.error(
      `[BenchmarkAutomation] Resolving model for command: ${command.id}`,
    );
    const model = await waitForAutomationModel(command);
    console.error(
      `[BenchmarkAutomation] Model resolved for ${command.id}: ${model.filename}`,
    );

    publishAutomationStatus({
      status: 'running',
      command,
      timestamp: new Date().toISOString(),
    });

    const nextParams = await resolveContextParamsForCommand(
      command,
      previousParams,
    );
    console.error(
      `[BenchmarkAutomation] Context params resolved for ${command.id}`,
    );
    modelStore.replaceContextInitParams(nextParams);
    if (modelStore.context) {
      console.error(
        `[BenchmarkAutomation] Releasing existing context before loading ${command.id}`,
      );
      await modelStore.releaseContext();
    }
    await withTimeout(
      modelStore.selectModel(model),
      AUTOMATION_MODEL_LOAD_TIMEOUT_MS,
      `Timed out while loading model for benchmark: ${command.id}`,
    );
    console.error(
      `[BenchmarkAutomation] Model selected for ${command.id}: ${model.name}`,
    );

    if (!modelStore.context || !modelStore.activeModel) {
      throw new Error('Benchmark model failed to initialize');
    }

    let peakMemoryUsage: NonNullable<
      BenchmarkResult['peakMemoryUsage']
    > | null = null;
    const startTime = Date.now();

    memoryCheckInterval = setInterval(async () => {
      const currentUsage = await trackPeakMemoryUsage();
      if (
        currentUsage &&
        (!peakMemoryUsage ||
          currentUsage.percentage > peakMemoryUsage.percentage)
      ) {
        peakMemoryUsage = currentUsage;
      }
    }, 1000);

    const {speedPp: ppAvg, speedTg: tgAvg} = await withTimeout(
      modelStore.context.bench(
        command.config.pp,
        command.config.tg,
        command.config.pl,
        command.config.nr,
      ),
      getBenchmarkTimeoutMs(command),
      `Timed out while running benchmark: ${command.id}`,
    );
    console.error(
      `[BenchmarkAutomation] Bench finished for ${command.id}: pp=${ppAvg}, tg=${tgAvg}`,
    );

    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
      memoryCheckInterval = undefined;
    }

    const [selectedBackend, hardwareProfile] = await Promise.all([
      getObservedBackend(),
      getHardwareProfile(),
    ]);

    const result: BenchmarkResult = {
      config: command.config,
      modelDesc: modelStore.context.model.desc,
      modelSize: modelStore.context.model.size,
      modelNParams: modelStore.context.model.nParams,
      ppAvg,
      ppStd: 0,
      tgAvg,
      tgStd: 0,
      timestamp: new Date().toISOString(),
      modelId: modelStore.activeModel.id,
      modelName: modelStore.activeModel.name,
      oid: modelStore.activeModel.hfModelFile?.oid,
      rfilename: modelStore.activeModel.hfModelFile?.rfilename,
      filename: modelStore.activeModel.filename,
      peakMemoryUsage: peakMemoryUsage || undefined,
      wallTimeMs: Date.now() - startTime,
      uuid: uuidv4(),
      initSettings: modelStore.activeContextSettings,
      selectedBackend,
      requestedBackend: command.backend,
      hardwareProfileId: hardwareProfile?.id,
      hardwareProfileLabel: hardwareProfile?.label,
      modelQuantization:
        detectQuantizationType(modelStore.activeModel.filename) || undefined,
      routingMode: command.backend === 'auto' ? 'auto' : 'manual',
      runtimeGpu: modelStore.context.gpu,
      runtimeReasonNoGPU: modelStore.context.reasonNoGPU || undefined,
      runtimeDevices: modelStore.context.devices || undefined,
      debugAutomationCommandId: command.id,
    };

    benchmarkStore.addResult(result);
    const outputPath = publishAutomationStatus({
      status: 'succeeded',
      command,
      timestamp: new Date().toISOString(),
      result,
    });

    console.error(
      `[BenchmarkAutomation] Latest status path: ${
        outputPath || getLatestBenchmarkAutomationStatusPath()
      }`,
    );
  } catch (error) {
    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
    }

    const message =
      error instanceof Error ? error.message : 'Unknown benchmark error';
    console.error('[BenchmarkAutomation] Failed:', message);

    if (
      message.includes('Timed out while loading model') ||
      message.includes('Timed out while running benchmark')
    ) {
      try {
        await modelStore.releaseContext();
      } catch (releaseError) {
        console.error(
          '[BenchmarkAutomation] Failed to release context after timeout:',
          releaseError,
        );
      }
    }

    publishAutomationStatus({
      status: 'failed',
      command,
      timestamp: new Date().toISOString(),
      error: message,
    });
  } finally {
    modelStore.replaceContextInitParams(previousParams);
    deepLinkStore.clearPendingBenchmarkCommand();
    runningCommandId = null;
    drainNextBenchmarkAutomationCommand();
  }
};

export const runBenchmarkAutomationCommand = async (
  command: BenchmarkAutomationCommand,
) => {
  if (isCommandAlreadyKnown(command)) {
    console.error(
      `[BenchmarkAutomation] Ignoring duplicate or already-known command: ${command.id}`,
    );
    return;
  }

  if (runningCommandId) {
    pendingCommands.push(command);
    pendingCommandIds.add(command.id);
    console.error(
      `[BenchmarkAutomation] Queued command behind active run: ${command.id} (active=${runningCommandId})`,
    );
    return;
  }

  await executeBenchmarkAutomationCommand(command);
};

/**
 * Background monitor to detect and resolve hard stalls where the automation
 * might be stuck in a 'running' state without progressing.
 */
export const monitorAutomationStalls = () => {
  const STALL_TIMEOUT_MS = 900000; // 15 minutes (absolute max for all phases)
  
  const latestStatus = deepLinkStore.latestBenchmarkAutomationStatus;
  if (!latestStatus || latestStatus.status !== 'running') {
    return;
  }

  const startTime = new Date(latestStatus.timestamp).getTime();
  const now = Date.now();

  if (now - startTime > STALL_TIMEOUT_MS) {
    console.error(
      `[BenchmarkAutomation] Hard stall detected for ${latestStatus.command.id}. Forcing failure.`,
    );
    
    publishAutomationStatus({
      ...latestStatus,
      status: 'failed',
      error: 'HARD_NATIVE_STALL_DETECTED (App-side watchdog)',
      timestamp: new Date().toISOString(),
    });

    // Attempt to reset state
    runningCommandId = null;
    deepLinkStore.clearPendingBenchmarkCommand();
    drainNextBenchmarkAutomationCommand();
  }
};
