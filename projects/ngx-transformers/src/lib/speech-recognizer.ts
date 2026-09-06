import { DestroyRef, inject } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { PipelineRequest, TranscribeOptions, Transcription, TranscriptionChunk } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY } from './transformers.providers';

// onnx-community, not the legacy Xenova export: the old ONNX decoder lacks
// the quantization scales transformers.js v4's runtime requires.
export const DEFAULT_ASR_MODEL = 'onnx-community/whisper-tiny.en';

/** Whisper expects 16 kHz mono float PCM. */
export const WHISPER_SAMPLE_RATE = 16000;

/** Raw ASR pipeline output (subset we consume). */
interface RawTranscription {
  text?: string;
  chunks?: { text: string; timestamp?: [number | null, number | null] }[];
}

/**
 * Decodes an encoded audio file (wav/mp3/webm/ogg - anything the browser
 * can decode) to 16 kHz mono Float32Array, ready for Whisper. Browser-only:
 * uses AudioContext with a target sample rate, which resamples on decode.
 */
export async function decodeAudio(
  source: Blob | ArrayBuffer,
  targetSampleRate = WHISPER_SAMPLE_RATE,
): Promise<Float32Array> {
  const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextCtor) {
    throw new Error('decodeAudio requires a browser AudioContext (not available in this environment).');
  }
  const buffer = source instanceof Blob ? await source.arrayBuffer() : source;
  const ctx = new AudioContextCtor({ sampleRate: targetSampleRate });
  try {
    const decoded = await ctx.decodeAudioData(buffer);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    // Mix down to mono by averaging channels.
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } finally {
    await ctx.close();
  }
}

/**
 * Speech-to-text via Whisper. The default checkpoint is whisper-tiny.en
 * (~41 MB q8, English-only); swap `model` for a multilingual or larger one
 * (e.g. Xenova/whisper-small).
 */
export class SpeechRecognizer extends PipelineHandle<string | Float32Array, RawTranscription | RawTranscription[]> {
  /**
   * Transcribes audio: a URL, a decoded 16 kHz Float32Array, or an encoded
   * Blob/ArrayBuffer (decoded via decodeAudio first - browser-only).
   */
  async transcribe(
    audio: string | Float32Array | Blob | ArrayBuffer,
    options: TranscribeOptions = {},
  ): Promise<Transcription> {
    const input =
      audio instanceof Blob || audio instanceof ArrayBuffer ? await decodeAudio(audio) : audio;

    const runOptions: Record<string, unknown> = {};
    if (options.returnTimestamps !== undefined) runOptions['return_timestamps'] = options.returnTimestamps;
    if (options.chunkLengthS !== undefined) runOptions['chunk_length_s'] = options.chunkLengthS;
    if (options.strideLengthS !== undefined) runOptions['stride_length_s'] = options.strideLengthS;
    if (options.language !== undefined) runOptions['language'] = options.language;
    if (options.task !== undefined) runOptions['task'] = options.task;

    const raw = await this.run(input, runOptions);
    const first = (Array.isArray(raw) ? raw[0] : raw) ?? {};
    const chunks: TranscriptionChunk[] | undefined = first.chunks?.map((c) => ({
      text: c.text,
      start: c.timestamp?.[0] ?? null,
      end: c.timestamp?.[1] ?? null,
    }));
    return { text: (first.text ?? '').trim(), ...(chunks ? { chunks } : {}) };
  }
}

/**
 * Creates a SpeechRecognizer in an injection context.
 *
 * dtype defaults to 'q4' (not the library-wide default): q8 Whisper
 * decoders fail session creation on the v4 WASM runtime
 * (huggingface/transformers.js#1707), while q4 loads and runs everywhere.
 */
export function createSpeechRecognizer(options: Partial<Omit<PipelineRequest, 'task'>> = {}): SpeechRecognizer {
  const recognizer = new SpeechRecognizer(
    { task: 'automatic-speech-recognition', model: DEFAULT_ASR_MODEL, dtype: 'q4', ...options },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void recognizer.dispose());
  return recognizer;
}
