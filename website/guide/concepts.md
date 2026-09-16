# Concepts

Everything in ngx-transformers is built on one class, `PipelineHandle`. The task wrappers subclass it and add a typed method or two; `createPipeline()` gives you the bare handle for any Transformers.js task.

## A handle wraps one pipeline

A handle holds a `PipelineRequest`: the task, a model id, and optional device, dtype and pipeline options. It creates the Transformers.js pipeline lazily through the [pipeline factory](./configuration#the-pipeline-factory) and keeps it until disposed.

```ts
const handle = createPipeline<string, { summary_text: string }[]>({
  task: 'summarization',
  model: 'Xenova/distilbart-cnn-6-6',
});
```

Creating a handle never touches the network; a component can declare several, and only the ones actually used download anything.

## Lifecycle

| Status | Meaning |
| --- | --- |
| <span class="nt-status">idle</span> | No model loaded. The initial state, and the state after `dispose()`. |
| <span class="nt-status">loading</span> | `load()` (or the first `run()`) is downloading and initialising the model. `progress` reports files. |
| <span class="nt-status">ready</span> | The model is in memory and idle. |
| <span class="nt-status">busy</span> | One or more runs are executing. Back to `ready` when the last one finishes. |
| <span class="nt-status">error</span> | The load failed. `error` holds the reason; the next `load()` or `run()` retries. |

Transitions: `idle → loading → ready ⇄ busy`, plus `loading → error → loading` on retry. A failed **run** does not change the status: the model is intact, so the handle goes back to `ready` and the promise rejects with the pipeline's error.

## Signals

| Signal | Type | Notes |
| --- | --- | --- |
| `status` | `PipelineStatus` | The lifecycle state above. |
| `progress` | `ModelProgress \| null` | The file reported last (`file`, `progress`, `loadedBytes`, `totalBytes`) plus `overall`, the same numbers summed over every file of the model once the weights file is known. `null` outside of loading. |
| `error` | `unknown` | The last load error, cleared when a load starts. |
| `runError` | `unknown` | The error of the most recently started run, if it failed; cleared when a run starts. A superseded run that fails later does not overwrite it. |
| `ready` | `boolean` (computed) | `status` is `ready` or `busy`: the model can be used. |
| `busy` | `boolean` (computed) | `status` is `busy` or `loading`: disable the button. |

All of them are plain Angular signals, so they work with `OnPush` components, zoneless apps, `computed()` and `effect()`.

Transformers.js downloads a model's files in parallel (config, tokenizer, ONNX weights). `progress.file` follows whichever file reported last, while `progress.overall` sums the bytes of every file seen so far. It fetches the small files before it starts the weights, so `overall` is withheld until a weights file has been seen; otherwise the bar would read 100% and collapse. The progress component drives its bar with `overall` when present and with the current file before that.

## Methods

- `load()`: downloads and initialises the model. Idempotent and retryable.
- `run(input, options?)`: loads if needed, then runs the pipeline. Wrappers expose typed methods (`classify`, `embed`, `translate`, `transcribe`, `generate`) that call it. Every one of them accepts a `signal` (an `AbortSignal`): a run whose signal has already fired rejects with an `AbortError` before it starts. A model run cannot be interrupted once started, but a superseded run that was still waiting for the model to load is skipped instead of queued.
- `dispose()`: releases the model and returns to `idle`. The handle can be loaded again later.
- `destroy()`: `dispose()` for good; later calls reject. This is what the component's `DestroyRef` triggers.

## Disposal

`create*()` registers the handle with the surrounding `DestroyRef`, so a handle declared as a component field is destroyed with that component: the model is released, and any later `load()` or `run()` rejects rather than downloading a model nobody would free. If a download is still in flight at that point, it is cancelled: the model is released as soon as it arrives, the handle stays `idle`, and a `run()` that was waiting on it rejects.

Call `dispose()` yourself to free memory early, for example after a one-off job, or when a service outlives the page that used the model. Unlike `destroy()`, a disposed handle loads again on the next call.

## Concurrency

Several `run()` calls can overlap; Transformers.js queues them on the runtime. The status stays `busy` until the last one finishes, and `runError` belongs to the most recently started run. `load()` called from several places at once starts one download and shares it. To avoid the queue when inputs change quickly, pass the abort signal as described above; [`inferenceResource()`](./reactive-inference) hands you one.

## Where it runs

Inference happens on the main thread by default. The default models return in tens to hundreds of milliseconds; Whisper, translation and text generation can take seconds per call on WebAssembly, during which the page is less responsive. Two remedies: [Web Workers](./web-workers) move every pipeline off the main thread with one provider, and WebGPU is several times faster where available, see [Device selection](./configuration#device-selection).

## Server-side rendering

Creating handles on the server is safe because nothing runs until `load()` or `run()`. Those need a browser (WebAssembly or WebGPU, and `AudioContext` for audio decoding), so call them only in browser code paths, for example behind `afterNextRender()` or an `isPlatformBrowser()` check. `hasWebGpu()` and `detectDevice()` resolve to the WebAssembly answer on the server.

## Model caching

Transformers.js stores downloaded files in the browser Cache API, keyed by URL, so a model is downloaded once per origin. Users can clear it with their site data. To serve models from your own host, or to disallow remote downloads entirely, see [Hosting models yourself](./models#hosting-models-yourself).
