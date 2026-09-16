import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PipelineHandle, createPipeline } from './pipeline';
import { resetDeviceDetection } from './device-detection';
import {
  TextClassifier,
  createTextClassifier,
  DEFAULT_TEXT_CLASSIFICATION_MODEL,
} from './text-classifier';
import { TextEmbedder, cosineSimilarity, createTextEmbedder } from './text-embedder';
import { ModelProgressComponent } from './model-progress.component';
import {
  NGX_TRANSFORMERS_CONFIG,
  PIPELINE_FACTORY,
  provideTransformers,
  type PipelineFactory,
  type PipelineLike,
} from './transformers.providers';
import type { ModelProgress, PipelineStatus } from './transformers.models';

/** Mock factory capturing calls; resolves to a stub pipeline. */
function mockFactory(
  impl?: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>,
) {
  const calls: { task: string; model?: string; options: Record<string, unknown> }[] = [];
  const runCalls: { input: unknown; options?: Record<string, unknown> }[] = [];
  let disposed = 0;
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, model, options });
    const pipe = (async (input: unknown, options?: Record<string, unknown>) => {
      runCalls.push({ input, options });
      return impl ? impl(input, options) : [];
    }) as PipelineLike;
    pipe.dispose = async () => {
      disposed++;
    };
    return pipe;
  };
  return { factory, calls, runCalls, disposed: () => disposed };
}

function handleWith<TIn, TOut>(
  factory: PipelineFactory,
  request = { task: 'text-classification' as const },
  config = {},
): PipelineHandle<TIn, TOut> {
  return new PipelineHandle<TIn, TOut>(request, factory, config);
}

describe('PipelineHandle', () => {
  it('starts idle and free of side effects', () => {
    const { factory, calls } = mockFactory();
    const handle = handleWith(factory);
    expect(handle.status()).toBe('idle');
    expect(handle.ready()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('load() transitions idle -> loading -> ready', async () => {
    const { factory } = mockFactory();
    const handle = handleWith(factory);
    const statuses: PipelineStatus[] = [];
    const loading = handle.load();
    statuses.push(handle.status());
    await loading;
    statuses.push(handle.status());
    expect(statuses).toEqual(['loading', 'ready']);
    expect(handle.ready()).toBe(true);
  });

  it('load() is idempotent - one factory call for concurrent loads', async () => {
    const { factory, calls } = mockFactory();
    const handle = handleWith(factory);
    await Promise.all([handle.load(), handle.load(), handle.load()]);
    await handle.load();
    expect(calls).toHaveLength(1);
  });

  it('run() lazy-loads, passes input, and returns the output', async () => {
    const { factory, runCalls } = mockFactory(async (input) => [
      { label: 'POSITIVE', score: 0.9, input },
    ]);
    const handle = handleWith<string, unknown[]>(factory);
    const out = await handle.run('hello', { top_k: 2 });
    expect(handle.status()).toBe('ready');
    expect(runCalls).toEqual([{ input: 'hello', options: { top_k: 2 } }]);
    expect(out).toHaveLength(1);
  });

  it('a failing run keeps the model ready and rethrows', async () => {
    const { factory } = mockFactory(async () => {
      throw new Error('boom');
    });
    const handle = handleWith(factory);
    await expect(handle.run('x')).rejects.toThrow('boom');
    expect(handle.status()).toBe('ready');
    expect(handle.error()).toBeNull();
  });

  it('a failing load sets error status and allows retry', async () => {
    let attempts = 0;
    const failing: PipelineFactory = async (task, model, options) => {
      attempts++;
      if (attempts === 1) throw new Error('offline');
      return mockFactory().factory(task, model, options);
    };
    const handle = handleWith(failing);
    await expect(handle.load()).rejects.toThrow('offline');
    expect(handle.status()).toBe('error');
    expect(String(handle.error())).toContain('offline');
    await handle.load();
    expect(handle.status()).toBe('ready');
    expect(handle.error()).toBeNull();
  });

  it('maps progress_callback events into the progress signal', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const factory: PipelineFactory = async (_task, _model, options) => {
      capturedOptions = options;
      return (async () => []) as PipelineLike;
    };
    const handle = handleWith(factory);
    const seen: (ModelProgress | null)[] = [];
    const originalSet = handle.progress.set.bind(handle.progress);
    handle.progress.set = (v) => {
      seen.push(v);
      originalSet(v);
    };
    const loading = handle.load();
    // factory resolves on microtask; wait for options capture
    await loading;
    const cb = capturedOptions['progress_callback'] as (e: unknown) => void;
    expect(typeof cb).toBe('function');
    cb({ status: 'initiate', file: 'model.onnx' });
    cb({ status: 'progress', file: 'model.onnx', progress: 41.7, loaded: 41, total: 100 });
    expect(seen.filter(Boolean).at(-1)).toEqual({
      file: 'model.onnx',
      progress: 42,
      loadedBytes: 41,
      totalBytes: 100,
      overall: { progress: 41, loadedBytes: 41, totalBytes: 100, files: 1, filesDone: 0 },
    });
    cb({ status: 'done', file: 'model.onnx' });
    expect(seen.filter(Boolean).at(-1)).toEqual({
      file: 'model.onnx',
      progress: 100,
      loadedBytes: 100,
      totalBytes: 100,
      overall: { progress: 100, loadedBytes: 100, totalBytes: 100, files: 1, filesDone: 1 },
    });
  });

  it('sums progress over every file the model downloads in parallel', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const factory: PipelineFactory = async (_task, _model, options) => {
      capturedOptions = options;
      return (async () => []) as PipelineLike;
    };
    const handle = handleWith(factory);
    await handle.load();
    const cb = capturedOptions['progress_callback'] as (e: unknown) => void;
    cb({ status: 'progress', file: 'config.json', progress: 100, loaded: 10, total: 10 });
    cb({ status: 'done', file: 'config.json' });
    cb({ status: 'progress', file: 'onnx/model.onnx', progress: 25, loaded: 100, total: 400 });
    cb({ status: 'progress', file: 'tokenizer.json', progress: 50, loaded: 45, total: 90 });
    // The signal names the file reported last but the total covers all three.
    expect(handle.progress()).toEqual({
      file: 'tokenizer.json',
      progress: 50,
      loadedBytes: 45,
      totalBytes: 90,
      overall: { progress: 31, loadedBytes: 155, totalBytes: 500, files: 3, filesDone: 1 },
    });
    cb({ status: 'ready' }); // no file: ignored
    expect(handle.progress()?.file).toBe('tokenizer.json');
  });

  it('withholds the total until the weights file is known, and ignores initiate/download', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const factory: PipelineFactory = async (_task, _model, options) => {
      capturedOptions = options;
      return (async () => []) as PipelineLike;
    };
    const handle = handleWith(factory);
    await handle.load();
    const cb = capturedOptions['progress_callback'] as (e: unknown) => void;
    cb({ status: 'progress', file: 'config.json', progress: 100, loaded: 10, total: 10 });
    cb({ status: 'done', file: 'config.json' });
    // the small files alone would read 100%: no overall yet
    expect(handle.progress()).toEqual({
      file: 'config.json',
      progress: 100,
      loadedBytes: 10,
      totalBytes: 10,
    });
    cb({ status: 'initiate', file: 'onnx/model_quantized.onnx' });
    cb({ status: 'download', file: 'onnx/model_quantized.onnx' });
    // recorded, but a file that has not moved does not replace the signal
    expect(handle.progress()?.file).toBe('config.json');
    cb({
      status: 'progress',
      file: 'onnx/model_quantized.onnx',
      progress: 10,
      loaded: 100,
      total: 1000,
    });
    expect(handle.progress()?.overall).toEqual({
      progress: 11,
      loadedBytes: 110,
      totalBytes: 1010,
      files: 2,
      filesDone: 1,
    });
  });

  it('a retried load starts its progress from scratch', async () => {
    let attempt = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const factory: PipelineFactory = async (_task, _model, options) => {
      const cb = options['progress_callback'] as (e: unknown) => void;
      if (++attempt === 1) {
        cb({ status: 'progress', file: 'config.json', progress: 100, loaded: 10, total: 10 });
        cb({ status: 'done', file: 'config.json' });
        cb({ status: 'progress', file: 'onnx/model.onnx', progress: 80, loaded: 80, total: 100 });
        throw new Error('network');
      }
      cb({ status: 'progress', file: 'onnx/model.onnx', progress: 10, loaded: 10, total: 100 });
      await gate; // keep the retry in flight so its progress can be inspected
      return (async () => []) as PipelineLike;
    };
    const handle = handleWith(factory);
    await expect(handle.load()).rejects.toThrow('network');
    expect(handle.status()).toBe('error');
    expect(handle.progress()).toBeNull();
    const loading = handle.load();
    await vi.waitFor(() => expect(handle.progress()).not.toBeNull());
    // the failed attempt's config.json and 80 bytes are gone
    expect(handle.progress()?.overall).toEqual({
      progress: 10,
      loadedBytes: 10,
      totalBytes: 100,
      files: 1,
      filesDone: 0,
    });
    release();
    await loading;
    expect(handle.status()).toBe('ready');
  });

  it('only the most recently started run writes runError', async () => {
    const settle: ((outcome: 'ok' | 'fail') => void)[] = [];
    const { factory } = mockFactory(
      () =>
        new Promise<string>((resolve, reject) =>
          settle.push((outcome) => (outcome === 'ok' ? resolve('ok') : reject(new Error('boom')))),
        ),
    );
    const handle = handleWith(factory);
    const first = handle.run('a');
    const second = handle.run('b');
    await vi.waitFor(() => expect(settle).toHaveLength(2));
    settle[0]('fail'); // the superseded run fails
    await expect(first).rejects.toThrow('boom');
    expect(handle.runError()).toBeNull();
    settle[1]('ok');
    await second;
    expect(handle.runError()).toBeNull();
  });

  it('a run whose signal already fired rejects with AbortError instead of running', async () => {
    const mocks = mockFactory();
    const handle = handleWith(mocks.factory);
    const controller = new AbortController();
    controller.abort();
    await expect(handle.run('x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mocks.runCalls).toHaveLength(0);
    expect(handle.status()).toBe('ready'); // the model loaded and is intact
    // a live signal is stripped from the pipeline options and the run proceeds
    const live = new AbortController();
    await handle.run('y', { signal: live.signal, top_k: 2 });
    expect(mocks.runCalls[0].options).toEqual({ top_k: 2 });
  });

  it('exposes a failed run in runError and clears it on the next run', async () => {
    let fail = true;
    const { factory } = mockFactory(async () => {
      if (fail) throw new Error('bad input');
      return ['ok'];
    });
    const handle = handleWith(factory);
    await expect(handle.run('x')).rejects.toThrow('bad input');
    expect((handle.runError() as Error).message).toBe('bad input');
    expect(handle.error()).toBeNull();
    expect(handle.status()).toBe('ready');
    fail = false;
    await handle.run('y');
    expect(handle.runError()).toBeNull();
  });

  it('forwards device/dtype with request overriding global config', async () => {
    const { factory, calls } = mockFactory();
    const handle = new PipelineHandle({ task: 't', model: 'm', dtype: 'q4' }, factory, {
      device: 'webgpu',
      dtype: 'q8',
      pipelineOptions: { cache_dir: '/tmp' },
    });
    await handle.load();
    expect(calls[0].options['device']).toBe('webgpu');
    expect(calls[0].options['dtype']).toBe('q4');
    expect(calls[0].options['cache_dir']).toBe('/tmp');
  });

  it("omits device when it resolves to 'auto'", async () => {
    const { factory, calls } = mockFactory();
    const handle = new PipelineHandle({ task: 't', device: 'auto' }, factory, {});
    await handle.load();
    expect('device' in calls[0].options).toBe(false);
  });

  it('dispose() frees the pipe and resets to idle; load() works again', async () => {
    const mocks = mockFactory();
    const handle = handleWith(mocks.factory);
    await handle.load();
    await handle.dispose();
    expect(handle.status()).toBe('idle');
    expect(mocks.disposed()).toBe(1);
    await handle.load();
    expect(handle.status()).toBe('ready');
    expect(mocks.calls).toHaveLength(2);
  });
});

describe('createPipeline / DI wiring', () => {
  it('uses the injected factory and global config', async () => {
    const { factory, calls } = mockFactory();
    TestBed.configureTestingModule({
      providers: [
        { provide: PIPELINE_FACTORY, useValue: factory },
        provideTransformers({ dtype: 'q8' }),
      ],
    });
    const handle = TestBed.runInInjectionContext(() => createPipeline({ task: 'summarization' }));
    await handle.load();
    expect(calls[0].task).toBe('summarization');
    expect(calls[0].options['dtype']).toBe('q8');
  });

  it('provideTransformers exposes the config through the token', () => {
    TestBed.configureTestingModule({ providers: [provideTransformers({ device: 'wasm' })] });
    expect(TestBed.inject(NGX_TRANSFORMERS_CONFIG)).toEqual({ device: 'wasm' });
  });

  it('disposes the handle when the component is destroyed', async () => {
    const { factory } = mockFactory();

    @Component({ template: '' })
    class HostComponent {
      readonly handle = createPipeline({ task: 't' });
    }

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    const handle = fixture.componentInstance.handle;
    await handle.load();
    fixture.destroy();
    // dispose is fire-and-forget on destroy - flush the microtask
    await Promise.resolve();
    expect(handle.status()).toBe('idle');
  });
});

describe('TextClassifier', () => {
  function classifierWith(output: unknown): TextClassifier {
    const { factory } = mockFactory(async () => output);
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    return TestBed.runInInjectionContext(() => createTextClassifier());
  }

  it('defaults to the SST-2 sentiment model', () => {
    const { factory, calls } = mockFactory();
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    const classifier = TestBed.runInInjectionContext(() => createTextClassifier());
    return classifier.load().then(() => {
      expect(calls[0].model).toBe(DEFAULT_TEXT_CLASSIFICATION_MODEL);
      expect(calls[0].task).toBe('text-classification');
    });
  });

  it('classify() sorts flat results by score', async () => {
    const classifier = classifierWith([
      { label: 'NEGATIVE', score: 0.1 },
      { label: 'POSITIVE', score: 0.9 },
    ]);
    const out = await classifier.classify('great stuff', 2);
    expect(out.map((r) => r.label)).toEqual(['POSITIVE', 'NEGATIVE']);
  });

  it('classify() forwards an abort signal to the run', async () => {
    const { factory, runCalls } = mockFactory(async () => [{ label: 'POSITIVE', score: 1 }]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    const classifier = TestBed.runInInjectionContext(() => createTextClassifier());
    const controller = new AbortController();
    controller.abort();
    await expect(classifier.classify('x', 1, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(runCalls).toHaveLength(0);
  });

  it('classify() unwraps nested batch results', async () => {
    const classifier = classifierWith([[{ label: 'POSITIVE', score: 0.8 }]]);
    const out = await classifier.classify('ok');
    expect(out).toEqual([{ label: 'POSITIVE', score: 0.8 }]);
  });
});

describe('TextEmbedder', () => {
  function embedderWith(output: unknown): {
    embedder: TextEmbedder;
    runCalls: { input: unknown; options?: Record<string, unknown> }[];
  } {
    const { factory, runCalls } = mockFactory(async () => output);
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    return { embedder: TestBed.runInInjectionContext(() => createTextEmbedder()), runCalls };
  }

  it('embed() requests mean pooling + normalization and reads tensor dims/data', async () => {
    const { embedder, runCalls } = embedderWith({
      dims: [2, 3],
      data: Float32Array.from([1, 0, 0, 0, 1, 0]),
    });
    const rows = await embedder.embed(['a', 'b']);
    expect(runCalls[0].options).toEqual({ pooling: 'mean', normalize: true });
    expect(rows).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('embed() prefers tolist() when available and wraps single strings', async () => {
    const { embedder, runCalls } = embedderWith({
      dims: [1, 2],
      data: [9, 9],
      tolist: () => [[0.5, 0.5]],
    });
    const rows = await embedder.embed('solo');
    expect(runCalls[0].input).toEqual(['solo']);
    expect(rows).toEqual([[0.5, 0.5]]);
  });

  it('embed([]) resolves without touching the model', async () => {
    const { embedder, runCalls } = embedderWith({ dims: [0, 0], data: [] });
    expect(await embedder.embed([])).toEqual([]);
    expect(runCalls).toHaveLength(0);
  });

  it('rank() orders documents by similarity to the query', async () => {
    // query = [1,0]; docs: opposite, identical, orthogonal
    const { embedder } = embedderWith({
      dims: [4, 2],
      data: Float32Array.from([1, 0, -1, 0, 1, 0, 0, 1]),
    });
    const ranked = await embedder.rank('q', ['opposite', 'same', 'orthogonal']);
    expect(ranked.map((r) => r.text)).toEqual(['same', 'orthogonal', 'opposite']);
    expect(ranked[0]).toEqual({ text: 'same', score: 1, index: 1 });
    expect(ranked.map((r) => r.index)).toEqual([1, 2, 0]);
  });

  it('rank() with no documents resolves to []', async () => {
    const { embedder, runCalls } = embedderWith({ dims: [1, 2], data: [1, 0] });
    expect(await embedder.rank('q', [])).toEqual([]);
    expect(runCalls).toHaveLength(0);
  });
});

describe('cosineSimilarity', () => {
  it('computes expected values', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('returns 0 for zero vectors and throws on length mismatch', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/incompatible lengths/);
    expect(() => cosineSimilarity([], [])).toThrow(/incompatible lengths/);
  });
});

describe('ModelProgressComponent', () => {
  function render(status: PipelineStatus, progress: ModelProgress | null = null) {
    @Component({
      imports: [ModelProgressComponent],
      template: `<ngx-model-progress [status]="status" [progress]="progress" />`,
    })
    class HostComponent {
      status = status;
      progress = progress;
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the default label per status', () => {
    expect(render('idle').textContent).toContain('Model not loaded');
  });

  it('shows file, bar, and percentage while loading', () => {
    const el = render('loading', {
      file: 'onnx/model_q8.onnx',
      progress: 63,
      loadedBytes: 63,
      totalBytes: 100,
    });
    expect(el.textContent).toContain('Downloading model');
    expect(el.textContent).toContain('onnx/model_q8.onnx');
    expect(el.textContent).toContain('63%');
    const bar = el.querySelector<HTMLElement>('.nt-fill')!;
    expect(bar.style.width).toBe('63%');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('63');
  });

  it('hides the bar outside of loading and marks errors', () => {
    const el = render('error');
    expect(el.querySelector('.nt-track')).toBeNull();
    expect(el.querySelector('.nt-error')).not.toBeNull();
    expect(el.textContent).toContain('Failed to load model');
  });

  it('drives the bar with the overall percentage when the handle reports it', () => {
    const fixture = TestBed.createComponent(ModelProgressComponent);
    fixture.componentRef.setInput('status', 'loading');
    fixture.componentRef.setInput('progress', {
      file: 'onnx/model.onnx',
      progress: 90,
      loadedBytes: 90,
      totalBytes: 100,
      overall: { progress: 30, loadedBytes: 300, totalBytes: 1000, files: 4, filesDone: 1 },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.nt-pct')?.textContent).toContain('30%');
    expect(el.querySelector('.nt-files')?.textContent).toContain('1/4 files');
    expect((el.querySelector('.nt-fill') as HTMLElement).style.width).toBe('30%');
  });

  it('honors custom labels', () => {
    @Component({
      imports: [ModelProgressComponent],
      template: `<ngx-model-progress status="ready" [labels]="{ ready: 'Bereit' }" />`,
    })
    class HostComponent {}
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Bereit');
  });
});

describe('PipelineHandle lifecycle races', () => {
  /** A factory whose pipe arrives only once release() is called (or never, after fail()). */
  function deferredFactory() {
    const inner = mockFactory();
    const options: Record<string, unknown>[] = [];
    let release!: () => void;
    let fail!: (err: unknown) => void;
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const factory: PipelineFactory = async (task, model, opts) => {
      options.push(opts);
      await gate;
      return inner.factory(task, model, opts);
    };
    return { factory, release, fail, options, calls: inner.calls, disposed: inner.disposed };
  }

  /** A pipe whose runs settle only when the test calls the matching resolver. */
  function manualRuns() {
    const finish: (() => void)[] = [];
    const mocks = mockFactory(() => new Promise<void>((resolve) => finish.push(resolve)));
    return { ...mocks, finish };
  }

  it('dispose() during load cancels it: the late model is freed and the handle stays idle', async () => {
    const mocks = deferredFactory();
    const handle = handleWith(mocks.factory);
    const loading = handle.load();
    expect(handle.status()).toBe('loading');
    await vi.waitFor(() => expect(mocks.options).toHaveLength(1)); // the download has started

    await handle.dispose();
    expect(handle.status()).toBe('idle');

    mocks.release();
    await loading;
    expect(handle.status()).toBe('idle');
    expect(handle.ready()).toBe(false);
    expect(mocks.disposed()).toBe(1);

    // and the handle is usable again afterwards
    await handle.load();
    expect(handle.status()).toBe('ready');
    expect(mocks.calls).toHaveLength(2);
  });

  it('a run() waiting on a cancelled load rejects instead of using a disposed handle', async () => {
    const mocks = deferredFactory();
    const handle = handleWith(mocks.factory);
    const run = handle.run('x');
    await handle.dispose();
    mocks.release();
    await expect(run).rejects.toThrow(/disposed/);
    expect(handle.status()).toBe('idle');
  });

  it('progress events from a cancelled load are ignored', async () => {
    const mocks = deferredFactory();
    const handle = handleWith(mocks.factory);
    const loading = handle.load();
    await vi.waitFor(() => expect(mocks.options).toHaveLength(1));
    const report = mocks.options[0]['progress_callback'] as (event: unknown) => void;
    report({ status: 'progress', file: 'a.onnx', progress: 10 });
    expect(handle.progress()?.progress).toBe(10);

    await handle.dispose();
    report({ status: 'progress', file: 'a.onnx', progress: 50 });
    expect(handle.progress()).toBeNull();

    mocks.release();
    await loading;
  });

  it('a load that fails after dispose() neither throws nor sets the error state', async () => {
    const mocks = deferredFactory();
    const handle = handleWith(mocks.factory);
    const loading = handle.load();
    await vi.waitFor(() => expect(mocks.options).toHaveLength(1));
    await handle.dispose();
    mocks.fail(new Error('network'));
    await expect(loading).resolves.toBeUndefined();
    expect(handle.status()).toBe('idle');
    expect(handle.error()).toBeNull();
  });

  it('dispose() during the device probe never starts the download', async () => {
    let releaseProbe!: () => void;
    const probe = new Promise<null>((resolve) => (releaseProbe = () => resolve(null)));
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => probe } });
    resetDeviceDetection();
    try {
      const mocks = mockFactory();
      const handle = handleWith(
        mocks.factory,
        { task: 'text-classification' },
        { autoDevice: true },
      );
      const loading = handle.load();
      expect(handle.status()).toBe('loading');
      await handle.dispose();
      releaseProbe();
      await loading;
      expect(mocks.calls).toHaveLength(0);
      expect(handle.status()).toBe('idle');
    } finally {
      vi.unstubAllGlobals();
      resetDeviceDetection();
    }
  });

  it('overlapping runs stay busy until the last one finishes', async () => {
    const { factory, finish } = manualRuns();
    const handle = handleWith(factory);
    const first = handle.run('a');
    const second = handle.run('b');
    await vi.waitFor(() => expect(finish).toHaveLength(2));

    finish[0]();
    await first;
    expect(handle.status()).toBe('busy');

    finish[1]();
    await second;
    expect(handle.status()).toBe('ready');
  });

  it('dispose() during a run leaves the handle idle once the run settles', async () => {
    const { factory, finish } = manualRuns();
    const handle = handleWith(factory);
    const run = handle.run('a');
    await vi.waitFor(() => expect(finish).toHaveLength(1));

    await handle.dispose();
    expect(handle.status()).toBe('idle');
    finish[0]();
    await run;
    expect(handle.status()).toBe('idle');
  });

  it('a run that outlived dispose() does not disturb the reloaded handle', async () => {
    const { factory, finish } = manualRuns();
    const handle = handleWith(factory);
    const orphan = handle.run('a');
    await vi.waitFor(() => expect(finish).toHaveLength(1));

    await handle.dispose();
    await handle.load();
    const first = handle.run('b');
    const second = handle.run('c');
    await vi.waitFor(() => expect(finish).toHaveLength(3));
    expect(handle.status()).toBe('busy');

    finish[0]();
    await orphan;
    expect(handle.status()).toBe('busy');

    finish[1]();
    await first;
    expect(handle.status()).toBe('busy'); // c is still running

    finish[2]();
    await second;
    expect(handle.status()).toBe('ready');
  });

  it('destroy() disposes and rejects later load() and run(); dispose() allows a reload', async () => {
    const mocks = mockFactory();
    const handle = handleWith(mocks.factory);
    await handle.load();
    await handle.destroy();
    expect(handle.status()).toBe('idle');
    expect(mocks.disposed()).toBe(1);
    await expect(handle.load()).rejects.toThrow(/destroyed/);
    await expect(handle.run('x')).rejects.toThrow(/destroyed/);
    expect(mocks.calls).toHaveLength(1);
  });

  it('a preload chained into run() cannot resurrect the model after destroy()', async () => {
    const mocks = deferredFactory();
    const handle = handleWith(mocks.factory);
    const chain = handle.load().then(() => handle.run('x'));
    await vi.waitFor(() => expect(mocks.options).toHaveLength(1));
    await handle.destroy();
    mocks.release();
    await expect(chain).rejects.toThrow(/destroyed/);
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.disposed()).toBe(1);
    expect(handle.status()).toBe('idle');
  });

  it('a handle created in a component is destroyed for good with it', async () => {
    const mocks = mockFactory();

    @Component({ template: '' })
    class HostComponent {
      readonly handle = createPipeline({ task: 't' });
    }

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: PIPELINE_FACTORY, useValue: mocks.factory }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    const handle = fixture.componentInstance.handle;
    await handle.load();
    fixture.destroy();
    await Promise.resolve();
    await expect(handle.run('x')).rejects.toThrow(/destroyed/);
    expect(mocks.calls).toHaveLength(1);
  });
});
