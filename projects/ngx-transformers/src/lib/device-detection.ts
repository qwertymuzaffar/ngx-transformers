/** The slice of navigator.gpu we probe; the WebGPU lib types are not in every project's tsconfig. */
interface GpuLike {
  requestAdapter(): Promise<unknown | null>;
}

let webGpuProbe: Promise<boolean> | null = null;

/**
 * Whether models can run on WebGPU here: `navigator.gpu` exists AND
 * `requestAdapter()` hands back an adapter - it returns null on machines
 * without a usable GPU or with WebGPU disabled, even when the API exists.
 * Resolves false on the server. The probe runs once and is cached.
 */
export function hasWebGpu(): Promise<boolean> {
  webGpuProbe ??= probeWebGpu();
  return webGpuProbe;
}

/** `'webgpu'` when hasWebGpu() resolves true, else `'wasm'`. */
export async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  return (await hasWebGpu()) ? 'webgpu' : 'wasm';
}

/** Forgets the cached probe so the next hasWebGpu() asks the browser again. */
export function resetDeviceDetection(): void {
  webGpuProbe = null;
}

async function probeWebGpu(): Promise<boolean> {
  const gpu = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}
