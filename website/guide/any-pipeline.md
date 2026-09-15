# Any pipeline

`createPipeline()` exposes the whole Transformers.js task surface through the same handle: summarization, fill-mask, image classification, object detection, text generation, and every other task the [pipeline API](https://huggingface.co/docs/transformers.js/api/pipelines) lists.

```ts
import { createPipeline } from 'ngx-transformers';

readonly summarizer = createPipeline<string, { summary_text: string }[]>({
  task: 'summarization',
  model: 'Xenova/distilbart-cnn-6-6',
});

const [out] = await this.summarizer.run(longText, { max_new_tokens: 120 });
```

The two type parameters describe the pipeline's input and output. Transformers.js does not export per-task types the library could derive them from, so state them yourself from the pipeline docs. The second argument to `run()` is the pipeline's options object, passed as is.

## Examples

::: code-group

```ts [Fill mask]
readonly unmasker = createPipeline<string, { token_str: string; score: number }[]>({
  task: 'fill-mask',
  model: 'Xenova/bert-base-uncased',
});
const [best] = await this.unmasker.run('The capital of France is [MASK].');
```

```ts [Image classification]
readonly classifier = createPipeline<string, { label: string; score: number }[]>({
  task: 'image-classification',
  model: 'Xenova/vit-base-patch16-224',
});
const labels = await this.classifier.run(imageUrl, { top_k: 3 });
```

```ts [Object detection]
readonly detector = createPipeline<string, { label: string; score: number; box: object }[]>({
  task: 'object-detection',
  model: 'Xenova/detr-resnet-50',
});
const objects = await this.detector.run(imageUrl, { threshold: 0.9 });
```

```ts [Text generation]
type Message = { role: 'system' | 'user' | 'assistant'; content: string };

readonly generator = createPipeline<Message[], { generated_text: Message[] }[]>({
  task: 'text-generation',
  model: 'onnx-community/Qwen2.5-0.5B-Instruct',
  dtype: 'q4',
});
const [out] = await this.generator.run([{ role: 'user', content: 'Explain signals in one sentence.' }], {
  max_new_tokens: 64,
});
```

:::

Image tasks take a URL, a `Blob`, or a `RawImage`; audio tasks take a URL or 16 kHz samples, as described in [Speech to text](./speech-to-text#input).

## Pipelines with positional arguments

Most pipelines are called as `pipe(input, options)`, which is what `run()` does. A few take more positional arguments: question answering is `pipe(question, context)`, zero-shot classification is `pipe(text, labels, options)`. For those, subclass `PipelineHandle` and call the protected `runWith()`, which is how the built-in wrappers are written:

```ts
import { DestroyRef, inject } from '@angular/core';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY, PipelineHandle } from 'ngx-transformers';

interface Answer {
  answer: string;
  score: number;
}

export class QuestionAnswerer extends PipelineHandle<string, Answer> {
  ask(question: string, context: string): Promise<Answer> {
    return this.runWith(question, context); // extra arguments follow the input
  }
}

export function createQuestionAnswerer(): QuestionAnswerer {
  const handle = new QuestionAnswerer(
    { task: 'question-answering', model: 'Xenova/distilbert-base-uncased-distilled-squad' },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void handle.dispose());
  return handle;
}
```

The subclass gets the full lifecycle: signals, lazy loading, disposal with the component, and the global configuration.
