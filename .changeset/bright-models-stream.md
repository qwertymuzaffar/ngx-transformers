---
'ngx-transformers': minor
---

- **Web Worker inference.** `provideTransformersWorker()` and the new `ngx-transformers/worker` entry point (`runTransformersWorker()`, `createWorkerPipelineFactory()`) run every pipeline off the main thread with the same handles and signals; progress, streamed tokens and tensor results cross the boundary.
- **Text generation.** `createTextGenerator()` runs a small language model (SmolLM2-135M-Instruct by default) with token streaming: an `output` signal, an `onToken` callback, chat or plain prompts.
- **Reactive inference.** `inferenceResource()` runs a handle whenever an input signal changes, as an Angular resource with debounce and latest-wins.
- **Overall download progress.** `progress().overall` sums every file of a model and `<ngx-model-progress>` drives its bar with it, instead of jumping between files.
- **Run errors.** A `runError` signal on handles and the translator holds the error of the most recent run.
- `TransformersDtype` gains `int8`, `uint8`, `bnb4` and `q4f16`.
