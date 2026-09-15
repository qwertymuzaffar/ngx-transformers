# Models

Every wrapper ships with a default checkpoint chosen for size and quality on the WebAssembly runtime. Any Transformers.js-compatible checkpoint on the Hugging Face Hub can replace it.

## Defaults

| Wrapper | Model | Download | License |
| --- | --- | --- | --- |
| `createTextClassifier()` | [Xenova/distilbert-base-uncased-finetuned-sst-2-english](https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english) | ~65 MB (q8) | Apache-2.0 |
| `createTextEmbedder()` | [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | ~23 MB (q8) | Apache-2.0 |
| `createZeroShotClassifier()` | [Xenova/mobilebert-uncased-mnli](https://huggingface.co/Xenova/mobilebert-uncased-mnli) | ~26 MB (q8) | unlisted on the Hub (base MobileBERT: Apache-2.0) |
| `createTranslator()` | [Xenova/opus-mt-{from}-{to}](https://huggingface.co/models?search=Xenova/opus-mt) | ~105 MB per pair (q8) | varies per pair (Apache-2.0 or CC-BY-4.0) |
| `createSpeechRecognizer()` | [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en) | ~41 MB (q4) | Apache-2.0 |

Sizes are what the browser downloads once; the files are then served from the cache. Check the license of the checkpoint you ship: the library is MIT, the models are not.

## Swapping a checkpoint

```ts
readonly sentiment = createTextClassifier({ model: 'Xenova/bert-base-multilingual-uncased-sentiment' });
readonly embedder = createTextEmbedder({ model: 'Xenova/bge-small-en-v1.5' });
readonly whisper = createSpeechRecognizer({ model: 'onnx-community/whisper-small' });
```

What to look for on the Hub:

- The repository must contain ONNX weights in an `onnx/` folder. Repositories under [Xenova](https://huggingface.co/Xenova) and [onnx-community](https://huggingface.co/onnx-community) are converted for Transformers.js; others may need converting with the Transformers.js conversion script.
- The task must match the wrapper: a `text-classification` model for the classifier, `feature-extraction` for the embedder, and so on. The model card's pipeline tag says which.
- Pick a quantization the repository provides. Whisper defaults to q4 because 8-bit Whisper decoders currently fail on the v4 WebAssembly runtime ([transformers.js#1707](https://github.com/huggingface/transformers.js/issues/1707)).

## Hosting models yourself

By default Transformers.js fetches from `https://huggingface.co`. To serve models from your own origin (offline deployments, air-gapped networks, a CDN you control), configure its `env` before the first pipeline is created. A custom [pipeline factory](./configuration#the-pipeline-factory) is the right place, because it keeps the import lazy:

```ts
import { PIPELINE_FACTORY, createDefaultPipelineFactory } from 'ngx-transformers';

const selfHosted = createDefaultPipelineFactory(async () => {
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true; // off by default in browsers
  transformers.env.localModelPath = '/models/'; // /models/Xenova/all-MiniLM-L6-v2/onnx/...
  return transformers;
});

bootstrapApplication(App, {
  providers: [{ provide: PIPELINE_FACTORY, useValue: selfHosted }],
});
```

Copy each model repository into that folder with the same layout as on the Hub (`config.json`, `tokenizer.json`, the `onnx/` folder). To mirror the Hub instead, set `env.remoteHost` and `env.remotePathTemplate`; `env.useBrowserCache = false` disables the Cache API.

## Memory

A loaded model lives in WebAssembly or GPU memory until the handle is disposed. Declaring handles in a component, the usual pattern, frees them with the view. Keep a long-lived handle in a service only when you want the model to stay warm across routes, and call `dispose()` when it is no longer needed.
