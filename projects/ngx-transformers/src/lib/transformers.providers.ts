import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
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

/** The slice of the @huggingface/transformers module the default factory uses. */
export interface TransformersModuleLike {
  pipeline: (task: string, model?: string, options?: object) => Promise<unknown>;
}

const importTransformers = async (): Promise<TransformersModuleLike> => {
  const { pipeline } = await import('@huggingface/transformers');
  return { pipeline: pipeline as TransformersModuleLike['pipeline'] };
};

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
 * `load` is the importer; tests pass a stub module.
 */
export function createDefaultPipelineFactory(
  load: () => Promise<TransformersModuleLike> = importTransformers,
): PipelineFactory {
  return async (task, model, options) => {
    const { pipeline } = await load();
    return (await pipeline(task, model, options)) as PipelineLike;
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
