import { DestroyRef, inject } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { ClassificationResult, PipelineRequest } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY } from './transformers.providers';

export const DEFAULT_TEXT_CLASSIFICATION_MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

/**
 * Text classification (sentiment by default). The default model is
 * DistilBERT SST-2 (~65 MB, q8) - swap `model` for any Transformers.js
 * compatible text-classification checkpoint.
 */
export class TextClassifier extends PipelineHandle<string, ClassificationResult[] | ClassificationResult[][]> {
  /** Classifies one text; resolves to labels sorted by score (top first). */
  async classify(text: string, topK = 1): Promise<ClassificationResult[]> {
    const out = await this.run(text, { top_k: topK });
    // Single input: transformers.js returns a flat array of {label, score}.
    const flat = (Array.isArray(out[0]) ? out[0] : out) as ClassificationResult[];
    return [...flat].sort((a, b) => b.score - a.score);
  }
}

/** Creates a TextClassifier in an injection context. */
export function createTextClassifier(options: Partial<Omit<PipelineRequest, 'task'>> = {}): TextClassifier {
  const classifier = new TextClassifier(
    { task: 'text-classification', model: DEFAULT_TEXT_CLASSIFICATION_MODEL, ...options },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void classifier.dispose());
  return classifier;
}
