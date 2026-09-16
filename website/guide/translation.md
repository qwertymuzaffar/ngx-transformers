# Translation

`createTranslator()` translates text between languages. By default it uses Helsinki-NLP's Marian opus-mt checkpoints, one model per direction (~105 MB each, 8-bit), resolved from the language pair and downloaded on first use.

```ts
import { createTranslator } from 'ngx-transformers';

readonly translator = createTranslator({ from: 'en', to: 'ru' }); // Xenova/opus-mt-en-ru

const russian = await this.translator.translate('The model runs entirely in the browser.');
const german = await this.translator.translate('Good morning.', { to: 'de' }); // Xenova/opus-mt-en-de, its own download
```

Try it: <SiteLink to="/storybook/?path=/story/transformers-ngxtransformers--translation-live">translation story</SiteLink>.

## API

- `translate(text, { from?, to? })`: resolves to the translated string. The pair defaults to the one given at creation; a different pair uses, and loads, another model.
- `load(pair?)`: downloads the model for a pair ahead of time.
- `handleFor(pair?)`: the underlying `PipelineHandle` for a pair, for apps that keep several warm and want one progress line per model.
- `modelFor(pair?)`: the checkpoint id a pair resolves to.
- `dispose()`: frees every loaded model.

The translator's `status`, `progress`, `error`, `ready` and `busy` signals mirror the handle of the most recent call, so one `<ngx-model-progress>` covers every pair.

Language codes follow the checkpoint: ISO 639-1 for opus-mt (`en`, `de`, `ru`, `fr`, `es`, `zh`). A pair with no opus-mt model on the Hub fails to load; the [Xenova/opus-mt listing](https://huggingface.co/models?search=Xenova/opus-mt) shows what exists.

## Multilingual models

NLLB and M2M100 serve every pair from one model and take the codes per call as `src_lang` and `tgt_lang`. Pin the model and pass the pair on each call:

```ts
readonly translator = createTranslator({ model: 'Xenova/nllb-200-distilled-600M' });

await this.translator.translate(text, { from: 'eng_Latn', to: 'tgk_Cyrl' }); // FLORES-200 codes
await this.translator.translate(text, { from: 'eng_Latn', to: 'deu_Latn' }); // same model, no new download
```

The library recognises NLLB, M2M100, mBART and MADLAD checkpoints by name and forwards the codes only to those; opus-mt models translate one fixed direction and receive none.

NLLB-200 distilled 600M is roughly 600 MB at q8, so it suits apps that need many pairs rather than one.

## Overriding a pair

Point a pair at another checkpoint for the whole app:

```ts
provideTransformers({ translationModels: { 'en-ru': 'my-org/en-ru-tiny' } });
```

## Tips

- Sentences translate better than paragraphs. [chunklet](https://www.npmjs.com/package/chunklet)'s `chunkSentences(text, { maxTokens: 64 })` splits on real sentence boundaries (abbreviations included) into pieces you can translate in sequence and join back.
- The first call per pair pays the download; call `load({ to: 'de' })` early for pairs you know you will need.
