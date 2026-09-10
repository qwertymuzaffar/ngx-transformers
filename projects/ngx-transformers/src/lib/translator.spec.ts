import { TestBed } from '@angular/core/testing';
import type { NgxTransformersConfig, TranslatorOptions } from './transformers.models';
import { PIPELINE_FACTORY, provideTransformers, type PipelineFactory, type PipelineLike } from './transformers.providers';
import { createTranslator, defaultTranslationModel, resolveTranslationModel, Translator } from './translator';

function translatorWith(output: unknown, options: TranslatorOptions = {}, config?: NgxTransformersConfig) {
  const calls: { task: string; model?: string; options?: Record<string, unknown> }[] = [];
  const runCalls: unknown[][] = [];
  let disposed = 0;
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, model, options });
    const pipe = (async (...args: unknown[]) => {
      runCalls.push(args);
      return output;
    }) as PipelineLike;
    pipe.dispose = async () => {
      disposed++;
    };
    return pipe;
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: PIPELINE_FACTORY, useValue: factory }, ...(config ? [provideTransformers(config)] : [])],
  });
  const translator = TestBed.runInInjectionContext(() => createTranslator(options));
  return { translator, calls, runCalls, disposed: () => disposed };
}

describe('Translator', () => {
  it('resolves the opus-mt checkpoint from the pair given at creation', async () => {
    const { translator, calls } = translatorWith([{ translation_text: 'x' }], { from: 'en', to: 'ru' });
    await translator.load();
    expect(calls[0].task).toBe('translation');
    expect(calls[0].model).toBe('Xenova/opus-mt-en-ru');
  });

  it('translate() returns the trimmed text and sends no language codes to opus-mt', async () => {
    const { translator, runCalls } = translatorWith([{ translation_text: '  Привет.  ' }], { from: 'en', to: 'ru' });
    expect(await translator.translate('Hello')).toBe('Привет.');
    expect(runCalls[0]).toEqual(['Hello', {}]);
  });

  it('unwraps a bare object result and tolerates empty output', async () => {
    const bare = translatorWith({ translation_text: 'Hallo' }, { from: 'en', to: 'de' });
    expect(await bare.translator.translate('Hello')).toBe('Hallo');
    const empty = translatorWith([], { from: 'en', to: 'de' });
    expect(await empty.translator.translate('Hello')).toBe('');
  });

  it('a per-call pair gets its own model and the signals follow the active one', async () => {
    const { translator, calls } = translatorWith([{ translation_text: 'x' }], { from: 'en', to: 'ru' });
    expect(translator.status()).toBe('idle');
    await translator.translate('Hi', { to: 'de' });
    expect(calls.map((call) => call.model)).toEqual(['Xenova/opus-mt-en-de']);
    expect(translator.status()).toBe('ready');
    await translator.translate('Hi');
    expect(calls.map((call) => call.model)).toEqual(['Xenova/opus-mt-en-de', 'Xenova/opus-mt-en-ru']);
    expect(translator.handleFor({ to: 'de' })).not.toBe(translator.handleFor({}));
    // a third call for a known pair reuses its handle
    await translator.translate('Hi', { to: 'de' });
    expect(calls).toHaveLength(2);
  });

  it('provideTransformers({ translationModels }) overrides the checkpoint for a pair', async () => {
    const { translator, calls } = translatorWith(
      [{ translation_text: 'x' }],
      { from: 'en', to: 'ru' },
      { translationModels: { 'en-ru': 'my-org/en-ru-tiny' } },
    );
    await translator.translate('Hi');
    await translator.translate('Hi', { to: 'fr' });
    expect(calls.map((call) => call.model)).toEqual(['my-org/en-ru-tiny', 'Xenova/opus-mt-en-fr']);
  });

  it('a pinned multilingual model serves every pair and receives src_lang / tgt_lang', async () => {
    const { translator, calls, runCalls } = translatorWith([{ translation_text: 'x' }], {
      model: 'Xenova/nllb-200-distilled-600M',
    });
    await translator.translate('Hi', { from: 'eng_Latn', to: 'rus_Cyrl' });
    await translator.translate('Hi', { from: 'eng_Latn', to: 'deu_Latn' });
    expect(calls).toHaveLength(1);
    expect(runCalls).toEqual([
      ['Hi', { src_lang: 'eng_Latn', tgt_lang: 'rus_Cyrl' }],
      ['Hi', { src_lang: 'eng_Latn', tgt_lang: 'deu_Latn' }],
    ]);
  });

  it('a pinned opus-mt model still gets no language codes', async () => {
    const { translator, runCalls } = translatorWith([{ translation_text: 'x' }], {
      model: 'Xenova/opus-mt-en-de',
      from: 'en',
      to: 'de',
    });
    await translator.translate('Hi');
    expect(runCalls[0]).toEqual(['Hi', {}]);
  });

  it('throws a clear error without a pair or a pinned model', async () => {
    const { translator, calls } = translatorWith([{ translation_text: 'x' }]);
    expect(() => translator.handleFor()).toThrow(/language pair/);
    await expect(translator.translate('Hi', { from: 'en' })).rejects.toThrow(/language pair/);
    expect(calls).toHaveLength(0);
  });

  it('forwards device, dtype and options from creation to every handle', async () => {
    const { translator, calls } = translatorWith([{ translation_text: 'x' }], {
      from: 'en',
      to: 'ru',
      dtype: 'q4',
      options: { cache_dir: '/models' },
    });
    await translator.load();
    await translator.load({ to: 'de' });
    expect(calls.map((call) => call.options?.['dtype'])).toEqual(['q4', 'q4']);
    expect(calls[1].options?.['cache_dir']).toBe('/models');
  });

  it('dispose() frees every model and resets the signals; the translator works again', async () => {
    const { translator, calls, disposed } = translatorWith([{ translation_text: 'x' }], { from: 'en', to: 'ru' });
    await translator.translate('Hi');
    await translator.translate('Hi', { to: 'de' });
    await translator.dispose();
    expect(disposed()).toBe(2);
    expect(translator.status()).toBe('idle');
    expect(translator.progress()).toBeNull();
    await translator.translate('Hi');
    expect(calls).toHaveLength(3);
  });

  it('is exported with its resolver helpers', () => {
    const { translator } = translatorWith([]);
    expect(translator).toBeInstanceOf(Translator);
    expect(defaultTranslationModel('en', 'ru')).toBe('Xenova/opus-mt-en-ru');
    expect(resolveTranslationModel('en', 'ru', {})).toBe('Xenova/opus-mt-en-ru');
    expect(resolveTranslationModel('en', 'ru', { translationModels: { 'en-ru': 'custom' } })).toBe('custom');
  });
});
