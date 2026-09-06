import { DestroyRef, inject } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { PipelineRequest, RankedResult } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY } from './transformers.providers';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Tensor-ish output of feature-extraction: enough shape to read rows. */
interface TensorLike {
  dims: number[];
  data: ArrayLike<number>;
  tolist?: () => number[][];
}

/** Cosine similarity of two vectors. For normalized vectors this is the dot product. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`cosineSimilarity: incompatible lengths ${a.length} and ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Sentence embeddings via feature-extraction (all-MiniLM-L6-v2 by default,
 * ~23 MB q8). Outputs mean-pooled, L2-normalized vectors ready for cosine
 * similarity / semantic search.
 */
export class TextEmbedder extends PipelineHandle<string | string[], TensorLike> {
  /** Embeds one or many texts; always resolves to one vector per text. */
  async embed(texts: string | string[]): Promise<number[][]> {
    const input = Array.isArray(texts) ? texts : [texts];
    if (input.length === 0) return [];
    const out = await this.run(input, { pooling: 'mean', normalize: true });
    return toRows(out);
  }

  /** Cosine similarity of two texts in [-1, 1]. */
  async similarity(a: string, b: string): Promise<number> {
    const [va, vb] = await this.embed([a, b]);
    return cosineSimilarity(va, vb);
  }

  /** Ranks documents against a query, most similar first. */
  async rank(query: string, documents: string[]): Promise<RankedResult[]> {
    if (documents.length === 0) return [];
    const [queryVec, ...docVecs] = await this.embed([query, ...documents]);
    return docVecs
      .map((vec, index) => ({ text: documents[index], score: cosineSimilarity(queryVec, vec), index }))
      .sort((a, b) => b.score - a.score);
  }
}

function toRows(out: TensorLike): number[][] {
  if (typeof out.tolist === 'function') return out.tolist();
  const [rows, cols] = out.dims.length === 2 ? out.dims : [1, out.dims[out.dims.length - 1]];
  const data = out.data;
  const result: number[][] = [];
  for (let r = 0; r < rows; r++) {
    result.push(Array.from({ length: cols }, (_, c) => data[r * cols + c]));
  }
  return result;
}

/** Creates a TextEmbedder in an injection context. */
export function createTextEmbedder(options: Partial<Omit<PipelineRequest, 'task'>> = {}): TextEmbedder {
  const embedder = new TextEmbedder(
    { task: 'feature-extraction', model: DEFAULT_EMBEDDING_MODEL, ...options },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void embedder.dispose());
  return embedder;
}
