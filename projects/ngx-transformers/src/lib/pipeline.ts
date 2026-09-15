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
 * One load-to-dispose span of a handle. dispose() swaps in a fresh session,
 * so async work still holding the old one knows it was cancelled and keeps
 * its bookkeeping (in-flight runs, the loading promise) to itself.
 */
interface Session {
  pipe: PipelineLike | null;
  loading: Promise<void> | null;
  /** Runs executing against this session's pipe. */
  inFlight: number;
}

const newSession = (): Session => ({ pipe: null, loading: null, inFlight: 0 });

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

  private session = newSession();
  private destroyed = false;

  constructor(
    private readonly request: PipelineRequest,
    private readonly factory: PipelineFactory,
    private readonly config: NgxTransformersConfig,
  ) {}

  /** Downloads and initializes the model. Idempotent; retries after error. */
  load(): Promise<void> {
    if (this.destroyed) return Promise.reject(destroyedError());
    const session = this.session;
    if (session.pipe) return Promise.resolve();
    session.loading ??= this.doLoad(session).finally(() => {
      session.loading = null;
    });
    return session.loading;
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
    const session = this.session;
    const pipe = session.pipe;
    if (!pipe) {
      throw new Error('PipelineHandle: disposed before the model finished loading.');
    }
    session.inFlight++;
    this.status.set('busy');
    try {
      return (await (pipe as Runnable)(input, ...extraArgs)) as TOut;
    } finally {
      // Back to ready once the last overlapping run finishes - a failed run
      // leaves the model intact. A run that outlived dispose() settles its
      // own, retired session and leaves the status alone.
      session.inFlight--;
      if (session.inFlight === 0 && this.session === session) this.status.set('ready');
    }
  }

  /**
   * Frees the model. A download still in flight is cancelled: its model is
   * released on arrival and the handle stays idle. The handle can be loaded
   * again afterwards; destroy() is the terminal variant.
   */
  async dispose(): Promise<void> {
    const session = this.session;
    this.session = newSession();
    this.status.set('idle');
    this.progress.set(null);
    await session.pipe?.dispose?.();
  }

  /**
   * dispose() for good: later load() and run() calls reject instead of
   * downloading a model nobody would release. create*() registers this with
   * the DestroyRef of the injection context, so a handle declared in a
   * component ends with the component.
   */
  destroy(): Promise<void> {
    this.destroyed = true;
    return this.dispose();
  }

  private async doLoad(session: Session): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    const options: Record<string, unknown> = {
      ...this.config.pipelineOptions,
      ...this.request.options,
      progress_callback: (event: RawProgressEvent) => this.onProgress(event, session),
    };
    const device = await this.resolveDevice();
    // Disposed while probing the device: do not start the download at all.
    if (this.session !== session) return;
    const dtype = this.request.dtype ?? this.config.dtype;
    if (device && device !== 'auto') options['device'] = device;
    if (dtype) options['dtype'] = dtype;

    try {
      const pipe = await this.factory(this.request.task, this.request.model, options);
      if (this.session !== session) {
        // Disposed while downloading: nobody wants this model any more.
        await pipe.dispose?.();
        return;
      }
      session.pipe = pipe;
      this.progress.set(null);
      this.status.set('ready');
    } catch (err) {
      // A cancelled load is not an error - dispose() already reset the handle.
      if (this.session !== session) return;
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

  private onProgress(event: RawProgressEvent, session: Session): void {
    // Events from a load that dispose() cancelled must not resurrect the bar.
    if (this.session !== session) return;
    if (event.status !== 'progress' || !event.file) return;
    this.progress.set({
      file: event.file,
      progress: Math.round(event.progress ?? 0),
      loadedBytes: event.loaded ?? 0,
      totalBytes: event.total ?? 0,
    });
  }
}

function destroyedError(): Error {
  return new Error('PipelineHandle: destroyed with its component; create a new handle.');
}

/**
 * Creates a PipelineHandle in an injection context (constructor, field
 * initializer, or runInInjectionContext). The handle is destroyed with the
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
  inject(DestroyRef, { optional: true })?.onDestroy(() => void handle.destroy());
  return handle;
}
