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
  /**
   * Translation checkpoints per language pair, keyed "from-to" (e.g.
   * "en-ru"). Pairs not listed fall back to Xenova/opus-mt-{from}-{to}.
   */
  translationModels?: Record<string, string>;
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

/** One timestamped segment of a transcription. */
export interface TranscriptionChunk {
  text: string;
  /** Seconds from the start of the audio; null when the model omits it. */
  start: number | null;
  end: number | null;
}

export interface Transcription {
  text: string;
  /** Present when transcribe() was called with returnTimestamps. */
  chunks?: TranscriptionChunk[];
}

export interface TranscribeOptions {
  /** true for segment timestamps, 'word' for word-level. */
  returnTimestamps?: boolean | 'word';
  /** Split audio longer than ~30 s into chunks of this many seconds. */
  chunkLengthS?: number;
  /** Overlap between chunks, in seconds. */
  strideLengthS?: number;
  /** Source language (multilingual Whisper checkpoints only). */
  language?: string;
  /** 'transcribe' (default) or 'translate' (multilingual checkpoints only). */
  task?: 'transcribe' | 'translate';
}

/** Options for ZeroShotClassifier.classify(). */
export interface ZeroShotOptions {
  /** Score every label on its own (several can be high) instead of picking one. */
  multiLabel?: boolean;
  /** NLI hypothesis with a {} placeholder for the label; default "This example is {}.". */
  hypothesisTemplate?: string;
}

/**
 * Language pair for one translate() call. Codes follow the checkpoint:
 * ISO 639-1 for opus-mt ("en", "ru"), FLORES-200 for NLLB ("eng_Latn").
 */
export interface TranslateOptions {
  from?: string;
  to?: string;
}

/** createTranslator() options: a default pair and/or a pinned checkpoint. */
export interface TranslatorOptions extends Partial<Omit<PipelineRequest, 'task'>> {
  /** Default source language for translate(); required unless every call passes one or `model` is pinned. */
  from?: string;
  /** Default target language for translate(). */
  to?: string;
}
