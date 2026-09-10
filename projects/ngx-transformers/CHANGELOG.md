# ngx-transformers

## 0.3.0

### Minor Changes

- 8062311: Add `createZeroShotClassifier()` (`classify(text, labels, { multiLabel, hypothesisTemplate })`, MobileBERT MNLI by default) and `createTranslator()` (`translate(text, { from, to })` with one lazily loaded opus-mt model per language pair, multilingual checkpoints supported through `src_lang` / `tgt_lang`, pair-to-model overrides via `provideTransformers({ translationModels })`). `PipelineHandle` gains a protected `runWith()` for tasks that take positional arguments beyond the input.

### Patch Changes

- 19e318f: Add `hasWebGpu()` and `detectDevice()`, a cached WebGPU probe that also requests an adapter and resolves to the WASM answer on the server, plus an `autoDevice` option for `provideTransformers()` that picks `'webgpu'` when available for every handle without an explicit device.

## 0.2.1

### Patch Changes

- 5f543b9: Releases are now automated with Changesets and published from GitHub Actions with provenance.
