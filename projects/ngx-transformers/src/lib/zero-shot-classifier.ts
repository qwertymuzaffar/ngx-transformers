import { DestroyRef, inject } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { ClassificationResult, PipelineRequest, ZeroShotOptions } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY } from './transformers.providers';

// The Transformers.js docs example for this task and the smallest MNLI
// checkpoint that behaves well on the WASM runtime (~26 MB q8).
export const DEFAULT_ZERO_SHOT_MODEL = 'Xenova/mobilebert-uncased-mnli';

/** Raw zero-shot output: labels ordered by score, scores aligned by index. */
interface RawZeroShotResult {
  sequence: string;
  labels: string[];
  scores: number[];
}

/**
 * Zero-shot classification: score any labels you name against a text with
 * an NLI model, no fine-tuning. The default checkpoint is MobileBERT MNLI
 * (~26 MB q8); Xenova/distilbert-base-uncased-mnli (~80 MB) is the
 * higher-accuracy alternative.
 */
export class ZeroShotClassifier extends PipelineHandle<string, RawZeroShotResult | RawZeroShotResult[]> {
  /**
   * Scores each candidate label for one text; resolves sorted by score (top
   * first). Single-label mode (default) normalizes across labels so scores
   * sum to 1; `multiLabel` scores each label on its own.
   */
  async classify(text: string, labels: readonly string[], options: ZeroShotOptions = {}): Promise<ClassificationResult[]> {
    if (labels.length === 0) return [];
    const runOptions: Record<string, unknown> = {};
    if (options.multiLabel !== undefined) runOptions['multi_label'] = options.multiLabel;
    if (options.hypothesisTemplate !== undefined) runOptions['hypothesis_template'] = options.hypothesisTemplate;

    const raw = await this.runWith(text, [...labels], runOptions);
    const first = Array.isArray(raw) ? raw[0] : raw;
    const scoredLabels = first?.labels ?? [];
    const scores = first?.scores ?? [];
    return scoredLabels
      .map((label, index) => ({ label, score: scores[index] ?? 0 }))
      .sort((left, right) => right.score - left.score);
  }
}

/** Creates a ZeroShotClassifier in an injection context. */
export function createZeroShotClassifier(options: Partial<Omit<PipelineRequest, 'task'>> = {}): ZeroShotClassifier {
  const classifier = new ZeroShotClassifier(
    { task: 'zero-shot-classification', model: DEFAULT_ZERO_SHOT_MODEL, ...options },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void classifier.dispose());
  return classifier;
}
