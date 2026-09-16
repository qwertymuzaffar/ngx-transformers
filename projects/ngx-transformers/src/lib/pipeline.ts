import { DestroyRef, computed, inject, signal } from '@angular/core';
import { detectDevice } from './device-detection';
import type {
  ModelProgress,
  NgxTransformersConfig,
  OverallProgress,
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

interface FileProgress {
  loaded: number;
  total: number;
  done: boolean;
}

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
  /** Per-file download state of the current load attempt, by file name. */
  files: Map<string, FileProgress>;
}

const newSession = (): Session => ({ pipe: null, loading: null, inFlight: 0, files: new Map() });

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
  /** Download progress: the file reported last, plus the total over all files. */
  readonly progress = signal<ModelProgress | null>(null);
  /** The last load error; cleared when a load starts. */
  readonly error = signal<unknown>(null);
  /** The error of the most recently started run, if it failed; cleared when a run starts. */
  readonly runError = signal<unknown>(null);
  /** True once the model is usable (including while a run is in flight). */
  readonly ready = computed(() => this.status() === 'ready' || this.status() === 'busy');
  readonly busy = computed(() => this.status() === 'busy' || this.status() === 'loading');

  private session = newSession();
  private destroyed = false;
  /** Counts runs so only the most recently started one writes runError. */
  private runSequence = 0;

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

  /**
   * Runs the pipeline, loading the model first if needed. Besides the
   * pipeline's own options, `runOptions.signal` (an AbortSignal) makes the
   * run reject before it starts when the signal has already fired, which
   * spares superseded runs the inference (see inferenceResource()).
   */
  run(input: TIn, runOptions?: Record<string, unknown>): Promise<TOut> {
    return this.runWith(input, runOptions);
  }

  /**
   * Runs the pipeline with extra positional arguments after the input, for
   * tasks whose pipeline signature is not (input, options): zero-shot
   * classification takes (text, candidateLabels, options).
   */
  protected async runWith(input: TIn, ...extraArgs: unknown[]): Promise<TOut> {
    const { args, signal } = takeSignal(extraArgs);
    await this.load();
    // The model cannot be interrupted, but a run nobody wants any more
    // (a newer input superseded it while the model loaded) need not start.
    if (signal?.aborted) throw abortError();
    const session = this.session;
    const pipe = session.pipe;
    if (!pipe) {
      throw new Error('PipelineHandle: disposed before the model finished loading.');
    }
    const sequence = ++this.runSequence;
    session.inFlight++;
    this.status.set('busy');
    this.runError.set(null);
    try {
      return (await (pipe as Runnable)(input, ...args)) as TOut;
    } catch (err) {
      if (this.session === session && sequence === this.runSequence) this.runError.set(err);
      throw err;
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
    // A retry after a failed attempt starts its bookkeeping from scratch.
    session.files = new Map();
    this.progress.set(null);
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
      this.progress.set(null);
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

  /**
   * Transformers.js reports each file on its own (initiate, download,
   * progress, done). The session records every file it hears about; the
   * signal is published on progress and done events only, so a file that
   * has not transferred a byte never replaces the one that is moving.
   */
  private onProgress(event: RawProgressEvent, session: Session): void {
    // Events from a load that dispose() cancelled must not resurrect the bar.
    if (this.session !== session || !event.file) return;
    const file = session.files.get(event.file) ?? { loaded: 0, total: 0, done: false };
    session.files.set(event.file, file);
    switch (event.status) {
      case 'progress':
        file.loaded = event.loaded ?? file.loaded;
        file.total = event.total ?? file.total;
        break;
      case 'done':
        file.done = true;
        if (file.total > 0) file.loaded = file.total;
        break;
      default:
        return; // initiate / download: recorded, not published
    }
    const percent = event.status === 'done' ? 100 : Math.round(event.progress ?? 0);
    const overall = overallOf(session.files);
    this.progress.set({
      file: event.file,
      progress: percent,
      loadedBytes: file.loaded,
      totalBytes: file.total,
      ...(overall ? { overall } : {}),
    });
  }
}

/**
 * The total over the files seen so far. Transformers.js fetches the small
 * files (config, tokenizer) before it starts the weights, so a total
 * computed before the weights are known would read 100% and then collapse;
 * it is therefore withheld until a weights file has been seen.
 */
function overallOf(files: Map<string, FileProgress>): OverallProgress | undefined {
  let weightsSeen = false;
  let loadedBytes = 0;
  let totalBytes = 0;
  let filesDone = 0;
  for (const [name, file] of files) {
    if (name.includes('.onnx')) weightsSeen = true;
    if (file.total > 0) {
      loadedBytes += Math.min(file.loaded, file.total);
      totalBytes += file.total;
    }
    if (file.done) filesDone++;
  }
  if (!weightsSeen) return undefined;
  return {
    progress: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
    loadedBytes,
    totalBytes,
    files: files.size,
    filesDone,
  };
}

/** Pulls `signal` out of a call's trailing options object. */
function takeSignal(args: unknown[]): { args: unknown[]; signal?: AbortSignal } {
  const last = args[args.length - 1];
  if (typeof last !== 'object' || last === null || Array.isArray(last)) return { args };
  const { signal, ...rest } = last as { signal?: unknown } & Record<string, unknown>;
  if (!(signal instanceof AbortSignal)) return { args };
  return { args: [...args.slice(0, -1), rest], signal };
}

function abortError(): Error {
  return new DOMException('PipelineHandle: the run was aborted before it started.', 'AbortError');
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
