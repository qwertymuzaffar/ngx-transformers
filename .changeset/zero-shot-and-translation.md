---
'ngx-transformers': minor
---

Add `createZeroShotClassifier()` (`classify(text, labels, { multiLabel, hypothesisTemplate })`, MobileBERT MNLI by default) and `createTranslator()` (`translate(text, { from, to })` with one lazily loaded opus-mt model per language pair, multilingual checkpoints supported through `src_lang` / `tgt_lang`, pair-to-model overrides via `provideTransformers({ translationModels })`). `PipelineHandle` gains a protected `runWith()` for tasks that take positional arguments beyond the input.
