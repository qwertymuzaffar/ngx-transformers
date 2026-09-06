# ngx-transformers

[![npm version](https://img.shields.io/npm/v/ngx-transformers)](https://www.npmjs.com/package/ngx-transformers)
[![CI](https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml/badge.svg)](https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run Hugging Face [Transformers.js](https://github.com/huggingface/transformers.js) models in Angular - **on-device ML with a signals API**. Text classification, sentence embeddings, and semantic search that execute entirely in the browser: no server, no API key, works offline once the model is cached.

**[Live demo (Storybook)](https://qwertymuzaffar.github.io/ngx-transformers/)** - loads real models in your browser.

## Why

Transformers.js has a React tutorial and hooks ecosystem - Angular has nothing. This library closes that gap with idiomatic Angular: lazily-loaded pipelines wrapped in signals, DI-friendly configuration, automatic cleanup with the owning component, and a drop-in progress component for the model download.

## Install

```bash
npm i ngx-transformers @huggingface/transformers
```

`@huggingface/transformers` (v4) is a peer dependency. Angular >= 22.

## Quick start

```ts
import { Component, signal } from '@angular/core';
import { createTextClassifier, ModelProgressComponent } from 'ngx-transformers';

@Component({
  imports: [ModelProgressComponent],
  template: `
    <textarea #box></textarea>
    <button (click)="analyze(box.value)" [disabled]="classifier.busy()">Analyze</button>
    <ngx-model-progress [status]="classifier.status()" [progress]="classifier.progress()" />
    @if (label(); as l) { <strong>{{ l }}</strong> }
  `,
})
export class SentimentComponent {
  readonly classifier = createTextClassifier(); // no download yet - lazy
  readonly label = signal<string | null>(null);

  async analyze(text: string) {
    const [top] = await this.classifier.classify(text); // downloads model on first call
    this.label.set(`${top.label} ${(top.score * 100).toFixed(1)}%`);
  }
}
```

The model downloads on the first `classify()` call (with progress reported through the `progress` signal), is cached by the browser, and is disposed automatically when the component is destroyed.

## Semantic search

```ts
import { createTextEmbedder } from 'ngx-transformers';

readonly embedder = createTextEmbedder(); // all-MiniLM-L6-v2, ~23 MB q8

const ranked = await this.embedder.rank('how do I make my app faster?', docs);
// [{ text: 'Use trackBy and virtual scrolling...', score: 0.28, index: 2 }, ...]

const score = await this.embedder.similarity('car', 'automobile'); // ~0.8
const vectors = await this.embedder.embed(['one', 'two']); // number[][]
```

## Any pipeline

`createPipeline()` exposes the full Transformers.js task surface with the same signal lifecycle:

```ts
import { createPipeline } from 'ngx-transformers';

readonly summarizer = createPipeline<string, { summary_text: string }[]>({
  task: 'summarization',
  model: 'Xenova/distilbart-cnn-6-6',
});

const [out] = await this.summarizer.run(longText);
```

## Global configuration

```ts
import { provideTransformers } from 'ngx-transformers';

bootstrapApplication(App, {
  providers: [provideTransformers({ device: 'webgpu', dtype: 'q8' })],
});
```

Per-pipeline `device`/`dtype`/`options` win over the global config.

## API

### Handles

| Export | What it is |
|---|---|
| `createPipeline(request)` | Generic `PipelineHandle` for any Transformers.js task |
| `createTextClassifier(options?)` | `TextClassifier` - sentiment/classification, `classify(text, topK?)` |
| `createTextEmbedder(options?)` | `TextEmbedder` - `embed()`, `similarity()`, `rank()` |
| `cosineSimilarity(a, b)` | Standalone vector math helper |

All `create*` functions must run in an injection context (field initializer, constructor, or `runInInjectionContext`); handles are disposed with the surrounding component.

### PipelineHandle signals

| Signal | Type | Meaning |
|---|---|---|
| `status` | `'idle' \| 'loading' \| 'ready' \| 'busy' \| 'error'` | Lifecycle; `error` only from a failed load, retryable |
| `progress` | `ModelProgress \| null` | Download progress: `file`, `progress` (0-100), bytes |
| `error` | `unknown` | The load error, if any |
| `ready` / `busy` | `boolean` (computed) | Convenience for buttons and spinners |

### `<ngx-model-progress>`

Status line + download bar for any handle. Inputs: `status` (required), `progress`, `labels` (override per-status text). Themeable via `--nt-accent`, `--nt-ink`, `--nt-muted`, `--nt-track`.

## Default models

| Wrapper | Model | Size (q8) | License |
|---|---|---|---|
| `createTextClassifier` | [Xenova/distilbert-base-uncased-finetuned-sst-2-english](https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english) | ~65 MB | Apache-2.0 |
| `createTextEmbedder` | [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | ~23 MB | Apache-2.0 |

Swap any compatible checkpoint via `{ model: '...' }`. Check the license of the model you ship.

## SSR

Model loading is browser-only (WASM/WebGPU). Creating handles is safe on the server - nothing downloads until `load()`/`run()` - but call those only in browser code paths.

## Roadmap

- v0.2: speech-to-text (`createSpeechRecognizer`, Whisper) with mic capture helpers
- Zero-shot classification and translation wrappers
- WebGPU feature-detection helper

## License

MIT (c) Muzaffar Qosimov
