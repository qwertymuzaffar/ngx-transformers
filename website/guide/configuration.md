# Configuration

Defaults come from `provideTransformers()` at bootstrap; each handle can override them.

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideTransformers } from 'ngx-transformers';

bootstrapApplication(App, {
  providers: [provideTransformers({ autoDevice: true, dtype: 'q8' })],
});
```

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `device` | `'wasm' \| 'webgpu' \| 'auto'` | unset (Transformers.js picks WebAssembly) | Runtime for every handle without its own `device`. |
| `autoDevice` | `boolean` | `false` | Probe WebGPU once and use it when available, for handles whose device is unset or `'auto'`. |
| `dtype` | `TransformersDtype` | unset (Transformers.js picks per model) | Quantization for every handle without its own `dtype`: `fp32`, `fp16`, `q8`, `int8`, `uint8`, `q4`, `bnb4` or `q4f16`. |
| `pipelineOptions` | `Record<string, unknown>` | `{}` | Extra options forwarded to every `pipeline()` call, such as `revision` or `local_files_only`. |
| `translationModels` | `Record<string, string>` | `{}` | Checkpoint per language pair for `createTranslator()`, keyed `"from-to"`. |

Per-handle options win: `createTextClassifier({ device: 'wasm', dtype: 'fp32', options: { revision: 'v2' } })`. A handle's `options` are merged over the global `pipelineOptions`.

## Device selection

Transformers.js runs on WebAssembly everywhere and on WebGPU where the browser and GPU support it, which is several times faster. `navigator.gpu` existing is not enough: `requestAdapter()` can still return nothing on a machine without a usable GPU, so the library probes properly.

- `hasWebGpu()` resolves `true` when an adapter is available. It is probed once and cached; `resetDeviceDetection()` clears the cache.
- `detectDevice()` turns that into `'webgpu'` or `'wasm'`.
- `provideTransformers({ autoDevice: true })` runs the probe for every handle without an explicit device, at load time.

Both helpers resolve to the WebAssembly answer on the server.

```ts
import { createTextClassifier, detectDevice } from 'ngx-transformers';

const device = await detectDevice(); // 'webgpu' | 'wasm'
const classifier = createTextClassifier({ device });
```

Some checkpoints still have WebGPU issues in the ONNX runtime. If a model misbehaves on the GPU, pin `device: 'wasm'` on that handle; an explicit device always wins over `autoDevice`.

## Choosing a dtype

| dtype | Use it when |
| --- | --- |
| `q8` | The usual choice on WebAssembly: a quarter of the fp32 size with negligible accuracy loss. |
| `q4` | Whisper on the v4 WebAssembly runtime (`createSpeechRecognizer()` defaults to it), and large decoders where download size matters. |
| `fp16` | WebGPU. Half the size of fp32 and fast on the GPU; the WebAssembly backend does not run fp16 models. |
| `q4f16` | WebGPU with a large decoder: 4-bit weights, half-precision activations. |
| `fp32` | Reference accuracy, or a checkpoint that ships no quantized weights. |

A model repository must contain weights for the dtype you ask for (`onnx/model_quantized.onnx` for q8, `onnx/model_q4.onnx` for q4, and so on). The `Xenova` and `onnx-community` organisations on the Hub publish the common variants.

## The pipeline factory

Every handle asks the `PIPELINE_FACTORY` injection token for its pipeline. The default, `createDefaultPipelineFactory()`, imports `@huggingface/transformers` lazily and calls `pipeline(task, model, options)`. Provide your own to:

- add options or logging around every pipeline,
- configure the Transformers.js `env` (model host, cache) before the first pipeline, see [Hosting models yourself](./models#hosting-models-yourself),
- route inference to a Web Worker, which [`provideTransformersWorker()`](./web-workers) does for you,
- return a stub in tests, see [Testing](./testing).

```ts
import { PIPELINE_FACTORY, createDefaultPipelineFactory, type PipelineFactory } from 'ngx-transformers';

const base = createDefaultPipelineFactory();
const logging: PipelineFactory = (task, model, options) => {
  console.log('loading', task, model, options);
  return base(task, model, options);
};

bootstrapApplication(App, {
  providers: [{ provide: PIPELINE_FACTORY, useValue: logging }],
});
```

The factory receives the merged options, including `progress_callback`, `device` and `dtype`, and returns the pipeline callable: anything with the shape of `PipelineLike`, a function of `(input, options?)` with an optional `dispose()`.

## Translation checkpoints

`createTranslator({ from, to })` resolves `Xenova/opus-mt-{from}-{to}` by default. Override single pairs for the whole app:

```ts
provideTransformers({ translationModels: { 'en-ru': 'my-org/en-ru-tiny' } });
```

Or pin one multilingual model on the handle; see [Translation](./translation#multilingual-models).
