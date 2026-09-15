import { DestroyRef, computed, inject, signal } from '@angular/core';
import { detectDevice } from './device-detection';
import type {
  ModelProgress,
  NgxTransformersConfig,
  PipelineRequest,
  PipelineStatus,
  TransformersDevice,
} from './transformers.models';
import {
  NGX_TRANSFORMERS_CONFIG,
  PIPELINE_FACTORY,
  type PipelineFactory,
  type PipelineLike,
} from './transformers.providers';

/** Shape of Transformers.js progress_callback events (subset we consume). */
interface RawProgressEvent {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/** A pipeline callable with the positional extras some tasks take after the input. */
type Runnable = (...args: unknown[]) => Promise<unknown>;

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
  /** Bumped by dispose() so a load still in flight knows its result is unwanted. */
  private generation = 0;
  /** Runs currently executing; the status returns to ready when the last one finishes. */
  private inFlight = 0;

  constructor(
    private readonly request: PipelineRequest,
    private readonly factory: PipelineFactory,
    private readonly config: NgxTransformersConfig,
  ) {}

  /** Downloads and initializes the model. Idempotent; retries after error. */
  load(): Promise<void> {
    if (this.pipe) return Promise.resolve();
    if (!this.loading) {
      const loading = this.doLoad().finally(() => {
        // Only forget our own promise: dispose() may have started a newer load meanwhile.
        if (this.loading === loading) this.loading = null;
      });
      this.loading = loading;
    }
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
    const pipe = this.pipe;
    if (!pipe) {
      throw new Error('PipelineHandle: disposed before the model finished loading.');
    }
    this.inFlight++;
    this.status.set('busy');
    try {
      return (await (pipe as Runnable)(input, ...extraArgs)) as TOut;
    } finally {
      // Back to ready once the last overlapping run finishes - a failed run
      // leaves the model intact. A dispose() mid-run has already reset the status.
      this.inFlight = Math.max(0, this.inFlight - 1);
      if (this.inFlight === 0 && this.pipe === pipe) this.status.set('ready');
    }
  }

  /**
   * Frees the model. A download still in flight is cancelled: its model is
   * released on arrival and the handle stays idle. The handle can be loaded
   * again afterwards.
   */
  async dispose(): Promise<void> {
    this.generation++;
    const pipe = this.pipe;
    this.pipe = null;
    this.loading = null;
    this.inFlight = 0;
    this.status.set('idle');
    this.progress.set(null);
    await pipe?.dispose?.();
  }

  private async doLoad(): Promise<void> {
    const generation = this.generation;
    this.status.set('loading');
    this.error.set(null);
    const options: Record<string, unknown> = {
      ...this.config.pipelineOptions,
      ...this.request.options,
      progress_callback: (event: RawProgressEvent) => this.onProgress(event, generation),
    };
    const device = await this.resolveDevice();
    const dtype = this.request.dtype ?? this.config.dtype;
    if (device && device !== 'auto') options['device'] = device;
    if (dtype) options['dtype'] = dtype;

    try {
      const pipe = await this.factory(this.request.task, this.request.model, options);
      if (generation !== this.generation) {
        // Disposed while downloading: nobody wants this model any more.
        await pipe.dispose?.();
        return;
      }
      this.pipe = pipe;
      this.progress.set(null);
      this.status.set('ready');
    } catch (err) {
      // A cancelled load is not an error - dispose() already reset the handle.
      if (generation !== this.generation) return;
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

  private onProgress(event: RawProgressEvent, generation: number): void {
    // Events from a load that dispose() cancelled must not resurrect the bar.
    if (generation !== this.generation) return;
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
export function createPipeline<TIn = unknown, TOut = unknown>(
  request: PipelineRequest,
): PipelineHandle<TIn, TOut> {
  const handle = new PipelineHandle<TIn, TOut>(
    request,
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void handle.dispose());
  return handle;
}
