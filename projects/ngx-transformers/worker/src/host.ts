import type {
  CreateRequest,
  RunRequest,
  TensorData,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

/** A pipeline callable inside the worker: the real Transformers.js pipeline. */
type Pipe = ((...args: unknown[]) => Promise<unknown>) & {
  tokenizer?: unknown;
  dispose?: () => Promise<void>;
};

/** The slice of @huggingface/transformers the host uses. */
export interface WorkerTransformersModule {
  pipeline(task: string, model?: string, options?: object): Promise<unknown>;
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

export interface WorkerHostOptions {
  /** Sends a message to the main thread (postMessage in a worker). */
  post: (message: WorkerResponse, transfer?: Transferable[]) => void;
  /** Imports @huggingface/transformers; tests pass a stub. */
  load?: () => Promise<WorkerTransformersModule>;
}

export interface WorkerHost {
  /** Handles one request from the main thread. Resolves once the reply is posted. */
  handle(message: WorkerRequest): Promise<void>;
}

/** Tensor-like: the shape our TextEmbedder reads back on the main thread. */
function isTensorLike(value: unknown): value is TensorData & { tolist?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as TensorData).dims) &&
    ArrayBuffer.isView((value as TensorData).data)
  );
}

/**
 * Turns a pipeline result into something structured cloning keeps intact:
 * Tensors become { dims, data } with the buffer transferred, everything
 * else (plain objects, arrays, strings) passes through unchanged.
 */
function toCloneable(result: unknown): { value: unknown; transfer: Transferable[] } {
  const transfer: Transferable[] = [];
  const convert = (value: unknown): unknown => {
    if (isTensorLike(value)) {
      const data = (value.data as Float32Array).slice();
      transfer.push(data.buffer);
      return { dims: [...value.dims], data } satisfies TensorData;
    }
    if (Array.isArray(value)) return value.map(convert);
    return value;
  };
  return { value: convert(result), transfer };
}

function errorResponse(id: number, err: unknown): WorkerResponse {
  const error = err as { name?: unknown; message?: unknown } | null;
  return {
    type: 'error',
    id,
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(err),
  };
}

/**
 * The worker side of ngx-transformers/worker: creates pipelines on request,
 * runs them, streams progress and generated tokens back, and disposes them.
 * runTransformersWorker() wires it to the worker's message port; tests call
 * handle() directly.
 */
export function createTransformersWorkerHost(options: WorkerHostOptions): WorkerHost {
  const { post } = options;
  const load: () => Promise<WorkerTransformersModule> =
    options.load ?? (() => import('@huggingface/transformers'));
  const pipes = new Map<number, Pipe>();
  let module: Promise<WorkerTransformersModule> | null = null;
  let nextPipeId = 1;

  // A failed import is not kept: the next create() tries again, so a load
  // that failed on a network blip stays retryable, as PipelineHandle promises.
  const loadModule = () =>
    (module ??= load().catch((err: unknown) => {
      module = null;
      throw err;
    }));

  async function create(message: CreateRequest): Promise<void> {
    try {
      const { pipeline } = await loadModule();
      const pipe = (await pipeline(message.task, message.model, {
        ...message.options,
        progress_callback: (event: Record<string, unknown>) =>
          post({ type: 'progress', id: message.id, event }),
      })) as Pipe;
      const pipeId = nextPipeId++;
      pipes.set(pipeId, pipe);
      post({ type: 'created', id: message.id, pipeId });
    } catch (err) {
      post(errorResponse(message.id, err));
    }
  }

  async function run(message: RunRequest): Promise<void> {
    const pipe = pipes.get(message.pipeId);
    if (!pipe) {
      post(errorResponse(message.id, new Error(`Unknown pipeline ${message.pipeId}.`)));
      return;
    }
    try {
      let args = message.args;
      if (message.stream) {
        const { TextStreamer } = await loadModule();
        if (TextStreamer) {
          // The client already stripped onToken; the options object is last.
          const options = { ...(args[args.length - 1] as Record<string, unknown>) };
          options['streamer'] = new TextStreamer(pipe.tokenizer as never, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (text) => post({ type: 'token', id: message.id, text }),
          });
          args = [...args.slice(0, -1), options];
        }
      }
      const { value, transfer } = toCloneable(await pipe(...args));
      post({ type: 'result', id: message.id, result: value }, transfer);
    } catch (err) {
      post(errorResponse(message.id, err));
    }
  }

  return {
    async handle(message) {
      switch (message.type) {
        case 'create':
          return create(message);
        case 'run':
          return run(message);
        case 'dispose': {
          const pipe = pipes.get(message.pipeId);
          pipes.delete(message.pipeId);
          await pipe?.dispose?.();
          return;
        }
      }
    },
  };
}

/** The worker global scope surface the host needs. */
export interface WorkerScopeLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/**
 * Entry point for the worker file of an app:
 *
 * ```ts
 * // transformers.worker.ts
 * /// <reference lib="webworker" />
 * import { runTransformersWorker } from 'ngx-transformers/worker';
 * runTransformersWorker();
 * ```
 *
 * Pair it with provideTransformersWorker() on the main thread.
 */
export function runTransformersWorker(
  scope: WorkerScopeLike = workerGlobalScope(),
  load?: () => Promise<WorkerTransformersModule>,
): WorkerHost {
  const host = createTransformersWorkerHost({
    post: (message, transfer) => scope.postMessage(message, transfer),
    load,
  });
  scope.onmessage = (event) => void host.handle(event.data as WorkerRequest);
  return host;
}

/**
 * The current worker's global scope. On the main thread this would hook
 * window.onmessage, which any origin can post to, so refuse instead.
 */
function workerGlobalScope(): WorkerScopeLike {
  const global = globalThis as { WorkerGlobalScope?: unknown };
  if (global.WorkerGlobalScope === undefined) {
    throw new Error(
      'runTransformersWorker() must run inside a Web Worker file; on the main thread use provideTransformersWorker().',
    );
  }
  return globalThis as unknown as WorkerScopeLike;
}
