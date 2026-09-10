# ngx-transformers

[![npm version](https://img.shields.io/npm/v/ngx-transformers)](https://www.npmjs.com/package/ngx-transformers)
[![CI](https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml/badge.svg)](https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run Hugging Face [Transformers.js](https://github.com/huggingface/transformers.js) models in Angular - **on-device ML with a signals API**. Text classification, zero-shot classification, sentence embeddings, semantic search, translation, and Whisper speech-to-text that execute entirely in the browser: no server, no API key, works offline once the model is cached.

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

## Speech to text (v0.2)

Whisper, fully in the browser - the audio never leaves the device:

```ts
import { createMicRecorder, createSpeechRecognizer } from 'ngx-transformers';

readonly whisper = createSpeechRecognizer(); // whisper-tiny.en, ~41 MB q4
readonly mic = createMicRecorder();

// a URL, File/Blob, ArrayBuffer, or 16 kHz Float32Array:
const { text, chunks } = await this.whisper.transcribe(fileOrUrl, { returnTimestamps: true });

// dictation:
async toggle() {
  if (this.mic.recording()) {
    const audio = await this.mic.stop();            // encoded Blob
    const { text } = await this.whisper.transcribe(audio); // decoded + resampled for you
  } else {
    await this.mic.start();                          // asks for mic permission
  }
}
```

`MicRecorder` exposes `recording`, `seconds`, and `error` signals for the UI. `decodeAudio(blob)` is exported separately if you want the 16 kHz mono `Float32Array` yourself.

> Note: the recognizer defaults to `dtype: 'q4'` - q8 Whisper decoders currently fail on the v4 WASM runtime ([transformers.js#1707](https://github.com/huggingface/transformers.js/issues/1707)). Multilingual checkpoints (e.g. `onnx-community/whisper-tiny`) accept `language` and `task: 'translate'` options.

## Zero-shot classification

Score labels you name against a text, no fine-tuning - an NLI model judges whether "This example is {label}." follows from the text:

```ts
import { createZeroShotClassifier } from 'ngx-transformers';

readonly classifier = createZeroShotClassifier(); // mobilebert-uncased-mnli, ~26 MB q8

const scored = await this.classifier.classify(ticketText, ['billing', 'bug report', 'feature request']);
// [{ label: 'bug report', score: 0.91 }, { label: 'billing', score: 0.06 }, ...] - scores sum to 1

// several labels can apply at once - score each on its own:
const tags = await this.classifier.classify(text, ['food', 'repair', 'politics'], {
  multiLabel: true,
  hypothesisTemplate: 'This text is about {}.',
});
```

`Xenova/distilbert-base-uncased-mnli` (~80 MB) is the more accurate drop-in: `createZeroShotClassifier({ model: '...' })`.

## Translation

Marian opus-mt checkpoints, one per language pair (~105 MB q8 each), resolved from the pair and loaded on demand:

```ts
import { createTranslator } from 'ngx-transformers';

readonly translator = createTranslator({ from: 'en', to: 'ru' }); // Xenova/opus-mt-en-ru

const russian = await this.translator.translate('The model runs entirely in the browser.');
const german = await this.translator.translate('Good morning.', { to: 'de' }); // opus-mt-en-de, its own download
```

The translator's `status` / `progress` signals follow the model used by the latest call, so one `<ngx-model-progress>` covers every pair; `handleFor({ to: 'de' })` returns the underlying `PipelineHandle` when you want one per pair. Override the checkpoint for a pair globally with `provideTransformers({ translationModels: { 'en-ru': 'my-org/en-ru-tiny' } })`.

Multilingual checkpoints (NLLB, M2M100) serve every pair from one model and take the codes per call:

```ts
readonly translator = createTranslator({ model: 'Xenova/nllb-200-distilled-600M' });
await this.translator.translate(text, { from: 'eng_Latn', to: 'tgk_Cyrl' }); // src_lang / tgt_lang forwarded
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

Per-pipeline `device`/`dtype`/`options` win over the global config. `translationModels` maps a `"from-to"` pair to a checkpoint for `createTranslator()`.

## API

### Handles

| Export | What it is |
|---|---|
| `createPipeline(request)` | Generic `PipelineHandle` for any Transformers.js task |
| `createTextClassifier(options?)` | `TextClassifier` - sentiment/classification, `classify(text, topK?)` |
| `createTextEmbedder(options?)` | `TextEmbedder` - `embed()`, `similarity()`, `rank()` |
| `createSpeechRecognizer(options?)` | `SpeechRecognizer` - `transcribe(audio, options?)` with timestamps |
| `createZeroShotClassifier(options?)` | `ZeroShotClassifier` - `classify(text, labels, { multiLabel?, hypothesisTemplate? })` |
| `createTranslator(options?)` | `Translator` - `translate(text, { from?, to? })`, one model per pair, `handleFor(pair)` |
| `createMicRecorder(deps?)` | `MicRecorder` - mic capture with `recording`/`seconds`/`error` signals |
| `cosineSimilarity(a, b)` / `decodeAudio(blob)` | Standalone helpers |

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
| `createSpeechRecognizer` | [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en) | ~41 MB (q4) | Apache-2.0 |
| `createZeroShotClassifier` | [Xenova/mobilebert-uncased-mnli](https://huggingface.co/Xenova/mobilebert-uncased-mnli) | ~26 MB | unlisted on the Hub (base MobileBERT: Apache-2.0) |
| `createTranslator` | [Xenova/opus-mt-{from}-{to}](https://huggingface.co/models?search=Xenova/opus-mt) | ~105 MB per pair | varies per pair (Apache-2.0 or CC-BY-4.0) |

Swap any compatible checkpoint via `{ model: '...' }`. Check the license of the model you ship.

## SSR

Model loading is browser-only (WASM/WebGPU). Creating handles is safe on the server - nothing downloads until `load()`/`run()` - but call those only in browser code paths.

## Roadmap

- WebGPU feature-detection helper

## License

MIT (c) Muzaffar Qosimov
