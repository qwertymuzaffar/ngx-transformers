/** Lifecycle of a model pipeline. `error` is terminal until load() is retried. */
export type PipelineStatus = 'idle' | 'loading' | 'ready' | 'busy' | 'error';

/** Download progress for one model file, mapped from Transformers.js callbacks. */
export interface ModelProgress {
  /** File currently downloading, e.g. "onnx/model_quantized.onnx". */
  file: string;
  /** 0-100 for the current file. */
  progress: number;
  loadedBytes: number;
  totalBytes: number;
}

export type TransformersDevice = 'wasm' | 'webgpu' | 'auto';
export type TransformersDtype = 'fp32' | 'fp16' | 'q8' | 'q4';

/** Global defaults applied to every pipeline; see provideTransformers(). */
export interface NgxTransformersConfig {
  device?: TransformersDevice;
  dtype?: TransformersDtype;
  /** Extra options forwarded verbatim to every pipeline() call. */
  pipelineOptions?: Record<string, unknown>;
}

/** Per-pipeline request; wins over the global config where both are set. */
export interface PipelineRequest {
  task: string;
  /** Hugging Face model id; each task wrapper provides a sensible default. */
  model?: string;
  device?: TransformersDevice;
  dtype?: TransformersDtype;
  options?: Record<string, unknown>;
}

export interface ClassificationResult {
  label: string;
  score: number;
}

/** One scored document from TextEmbedder.rank(). */
export interface RankedResult {
  text: string;
  /** Cosine similarity in [-1, 1]; higher is more similar. */
  score: number;
  /** Index of the document in the input list. */
  index: number;
}
