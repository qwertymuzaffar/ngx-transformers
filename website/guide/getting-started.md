# Getting started

ngx-transformers runs [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) models inside an Angular app: text classification, zero-shot classification, sentence embeddings and semantic search, translation, and Whisper speech-to-text, all executed in the browser on WebAssembly or WebGPU.

## Install

```sh
npm install ngx-transformers @huggingface/transformers
```

| Requirement | Version |
| --- | --- |
| Angular | 22 or newer |
| `@huggingface/transformers` | 4.x, a peer dependency the library never bundles |
| Browser | Anything with WebAssembly; WebGPU is used when available |

The library imports `@huggingface/transformers` lazily, on the first pipeline, so it adds nothing to your initial bundle.

## Your first model

```ts
import { Component, signal } from '@angular/core';
import { createTextClassifier, ModelProgressComponent } from 'ngx-transformers';

@Component({
  selector: 'app-sentiment',
  imports: [ModelProgressComponent],
  template: `
    <textarea #box></textarea>
    <button (click)="analyze(box.value)" [disabled]="classifier.busy()">Analyze</button>
    <ngx-model-progress [status]="classifier.status()" [progress]="classifier.progress()" />
    @if (label(); as l) {
      <strong>{{ l }}</strong>
    }
  `,
})
export class SentimentComponent {
  readonly classifier = createTextClassifier(); // nothing downloads yet
  readonly label = signal<string | null>(null);

  async analyze(text: string) {
    const [top] = await this.classifier.classify(text); // downloads the model on the first call
    this.label.set(`${top.label} ${(top.score * 100).toFixed(1)}%`);
  }
}
```

What happens:

1. `createTextClassifier()` creates a handle and registers it for disposal with the component. No network request yet.
2. The first `classify()` downloads DistilBERT SST-2 (about 65 MB, 8-bit) from the Hugging Face Hub. The `status` signal moves from `idle` to `loading`, and `progress` reports each file.
3. The browser caches the model files, so the next page load skips the download.
4. Further calls run in place; `status` toggles between `ready` and `busy`.
5. When the component is destroyed, the model is released.

## The create functions

Every task has a `create*()` function that returns a handle with the same lifecycle:

| Function | Handle | Main method |
| --- | --- | --- |
| `createTextClassifier()` | `TextClassifier` | `classify(text, topK?)` |
| `createZeroShotClassifier()` | `ZeroShotClassifier` | `classify(text, labels, options?)` |
| `createTextEmbedder()` | `TextEmbedder` | `embed()`, `similarity()`, `rank()` |
| `createTranslator()` | `Translator` | `translate(text, { from?, to? })` |
| `createSpeechRecognizer()` | `SpeechRecognizer` | `transcribe(audio, options?)` |
| `createMicRecorder()` | `MicRecorder` | `start()`, `stop()` |
| `createPipeline()` | `PipelineHandle` | `run(input, options?)` for any other task |

They must run in an [injection context](https://angular.dev/guide/di/dependency-injection-context): a field initializer, a constructor, or `runInInjectionContext()`. Each takes an options object to change the model, device or dtype for that handle, for example `createTextClassifier({ model: 'Xenova/bert-base-multilingual-uncased-sentiment' })`.

## Showing progress

`<ngx-model-progress>` is a status line with a download bar. Bind it to any handle:

```html
<ngx-model-progress [status]="handle.status()" [progress]="handle.progress()" />
```

It shows the file being downloaded and the percentage while loading, then the ready, busy or error state. Override the text through the `labels` input and the colors through the `--nt-accent`, `--nt-ink`, `--nt-muted` and `--nt-track` custom properties. Or read the signals and render your own; see [Concepts](./concepts#signals).

## Preloading

Call `load()` to download ahead of the first use, for example when the page opens or when the user hovers a button:

```ts
ngOnInit() {
  void this.classifier.load();
}
```

`load()` is idempotent: concurrent calls share one download, and calling it again once the model is ready resolves immediately.

## Next

- [Concepts](./concepts): the handle lifecycle, signals, disposal and server rendering.
- [Configuration](./configuration): device and dtype defaults, WebGPU detection, custom pipeline factories.
- One page per task under Tasks in the sidebar.
