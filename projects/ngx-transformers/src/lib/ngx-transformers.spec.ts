import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PipelineHandle, createPipeline } from './pipeline';
import { TextClassifier, createTextClassifier, DEFAULT_TEXT_CLASSIFICATION_MODEL } from './text-classifier';
import { TextEmbedder, cosineSimilarity, createTextEmbedder } from './text-embedder';
import { ModelProgressComponent } from './model-progress.component';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY, provideTransformers, type PipelineFactory, type PipelineLike } from './transformers.providers';
import type { ModelProgress, PipelineStatus } from './transformers.models';

/** Mock factory capturing calls; resolves to a stub pipeline. */
function mockFactory(impl?: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>) {
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
    const { factory, runCalls } = mockFactory(async (input) => [{ label: 'POSITIVE', score: 0.9, input }]);
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
    cb({ status: 'done', file: 'model.onnx' });
    const last = seen.filter(Boolean).at(-1)!;
    expect(last).toEqual({ file: 'model.onnx', progress: 42, loadedBytes: 41, totalBytes: 100 });
  });

  it('forwards device/dtype with request overriding global config', async () => {
    const { factory, calls } = mockFactory();
    const handle = new PipelineHandle(
      { task: 't', model: 'm', dtype: 'q4' },
      factory,
      { device: 'webgpu', dtype: 'q8', pipelineOptions: { cache_dir: '/tmp' } },
    );
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
    TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
    return TestBed.runInInjectionContext(() => createTextClassifier());
  }

  it('defaults to the SST-2 sentiment model', () => {
    const { factory, calls } = mockFactory();
    TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
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

  it('classify() unwraps nested batch results', async () => {
    const classifier = classifierWith([[{ label: 'POSITIVE', score: 0.8 }]]);
    const out = await classifier.classify('ok');
    expect(out).toEqual([{ label: 'POSITIVE', score: 0.8 }]);
  });
});

describe('TextEmbedder', () => {
  function embedderWith(output: unknown): { embedder: TextEmbedder; runCalls: { input: unknown; options?: Record<string, unknown> }[] } {
    const { factory, runCalls } = mockFactory(async () => output);
    TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
    return { embedder: TestBed.runInInjectionContext(() => createTextEmbedder()), runCalls };
  }

  it('embed() requests mean pooling + normalization and reads tensor dims/data', async () => {
    const { embedder, runCalls } = embedderWith({ dims: [2, 3], data: Float32Array.from([1, 0, 0, 0, 1, 0]) });
    const rows = await embedder.embed(['a', 'b']);
    expect(runCalls[0].options).toEqual({ pooling: 'mean', normalize: true });
    expect(rows).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('embed() prefers tolist() when available and wraps single strings', async () => {
    const { embedder, runCalls } = embedderWith({ dims: [1, 2], data: [9, 9], tolist: () => [[0.5, 0.5]] });
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
    const el = render('loading', { file: 'onnx/model_q8.onnx', progress: 63, loadedBytes: 63, totalBytes: 100 });
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
