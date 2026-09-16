# Text generation

`createTextGenerator()` runs a small language model in the browser and streams its reply token by token. The default checkpoint is SmolLM2-135M-Instruct (~100 MB at q4), the smallest model that holds a conversation; swap `model` for a larger one when the device allows.

```ts
import { createTextGenerator } from 'ngx-transformers';

readonly generator = createTextGenerator(); // HuggingFaceTB/SmolLM2-135M-Instruct, q4

const reply = await this.generator.generate(
  [{ role: 'user', content: 'Explain what a signal is in Angular, in two sentences.' }],
  { maxNewTokens: 120 },
);
```

Try it: <SiteLink to="/storybook/?path=/story/transformers-ngxtransformers--text-generation-live">text generation story</SiteLink>.

## Streaming

While the model runs, `output` holds the text generated so far, so a template can show the reply as it forms:

```html
<button (click)="ask(box.value)" [disabled]="generator.busy()">Ask</button>
<ngx-model-progress [status]="generator.status()" [progress]="generator.progress()" />
<p>{{ generator.output() }}</p>
```

`onToken` receives each piece as it arrives, for example to scroll a chat log. Streaming works in-thread and in a [Web Worker](./web-workers) alike.

## API

`generate(prompt, options?)` takes a plain string or a chat (`ChatMessage[]` with `system`, `user` and `assistant` turns; the model's chat template is applied) and resolves to the trimmed reply.

| Option | Default | Effect |
| --- | --- | --- |
| `maxNewTokens` | `256` | Upper bound on the reply length. |
| `doSample` | model default | Sample instead of greedy decoding; pair with the three below. |
| `temperature`, `topP`, `topK` | model defaults | Sampling parameters. |
| `repetitionPenalty` | model default | Above 1 discourages repeating tokens. |
| `onToken` | none | Called with each generated piece of text. |
| `signal` | none | An `AbortSignal`; a call whose signal has fired before the model is ready rejects instead of running. |

The handle is a `PipelineHandle`, so it has the usual signals plus `output`. When two calls overlap, only the most recently started one writes `output`; the earlier call still resolves with its own reply. Streaming needs the pipeline factory to honour `onToken`, which the built-in factories do; with a custom factory that returns a raw pipeline the reply arrives whole and the generator warns once, see [Configuration](./configuration#the-pipeline-factory).

## A chat with memory

A chat is the same call with the conversation so far as the prompt. Small models have small context windows, so the history has to be budgeted. [memoryline](https://www.npmjs.com/package/memoryline) keeps recent turns verbatim, folds older ones into a running summary with a model call you control, and hands back messages in the shape `generate()` accepts:

```ts
import { createMemory, summaryPrompt, toOpenAI } from 'memoryline';
import { createTextGenerator, type ChatMessage } from 'ngx-transformers';

readonly generator = createTextGenerator();
readonly memory = createMemory({
  budget: { maxTokens: 1500, keepRecent: 6 },
  summarize: (input) => this.generator.generate(summaryPrompt(input), { maxNewTokens: 160 }),
});
readonly session = this.memory.session('local');

async send(text: string) {
  await this.session.add({ role: 'user', content: text });
  const ctx = await this.session.context();
  const messages = toOpenAI(ctx, { systemPrompt: 'You are a concise assistant.' }) as ChatMessage[];
  const reply = await this.generator.generate(messages, { maxNewTokens: 160 });
  await this.session.add({ role: 'assistant', content: reply });
}
```

`toOpenAI()` returns `{ role, content }` messages, which is also the Transformers.js chat format. Give the memory `embed: (texts) => this.embedder.embed(texts)` and it can recall folded turns by meaning as well.

## Models

| Model | Size (q4) | Notes |
| --- | --- | --- |
| `HuggingFaceTB/SmolLM2-135M-Instruct` (default) | ~100 MB | Fast everywhere; short, simple replies |
| `HuggingFaceTB/SmolLM2-360M-Instruct` | ~250 MB | Noticeably better answers |
| `onnx-community/Qwen2.5-0.5B-Instruct` | ~400 MB | A capable assistant; WebGPU recommended |

On WebGPU larger models become practical and `dtype: 'q4f16'` keeps activations in half precision; on WebAssembly stay small and expect a few tokens per second.
