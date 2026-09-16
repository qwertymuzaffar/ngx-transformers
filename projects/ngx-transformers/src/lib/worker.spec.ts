import { TestBed } from '@angular/core/testing';
import {
  createTransformersWorkerHost,
  createWorkerPipelineFactory,
  runTransformersWorker,
  takeOnToken,
  withoutFunctions,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerScopeLike,
  type WorkerTransformersModule,
} from 'ngx-transformers/worker';
import { createPipeline } from './pipeline';
import { createTextEmbedder } from './text-embedder';
import { PIPELINE_FACTORY, provideTransformersWorker } from './transformers.providers';
import { createZeroShotClassifier } from './zero-shot-classifier';

/** A fake Transformers.js module whose pipelines echo their calls. */
function fakeModule(behaviour: {
  onCreate?: (task: string, model: string | undefined, options: Record<string, unknown>) => void;
  run?: (...args: unknown[]) => Promise<unknown>;
  withStreamer?: boolean;
}) {
  const disposed: number[] = [];
  let created = 0;
  class FakeStreamer {
    constructor(
      readonly tokenizer: unknown,
      readonly options: { callback_function?: (text: string) => void },
    ) {}
  }
  const module: WorkerTransformersModule = {
    async pipeline(task, model, options) {
      const opts = (options ?? {}) as Record<string, unknown>;
      behaviour.onCreate?.(task, model, opts);
      const index = created++;
      const pipe = Object.assign(
        async (...args: unknown[]) => (behaviour.run ? behaviour.run(...args) : ['ran', ...args]),
        { tokenizer: { name: 'tok' }, dispose: async () => void disposed.push(index) },
      );
      return pipe;
    },
    TextStreamer: behaviour.withStreamer ? (FakeStreamer as never) : undefined,
  };
  return { module, disposed: () => disposed, created: () => created };
}

/**
 * Wires a host and a client through an in-memory "worker": messages cross
 * a microtask boundary in both directions, like a real MessagePort.
 */
function inMemoryWorker(module: WorkerTransformersModule) {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: WorkerResponse[] = [];
  const host = createTransformersWorkerHost({
    post: (message) => {
      posted.push(message);
      queueMicrotask(() => listeners.forEach((l) => l({ data: message })));
    },
    load: async () => module,
  });
  const sent: WorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (message) => {
      sent.push(message as WorkerRequest);
      queueMicrotask(() => void host.handle(message as WorkerRequest));
    },
    addEventListener: (_type, listener) => void listeners.push(listener),
  };
  return { worker, sent, posted };
}

describe('worker pipeline factory + host', () => {
  it('creates a pipeline in the worker, forwards progress, runs it and disposes it', async () => {
    const seen: unknown[] = [];
    const fake = fakeModule({
      onCreate: (task, model, options) => seen.push([task, model, options]),
    });
    const { worker, sent } = inMemoryWorker(fake.module);
    const factory = createWorkerPipelineFactory(worker);

    const progress: unknown[] = [];
    const pipe = await factory('text-classification', 'org/model', {
      dtype: 'q8',
      progress_callback: (event: unknown) => progress.push(event),
    });
    // functions never cross the boundary; the host installs its own progress callback
    const [task, model, options] = seen[0] as [string, string, Record<string, unknown>];
    expect([task, model]).toEqual(['text-classification', 'org/model']);
    expect(options['dtype']).toBe('q8');
    expect(typeof options['progress_callback']).toBe('function');
    expect(options['progress_callback']).not.toBe(progress);
    expect(sent[0]).toEqual({
      type: 'create',
      id: 1,
      task: 'text-classification',
      model: 'org/model',
      options: { dtype: 'q8' },
    });

    expect(await pipe('hello', { top_k: 2 })).toEqual(['ran', 'hello', { top_k: 2 }]);
    await pipe.dispose();
    await vi.waitFor(() => expect(fake.disposed()).toEqual([0]));
  });

  it('relays progress events from the worker to the progress_callback', async () => {
    const fake = fakeModule({
      onCreate: (_t, _m, options) => {
        const cb = options['progress_callback'] as (e: unknown) => void;
        cb({ status: 'progress', file: 'model.onnx', progress: 50, loaded: 1, total: 2 });
      },
    });
    const { worker } = inMemoryWorker(fake.module);
    const factory = createWorkerPipelineFactory(worker);
    const progress: unknown[] = [];
    await factory('t', undefined, { progress_callback: (event: unknown) => progress.push(event) });
    await vi.waitFor(() => expect(progress).toHaveLength(1));
    expect(progress[0]).toEqual({
      status: 'progress',
      file: 'model.onnx',
      progress: 50,
      loaded: 1,
      total: 2,
    });
  });

  it('sends tensors back as { dims, data } so TextEmbedder can read them', async () => {
    const tensor = {
      dims: [2, 3],
      data: new Float32Array([1, 0, 0, 0, 1, 0]),
      tolist: () => [
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
    const fake = fakeModule({ run: async () => tensor });
    const { worker } = inMemoryWorker(fake.module);
    const factory = createWorkerPipelineFactory(worker);
    const pipe = await factory('feature-extraction', undefined, {});
    const out = (await pipe(['a', 'b'])) as {
      dims: number[];
      data: Float32Array;
      tolist?: unknown;
    };
    expect(out.dims).toEqual([2, 3]);
    expect(Array.from(out.data)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(out.tolist).toBeUndefined();
  });

  it('rejects with the worker-side error, name included', async () => {
    const fake = fakeModule({
      run: async () => {
        const err = new RangeError('too long');
        throw err;
      },
    });
    const { worker } = inMemoryWorker(fake.module);
    const pipe = await createWorkerPipelineFactory(worker)('t', undefined, {});
    await expect(pipe('x')).rejects.toMatchObject({ name: 'RangeError', message: 'too long' });
  });

  it('a failed create rejects the factory call', async () => {
    const module: WorkerTransformersModule = {
      pipeline: async () => {
        throw new Error('no such model');
      },
    };
    const { worker } = inMemoryWorker(module);
    await expect(createWorkerPipelineFactory(worker)('t', 'nope', {})).rejects.toThrow(
      'no such model',
    );
  });

  it('streams tokens for the onToken run option through a worker-side TextStreamer', async () => {
    const fake = fakeModule({
      withStreamer: true,
      run: async (_input, options) => {
        const streamer = (
          options as { streamer: { options: { callback_function: (t: string) => void } } }
        ).streamer;
        streamer.options.callback_function('Hel');
        streamer.options.callback_function('lo');
        return [{ generated_text: 'Hello' }];
      },
    });
    const { worker, sent } = inMemoryWorker(fake.module);
    const pipe = await createWorkerPipelineFactory(worker)('text-generation', undefined, {});
    const tokens: string[] = [];
    const out = await pipe('hi', { max_new_tokens: 4, onToken: (t: string) => tokens.push(t) });
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(out).toEqual([{ generated_text: 'Hello' }]);
    const run = sent.find((m) => m.type === 'run') as Extract<WorkerRequest, { type: 'run' }>;
    expect(run.stream).toBe(true);
    expect(run.args).toEqual(['hi', { max_new_tokens: 4 }]); // the function stayed on this side
  });

  it('creates the worker lazily, once, and shares it between pipelines', async () => {
    const fake = fakeModule({});
    const { worker } = inMemoryWorker(fake.module);
    let constructions = 0;
    const factory = createWorkerPipelineFactory(() => {
      constructions++;
      return worker;
    });
    expect(constructions).toBe(0);
    await factory('a', undefined, {});
    await factory('b', undefined, {});
    expect(constructions).toBe(1);
    expect(fake.created()).toBe(2);
  });

  it('runTransformersWorker() wires the host to a worker scope', async () => {
    const posted: unknown[] = [];
    const scope: WorkerScopeLike = { postMessage: (m) => void posted.push(m), onmessage: null };
    runTransformersWorker(scope, async () => fakeModule({}).module);
    scope.onmessage!({ data: { type: 'create', id: 7, task: 't', options: {} } });
    await vi.waitFor(() => expect(posted).toEqual([{ type: 'created', id: 7, pipeId: 1 }]));
    scope.onmessage!({ data: { type: 'run', id: 8, pipeId: 1, args: ['x'], stream: false } });
    await vi.waitFor(() =>
      expect(posted[1]).toEqual({ type: 'result', id: 8, result: ['ran', 'x'] }),
    );
    scope.onmessage!({ data: { type: 'run', id: 9, pipeId: 99, args: ['x'], stream: false } });
    await vi.waitFor(() => expect(posted[2]).toMatchObject({ type: 'error', id: 9 }));
  });

  it('provideTransformersWorker() makes every handle run in the worker', async () => {
    const fake = fakeModule({
      run: async (...args) => {
        const [input] = args;
        if (Array.isArray(input)) {
          return { dims: [input.length, 2], data: new Float32Array(input.length * 2).fill(0.5) };
        }
        return { sequence: input, labels: ['a', 'b'], scores: [0.7, 0.3] };
      },
    });
    const { worker } = inMemoryWorker(fake.module);
    TestBed.configureTestingModule({ providers: [provideTransformersWorker(() => worker)] });
    expect(typeof TestBed.inject(PIPELINE_FACTORY)).toBe('function');

    const zeroShot = TestBed.runInInjectionContext(() => createZeroShotClassifier());
    expect(await zeroShot.classify('text', ['a', 'b'])).toEqual([
      { label: 'a', score: 0.7 },
      { label: 'b', score: 0.3 },
    ]);
    expect(zeroShot.status()).toBe('ready');

    const embedder = TestBed.runInInjectionContext(() => createTextEmbedder());
    expect(await embedder.embed(['x', 'y'])).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);

    const generic = TestBed.runInInjectionContext(() => createPipeline({ task: 't' }));
    await generic.load();
    expect(fake.created()).toBe(3);
  });
});

describe('run option helpers', () => {
  it('takeOnToken() splits the callback off the trailing options object', () => {
    const onToken = () => undefined;
    expect(takeOnToken(['in', { a: 1, onToken }])).toEqual({ args: ['in', { a: 1 }], onToken });
    expect(takeOnToken(['in', { a: 1 }])).toEqual({ args: ['in', { a: 1 }] });
    expect(takeOnToken(['in'])).toEqual({ args: ['in'] });
    expect(takeOnToken(['in', ['labels']])).toEqual({ args: ['in', ['labels']] });
  });

  it('withoutFunctions() drops function-valued entries only', () => {
    expect(withoutFunctions({ a: 1, b: () => 2, c: null })).toEqual({ a: 1, c: null });
  });
});
