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
  /** Progress over every file of the model seen so far; absent when unknown. */
  overall?: OverallProgress;
}

/**
 * Download progress summed over the files of a model seen so far. A model
 * is several files (config, tokenizer, weights) fetched in parallel; this is
 * the steady number to put on a progress bar.
 */
export interface OverallProgress {
  /** 0-100 over the bytes of every file with a known size. */
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  /** Files seen so far. */
  files: number;
  /** Files fully downloaded. */
  filesDone: number;
}

export type TransformersDevice = 'wasm' | 'webgpu' | 'auto';
/** Weight formats Transformers.js can load; a checkpoint must ship the one you ask for. */
export type TransformersDtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16';

/** Global defaults applied to every pipeline; see provideTransformers(). */
export interface NgxTransformersConfig {
  device?: TransformersDevice;
  /**
   * Probe WebGPU once and use it when available, else WASM, for every
   * handle that sets no device (or 'auto'). An explicit device still wins.
   */
  autoDevice?: boolean;
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

/**
 * Options every run accepts. `signal` makes a run reject with an AbortError
 * before it starts when the signal has already fired; a model run cannot be
 * interrupted once started, but a superseded run need not begin.
 */
export interface RunOptions {
  signal?: AbortSignal;
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

export interface TranscribeOptions extends RunOptions {
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
export interface ZeroShotOptions extends RunOptions {
  /** Score every label on its own (several can be high) instead of picking one. */
  multiLabel?: boolean;
  /** NLI hypothesis with a {} placeholder for the label; default "This example is {}.". */
  hypothesisTemplate?: string;
}

/**
 * Language pair for one translate() call. Codes follow the checkpoint:
 * ISO 639-1 for opus-mt ("en", "ru"), FLORES-200 for NLLB ("eng_Latn").
 */
export interface TranslateOptions extends RunOptions {
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

/** One turn of a chat prompt for TextGenerator. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Options for TextGenerator.generate(). */
export interface GenerateOptions extends RunOptions {
  /** Upper bound on generated tokens; default 256. */
  maxNewTokens?: number;
  /** Sample instead of greedy decoding; set with temperature / topP / topK. */
  doSample?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  /** Called with each piece of text as it is generated. */
  onToken?: (text: string) => void;
}
