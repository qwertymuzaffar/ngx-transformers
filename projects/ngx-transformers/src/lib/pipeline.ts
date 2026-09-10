import { DestroyRef, computed, inject, signal } from '@angular/core';
import { detectDevice } from './device-detection';
import type { ModelProgress, NgxTransformersConfig, PipelineRequest, PipelineStatus, TransformersDevice } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY, type PipelineFactory, type PipelineLike } from './transformers.providers';

/** Shape of Transformers.js progress_callback events (subset we consume). */
interface RawProgressEvent {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/**
 * A lazily-loaded Transformers.js pipeline wrapped in signals.
 *
 * The model is not downloaded until load() or the first run() call, so
 * creating handles is free. All state is exposed as signals and safe to
 * bind in zoneless apps.
 */
export class PipelineHandle<TIn = unknown, TOut = unknown> {
  /** idle -> loading -> ready <-> busy; error only on load failure. */
  readonly status = signal<PipelineStatus>('idle');
  /** Download progress for the file currently transferring, else null. */
  readonly progress = signal<ModelProgress | null>(null);
  readonly error = signal<unknown>(null);
  /** True once the model is usable (including while a run is in flight). */
  readonly ready = computed(() => this.status() === 'ready' || this.status() === 'busy');
  readonly busy = computed(() => this.status() === 'busy' || this.status() === 'loading');

  private pipe: PipelineLike | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly request: PipelineRequest,
    private readonly factory: PipelineFactory,
    private readonly config: NgxTransformersConfig,
  ) {}

  /** Downloads and initializes the model. Idempotent; retries after error. */
  load(): Promise<void> {
    if (this.pipe) return Promise.resolve();
    this.loading ??= this.doLoad().finally(() => (this.loading = null));
    return this.loading;
  }

  /** Runs the pipeline, loading the model first if needed. */
  run(input: TIn, runOptions?: Record<string, unknown>): Promise<TOut> {
    return this.runWith(input, runOptions);
  }

  /**
   * Runs the pipeline with extra positional arguments after the input, for
   * tasks whose pipeline signature is not (input, options): zero-shot
   * classification takes (text, candidateLabels, options).
   */
  protected async runWith(input: TIn, ...extraArgs: unknown[]): Promise<TOut> {
    await this.load();
    this.status.set('busy');
    try {
      const pipe = this.pipe! as (...args: unknown[]) => Promise<unknown>;
      return (await pipe(input, ...extraArgs)) as TOut;
    } finally {
      // A failed run leaves the model intact - back to ready either way.
      this.status.set('ready');
    }
  }

  /** Frees the model. The handle can be loaded again afterwards. */
  async dispose(): Promise<void> {
    const pipe = this.pipe;
    this.pipe = null;
    this.status.set('idle');
    this.progress.set(null);
    await pipe?.dispose?.();
  }

  private async doLoad(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    const options: Record<string, unknown> = {
      ...this.config.pipelineOptions,
      ...this.request.options,
      progress_callback: (event: RawProgressEvent) => this.onProgress(event),
    };
    const device = await this.resolveDevice();
    const dtype = this.request.dtype ?? this.config.dtype;
    if (device && device !== 'auto') options['device'] = device;
    if (dtype) options['dtype'] = dtype;

    try {
      this.pipe = await this.factory(this.request.task, this.request.model, options);
      this.progress.set(null);
      this.status.set('ready');
    } catch (err) {
      this.error.set(err);
      this.status.set('error');
      throw err;
    }
  }

  /**
   * An explicit request or global device wins; with `autoDevice` on, an
   * unset or 'auto' device is probed for WebGPU (once, cached) at load time.
   */
  private async resolveDevice(): Promise<TransformersDevice | undefined> {
    const configured = this.request.device ?? this.config.device;
    if (configured && configured !== 'auto') return configured;
    return this.config.autoDevice ? detectDevice() : configured;
  }

  private onProgress(event: RawProgressEvent): void {
    if (event.status !== 'progress' || !event.file) return;
    this.progress.set({
      file: event.file,
      progress: Math.round(event.progress ?? 0),
      loadedBytes: event.loaded ?? 0,
      totalBytes: event.total ?? 0,
    });
  }
}

/**
 * Creates a PipelineHandle in an injection context (constructor, field
 * initializer, or runInInjectionContext). The handle is disposed with the
 * surrounding component/injector.
 */
export function createPipeline<TIn = unknown, TOut = unknown>(request: PipelineRequest): PipelineHandle<TIn, TOut> {
  const handle = new PipelineHandle<TIn, TOut>(
    request,
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void handle.dispose());
  return handle;
}
