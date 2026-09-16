import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { createWorkerPipelineFactory, takeOnToken, type WorkerLike } from 'ngx-transformers/worker';
import type { NgxTransformersConfig } from './transformers.models';

/**
 * The callable returned by Transformers.js pipeline(), reduced to the
 * surface this library relies on.
 */
export type PipelineLike = ((
  input: unknown,
  options?: Record<string, unknown>,
) => Promise<unknown>) & {
  dispose?: () => Promise<void>;
};

/**
 * Creates a pipeline for a task. The default implementation lazy-imports
 * @huggingface/transformers; tests and SSR shims can provide their own.
 */
export type PipelineFactory = (
  task: string,
  model: string | undefined,
  options: Record<string, unknown>,
) => Promise<PipelineLike>;

/**
 * The slice of the @huggingface/transformers module the default factory
 * uses. The real module satisfies it, so an importer can configure
 * `env` and return the module as is.
 */
export interface TransformersModuleLike {
  // A method signature on purpose: it keeps the overloaded, generic
  // pipeline() of the real module assignable.
  pipeline(task: string, model?: string, options?: object): Promise<unknown>;
  /** Streams generated text for the `onToken` run option; optional in test stubs. */
  TextStreamer?: new (
    // `never` keeps the real class (which wants a PreTrainedTokenizer) assignable.
    tokenizer: never,
    options: {
      skip_prompt?: boolean;
      skip_special_tokens?: boolean;
      callback_function?: (text: string) => void;
    },
  ) => unknown;
}

const importTransformers = (): Promise<TransformersModuleLike> =>
  import('@huggingface/transformers');

/**
 * Wraps a pipeline so the `onToken` run option (TextGenerator streaming)
 * becomes a Transformers.js TextStreamer on the pipeline's tokenizer.
 */
function withTokenStreaming(pipe: PipelineLike, module: TransformersModuleLike): PipelineLike {
  const streaming = (async (input: unknown, ...args: unknown[]) => {
    const { args: rest, onToken } = takeOnToken(args);
    if (onToken && module.TextStreamer) {
      const options = { ...(rest[rest.length - 1] as Record<string, unknown>) };
      options['streamer'] = new module.TextStreamer(
        (pipe as unknown as { tokenizer?: unknown }).tokenizer as never,
        { skip_prompt: true, skip_special_tokens: true, callback_function: onToken },
      );
      rest[rest.length - 1] = options;
    }
    return (pipe as (...a: unknown[]) => Promise<unknown>)(input, ...rest);
  }) as PipelineLike;
  streaming.dispose = () => pipe.dispose?.() ?? Promise.resolve();
  return streaming;
}

/**
 * The factory behind PIPELINE_FACTORY. It imports @huggingface/transformers
 * lazily, on the first pipeline, so the library adds nothing to the initial
 * bundle. Wrap it to add options or logging while keeping the lazy import:
 *
 * ```ts
 * const base = createDefaultPipelineFactory();
 * const factory: PipelineFactory = (task, model, options) =>
 *   base(task, model, { ...options, revision: 'v2' });
 * providers: [{ provide: PIPELINE_FACTORY, useValue: factory }]
 * ```
 *
 * `load` is the importer. Tests pass a stub module; apps that need to
 * configure Transformers.js (`env.allowRemoteModels`, `env.localModelPath`)
 * do it there, before returning the module.
 */
export function createDefaultPipelineFactory(
  load: () => Promise<TransformersModuleLike> = importTransformers,
): PipelineFactory {
  return async (task, model, options) => {
    const module = await load();
    const pipe = (await module.pipeline(task, model, options)) as PipelineLike;
    return withTokenStreaming(pipe, module);
  };
}

export const PIPELINE_FACTORY = new InjectionToken<PipelineFactory>(
  'ngx-transformers.pipeline-factory',
  {
    providedIn: 'root',
    factory: () => createDefaultPipelineFactory(),
  },
);

export const NGX_TRANSFORMERS_CONFIG = new InjectionToken<NgxTransformersConfig>(
  'ngx-transformers.config',
  {
    providedIn: 'root',
    factory: () => ({}),
  },
);

/**
 * Sets workspace-wide defaults (device, dtype, extra pipeline options):
 *
 * ```ts
 * bootstrapApplication(App, {
 *   providers: [provideTransformers({ device: 'webgpu', dtype: 'q8' })],
 * });
 * ```
 */
export function provideTransformers(config: NgxTransformersConfig): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: NGX_TRANSFORMERS_CONFIG, useValue: config }]);
}

/**
 * Runs every pipeline in a Web Worker so inference never blocks the UI.
 * The worker file imports the worker entry point:
 *
 * ```ts
 * // transformers.worker.ts
 * /// <reference lib="webworker" />
 * import { runTransformersWorker } from 'ngx-transformers/worker';
 * runTransformersWorker();
 *
 * // app.config.ts
 * provideTransformersWorker(
 *   () => new Worker(new URL('./transformers.worker', import.meta.url), { type: 'module' }),
 * )
 * ```
 *
 * The worker is created on the first pipeline. Handles, signals and the
 * wrappers work unchanged; results must survive structured cloning (plain
 * objects, arrays, typed arrays and tensors do).
 */
export function provideTransformersWorker(createWorker: () => WorkerLike): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PIPELINE_FACTORY, useFactory: () => createWorkerPipelineFactory(createWorker) },
  ]);
}
