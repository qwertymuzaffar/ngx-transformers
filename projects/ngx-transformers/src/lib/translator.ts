import { DestroyRef, computed, inject, signal } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { NgxTransformersConfig, TranslateOptions, TranslatorOptions } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY, type PipelineFactory } from './transformers.providers';

/**
 * Default checkpoint for a language pair: Helsinki-NLP's Marian opus-mt
 * models, one per direction, ~105 MB q8 each (e.g. Xenova/opus-mt-en-ru).
 */
export function defaultTranslationModel(from: string, to: string): string {
  return `Xenova/opus-mt-${from}-${to}`;
}

/** Checkpoint for a pair: provideTransformers({ translationModels }) first, then opus-mt. */
export function resolveTranslationModel(from: string, to: string, config: NgxTransformersConfig): string {
  return config.translationModels?.[`${from}-${to}`] ?? defaultTranslationModel(from, to);
}

/**
 * Multilingual families take the pair per call as src_lang / tgt_lang;
 * Marian opus-mt checkpoints translate one fixed direction and ignore them.
 */
const MULTILINGUAL_MODEL_PATTERN = /nllb|m2m[_-]?100|mbart|madlad/i;

/** Raw translation pipeline output, one entry per input text. */
interface RawTranslation {
  translation_text?: string;
}

export type TranslationHandle = PipelineHandle<string, RawTranslation | RawTranslation[]>;

/**
 * Text translation. Pipelines are created lazily, one per checkpoint: with
 * the default opus-mt family every language pair is its own model, so a
 * Translator holds one handle per pair it has been asked for, while a
 * pinned multilingual `model` (NLLB, M2M100) serves every pair from one.
 *
 * The signals mirror the handle used by the most recent call, so a single
 * `<ngx-model-progress>` covers the translator.
 */
export class Translator {
  private readonly active = signal<TranslationHandle | null>(null);
  private readonly handles = new Map<string, TranslationHandle>();

  readonly status = computed(() => this.active()?.status() ?? 'idle');
  readonly progress = computed(() => this.active()?.progress() ?? null);
  readonly error = computed(() => this.active()?.error() ?? null);
  readonly ready = computed(() => this.active()?.ready() ?? false);
  readonly busy = computed(() => this.active()?.busy() ?? false);

  constructor(
    private readonly options: TranslatorOptions,
    private readonly factory: PipelineFactory,
    private readonly config: NgxTransformersConfig,
  ) {}

  /** Downloads the model for a pair ahead of the first translate() call. */
  load(pair: TranslateOptions = {}): Promise<void> {
    return this.handleFor(pair).load();
  }

  /** Translates one text; the pair defaults to the one given at creation. */
  async translate(text: string, pair: TranslateOptions = {}): Promise<string> {
    const handle = this.handleFor(pair);
    const raw = await handle.run(text, this.languageOptions(pair));
    const first = Array.isArray(raw) ? raw[0] : raw;
    return (first?.translation_text ?? '').trim();
  }

  /** Checkpoint for a pair: the pinned model, else the configured or default one. */
  modelFor(pair: TranslateOptions = {}): string {
    if (this.options.model) return this.options.model;
    const from = pair.from ?? this.options.from;
    const to = pair.to ?? this.options.to;
    if (!from || !to) {
      throw new Error(
        'Translator: no language pair - pass { from, to } to createTranslator() or translate(), or pin a multilingual model.',
      );
    }
    return resolveTranslationModel(from, to, this.config);
  }

  /**
   * The handle serving a pair, created on first use. Exposed for apps that
   * keep several pairs warm and want a progress line per model.
   */
  handleFor(pair: TranslateOptions = {}): TranslationHandle {
    const model = this.modelFor(pair);
    let handle = this.handles.get(model);
    if (!handle) {
      handle = new PipelineHandle(
        { task: 'translation', model, device: this.options.device, dtype: this.options.dtype, options: this.options.options },
        this.factory,
        this.config,
      );
      this.handles.set(model, handle);
    }
    this.active.set(handle);
    return handle;
  }

  /** Frees every model. The translator can be used again afterwards. */
  async dispose(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    this.active.set(null);
    await Promise.all(handles.map((handle) => handle.dispose()));
  }

  /** src_lang / tgt_lang for multilingual checkpoints; opus-mt models get nothing. */
  private languageOptions(pair: TranslateOptions): Record<string, unknown> {
    const runOptions: Record<string, unknown> = {};
    if (!MULTILINGUAL_MODEL_PATTERN.test(this.modelFor(pair))) return runOptions;
    const from = pair.from ?? this.options.from;
    const to = pair.to ?? this.options.to;
    if (from !== undefined) runOptions['src_lang'] = from;
    if (to !== undefined) runOptions['tgt_lang'] = to;
    return runOptions;
  }
}

/** Creates a Translator in an injection context. */
export function createTranslator(options: TranslatorOptions = {}): Translator {
  const translator = new Translator(options, inject(PIPELINE_FACTORY), inject(NGX_TRANSFORMERS_CONFIG));
  inject(DestroyRef, { optional: true })?.onDestroy(() => void translator.dispose());
  return translator;
}
