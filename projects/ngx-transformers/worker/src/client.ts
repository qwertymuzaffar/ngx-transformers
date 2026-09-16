import type { WorkerRequest, WorkerResponse } from './protocol';
import { takeOnToken, withoutFunctions, withoutFunctionsInLast, type OnToken } from './run-options';

/** The Worker surface the client needs; a real Worker satisfies it. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** A pipeline proxy on the main thread: calls run in the worker. */
export type WorkerPipeline = ((input: unknown, ...args: unknown[]) => Promise<unknown>) & {
  dispose: () => Promise<void>;
};

/** Structurally the same as ngx-transformers' PipelineFactory. */
export type WorkerPipelineFactory = (
  task: string,
  model: string | undefined,
  options: Record<string, unknown>,
) => Promise<WorkerPipeline>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  progress?: (event: Record<string, unknown>) => void;
  onToken?: OnToken;
}

/**
 * A pipeline factory whose pipelines live in a Web Worker, so inference
 * never blocks the UI thread. The worker runs runTransformersWorker() and
 * is created lazily, on the first pipeline. Provide the factory through
 * PIPELINE_FACTORY, or use provideTransformersWorker() from
 * ngx-transformers which does exactly that.
 */
export function createWorkerPipelineFactory(
  worker: WorkerLike | (() => WorkerLike),
): WorkerPipelineFactory {
  const pending = new Map<number, Pending>();
  let instance: WorkerLike | null = null;
  let nextId = 1;

  function dispatch(message: WorkerResponse): void {
    const entry = pending.get(message.id);
    if (!entry) return;
    switch (message.type) {
      case 'created':
        pending.delete(message.id);
        entry.resolve(message.pipeId);
        return;
      case 'result':
        pending.delete(message.id);
        entry.resolve(message.result);
        return;
      case 'error': {
        pending.delete(message.id);
        const error = new Error(message.message);
        error.name = message.name;
        entry.reject(error);
        return;
      }
      case 'progress':
        entry.progress?.(message.event);
        return;
      case 'token':
        entry.onToken?.(message.text);
        return;
    }
  }

  function getWorker(): WorkerLike {
    if (!instance) {
      instance = typeof worker === 'function' ? worker() : worker;
      instance.addEventListener('message', (event) => dispatch(event.data as WorkerResponse));
    }
    return instance;
  }

  function request<T>(
    message: WorkerRequest & { id: number },
    extras: Omit<Pending, 'resolve' | 'reject'> = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.set(message.id, { resolve: resolve as (value: unknown) => void, reject, ...extras });
      getWorker().postMessage(message);
    });
  }

  return async (task, model, options) => {
    const { progress_callback, ...rest } = options;
    const progress =
      typeof progress_callback === 'function'
        ? (progress_callback as (event: Record<string, unknown>) => void)
        : undefined;
    const pipeId = await request<number>(
      { type: 'create', id: nextId++, task, model, options: withoutFunctions(rest) },
      { progress },
    );

    const pipe = (async (input: unknown, ...args: unknown[]) => {
      const { args: cleanArgs, onToken } = takeOnToken(args);
      return request(
        {
          type: 'run',
          id: nextId++,
          pipeId,
          args: [input, ...withoutFunctionsInLast(cleanArgs)],
          stream: onToken !== undefined,
        },
        { onToken },
      );
    }) as WorkerPipeline;
    pipe.dispose = async () => {
      getWorker().postMessage({ type: 'dispose', pipeId } satisfies WorkerRequest);
    };
    return pipe;
  };
}
