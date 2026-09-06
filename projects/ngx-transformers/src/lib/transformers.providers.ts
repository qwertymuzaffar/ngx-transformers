import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { NgxTransformersConfig } from './transformers.models';

/**
 * The callable returned by Transformers.js pipeline(), reduced to the
 * surface this library relies on.
 */
export type PipelineLike = ((input: unknown, options?: Record<string, unknown>) => Promise<unknown>) & {
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

const defaultPipelineFactory: PipelineFactory = async (task, model, options) => {
  const { pipeline } = await import('@huggingface/transformers');
  const pipe = await (pipeline as (t: string, m?: string, o?: object) => Promise<unknown>)(
    task,
    model,
    options,
  );
  return pipe as PipelineLike;
};

export const PIPELINE_FACTORY = new InjectionToken<PipelineFactory>('ngx-transformers.pipeline-factory', {
  providedIn: 'root',
  factory: () => defaultPipelineFactory,
});

export const NGX_TRANSFORMERS_CONFIG = new InjectionToken<NgxTransformersConfig>('ngx-transformers.config', {
  providedIn: 'root',
  factory: () => ({}),
});

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
