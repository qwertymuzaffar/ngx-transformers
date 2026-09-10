import { TestBed } from '@angular/core/testing';
import { detectDevice, hasWebGpu, resetDeviceDetection } from './device-detection';
import { PipelineHandle, createPipeline } from './pipeline';
import { PIPELINE_FACTORY, provideTransformers, type PipelineFactory, type PipelineLike } from './transformers.providers';

function recordingFactory() {
  const calls: { task: string; options: Record<string, unknown> }[] = [];
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, options });
    return (async () => []) as PipelineLike;
  };
  return { factory, calls };
}

/** Installs a fake navigator.gpu whose requestAdapter() resolves `adapter` or rejects. */
function stubGpu(adapter: unknown, behaviour: 'resolve' | 'reject' = 'resolve') {
  const requestAdapter = vi.fn(async () => {
    if (behaviour === 'reject') throw new Error('gpu unavailable');
    return adapter;
  });
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  return requestAdapter;
}

describe('hasWebGpu / detectDevice', () => {
  beforeEach(() => resetDeviceDetection());
  afterEach(() => vi.unstubAllGlobals());

  it('browser with a usable GPU: true / webgpu, probed once', async () => {
    const requestAdapter = stubGpu({ features: new Set() });
    expect(await hasWebGpu()).toBe(true);
    expect(await detectDevice()).toBe('webgpu');
    await hasWebGpu();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('browser without navigator.gpu: false / wasm', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });
    expect(await hasWebGpu()).toBe(false);
    expect(await detectDevice()).toBe('wasm');
  });

  it('navigator.gpu present but no adapter, or a rejecting request: false', async () => {
    stubGpu(null);
    expect(await hasWebGpu()).toBe(false);
    resetDeviceDetection();
    stubGpu(null, 'reject');
    expect(await detectDevice()).toBe('wasm');
  });

  it('server without a navigator at all: wasm', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(await hasWebGpu()).toBe(false);
    expect(await detectDevice()).toBe('wasm');
  });

  it('resetDeviceDetection() forgets the cached answer', async () => {
    vi.stubGlobal('navigator', {});
    expect(await hasWebGpu()).toBe(false);
    resetDeviceDetection();
    stubGpu({});
    expect(await hasWebGpu()).toBe(true);
  });
});

describe('autoDevice', () => {
  beforeEach(() => resetDeviceDetection());
  afterEach(() => vi.unstubAllGlobals());

  it('picks webgpu for handles without a device when a GPU is available', async () => {
    stubGpu({});
    const { factory, calls } = recordingFactory();
    await new PipelineHandle({ task: 'task' }, factory, { autoDevice: true }).load();
    expect(calls[0].options['device']).toBe('webgpu');
  });

  it('falls back to wasm without a GPU', async () => {
    vi.stubGlobal('navigator', {});
    const { factory, calls } = recordingFactory();
    await new PipelineHandle({ task: 'task' }, factory, { autoDevice: true }).load();
    expect(calls[0].options['device']).toBe('wasm');
  });

  it('an explicit device on the request or in the global config wins; "auto" defers to the probe', async () => {
    stubGpu({});
    const { factory, calls } = recordingFactory();
    await new PipelineHandle({ task: 'pinned-request', device: 'wasm' }, factory, { autoDevice: true }).load();
    await new PipelineHandle({ task: 'pinned-config' }, factory, { autoDevice: true, device: 'wasm' }).load();
    await new PipelineHandle({ task: 'auto-config' }, factory, { autoDevice: true, device: 'auto' }).load();
    expect(calls.map((call) => call.options['device'])).toEqual(['wasm', 'wasm', 'webgpu']);
  });

  it('without autoDevice an unset device is still omitted', async () => {
    stubGpu({});
    const { factory, calls } = recordingFactory();
    await new PipelineHandle({ task: 'task' }, factory, {}).load();
    expect('device' in calls[0].options).toBe(false);
  });

  it('provideTransformers({ autoDevice }) reaches every handle created in the injector, probing once', async () => {
    const requestAdapter = stubGpu({});
    const { factory, calls } = recordingFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }, provideTransformers({ autoDevice: true, dtype: 'q8' })],
    });
    const first = TestBed.runInInjectionContext(() => createPipeline({ task: 'first' }));
    const second = TestBed.runInInjectionContext(() => createPipeline({ task: 'second' }));
    await first.load();
    await second.load();
    expect(calls.map((call) => call.options['device'])).toEqual(['webgpu', 'webgpu']);
    expect(calls.map((call) => call.options['dtype'])).toEqual(['q8', 'q8']);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
