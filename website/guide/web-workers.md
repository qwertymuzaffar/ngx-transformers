# Web Workers

Inference runs on the main thread by default. That is fine for a sentence classifier, but Whisper or translation can hold the page for seconds on WebAssembly. `provideTransformersWorker()` moves every pipeline into a Web Worker; handles, signals and the wrappers work unchanged, only the setup differs.

## Setup

First, a worker file that runs the worker side of the library. The `ngx-transformers/worker` entry point has no Angular dependency, so the worker bundle stays tiny:

```ts
// src/app/transformers.worker.ts
/// <reference lib="webworker" />
import { runTransformersWorker } from 'ngx-transformers/worker';

runTransformersWorker();
```

Then the provider, with a factory that creates the worker the way the Angular CLI bundles it:

```ts
// app.config.ts
import { provideTransformersWorker } from 'ngx-transformers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideTransformersWorker(
      () => new Worker(new URL('./transformers.worker', import.meta.url), { type: 'module' }),
    ),
  ],
};
```

The `new Worker(new URL(..., import.meta.url))` form is what the CLI recognises: the worker becomes its own chunk. To type-check the worker file with the worker lib, add a `tsconfig.worker.json` (`"lib": ["es2022", "webworker"]`, `"include": ["src/**/*.worker.ts"]`) and point `webWorkerTsConfig` in `angular.json` at it, as the [demo app](https://github.com/qwertymuzaffar/ngx-transformers/tree/main/projects/demo) does.

The worker is created lazily, on the first pipeline, and every handle shares it. `@huggingface/transformers` is imported inside the worker only, so the main bundle never contains it.

## What crosses the boundary

- **Inputs**: strings, arrays, typed arrays, Blobs and plain objects, anything structured cloning accepts. Functions are dropped from the options, except `onToken`, which the worker turns into a streamer (see [Text generation](./text-generation)).
- **Progress** events and generated tokens come back as messages and feed the same signals.
- **Results**: plain objects and arrays as is. Transformers.js Tensors arrive as `{ dims, data }` with the buffer transferred, which is what `TextEmbedder` reads. Results holding class instances that do not clone (a `RawImage`, for example) are not supported in worker mode; run those handles in-thread with a second factory, below.
- **Errors** are re-thrown on the main thread with the worker's error name and message. If the worker itself fails, because its script did not load or it crashed while loading a model, every call waiting on it rejects with a `WorkerError` and the handle shows `error`, like a failed load in-thread; the next pipeline starts a fresh worker.
- **Lifetime**: the worker is created on the first pipeline and terminated when the environment injector it was provided in is destroyed. `createWorkerPipelineFactory()` exposes `terminate()` for setups that manage it by hand.

## Device selection

The WebGPU probe behind `autoDevice` and `detectDevice()` runs on the main thread, and the chosen device is passed to the worker. Browsers that support WebGPU in workers use it there without extra setup.

## Mixing in-thread and worker pipelines

`createWorkerPipelineFactory(worker)` from `ngx-transformers/worker` is the factory `provideTransformersWorker()` installs. Provide it through `PIPELINE_FACTORY` yourself to construct the worker differently, or to keep some tasks in-thread:

```ts
import { PIPELINE_FACTORY, createDefaultPipelineFactory, type PipelineFactory } from 'ngx-transformers';
import { createWorkerPipelineFactory } from 'ngx-transformers/worker';

const inThread = createDefaultPipelineFactory();
const inWorker = createWorkerPipelineFactory(
  () => new Worker(new URL('./transformers.worker', import.meta.url), { type: 'module' }),
);
const factory: PipelineFactory = (task, model, options) =>
  task === 'image-classification' ? inThread(task, model, options) : inWorker(task, model, options);

providers: [{ provide: PIPELINE_FACTORY, useValue: factory }];
```

## Testing

`createWorkerPipelineFactory()` accepts anything with `postMessage` and `addEventListener`, and `createTransformersWorkerHost()` takes a `post` function and a module importer, so the two halves can be wired through an in-memory channel in jsdom. The library's own `worker.spec.ts` does exactly that.
