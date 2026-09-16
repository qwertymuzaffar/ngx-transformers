import { DestroyRef, inject, signal } from '@angular/core';
import { PipelineHandle } from './pipeline';
import type { ChatMessage, GenerateOptions, PipelineRequest } from './transformers.models';
import { NGX_TRANSFORMERS_CONFIG, PIPELINE_FACTORY } from './transformers.providers';

// The smallest instruct model that holds a conversation; its repository
// ships the ONNX variants Transformers.js loads (~100 MB at q4).
export const DEFAULT_TEXT_GENERATION_MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';

/** Raw text-generation output: the reply as a string, or the chat with the reply appended. */
interface RawGeneration {
  generated_text?: string | ChatMessage[];
}

/**
 * Text generation with a small language model, streamed token by token.
 * The default checkpoint is SmolLM2-135M-Instruct; swap `model` for any
 * Transformers.js text-generation checkpoint (Qwen2.5, Llama, Phi...).
 */
export class TextGenerator extends PipelineHandle<
  string | ChatMessage[],
  RawGeneration | RawGeneration[]
> {
  /** The text generated so far by the current generate() call; reset when a call starts. */
  readonly output = signal('');

  /**
   * Generates a reply to a prompt or a chat. Tokens stream into `output`
   * (and `options.onToken`) while the model runs; resolves with the full,
   * trimmed reply.
   */
  async generate(prompt: string | ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    const runOptions: Record<string, unknown> = { max_new_tokens: options.maxNewTokens ?? 256 };
    if (options.doSample !== undefined) runOptions['do_sample'] = options.doSample;
    if (options.temperature !== undefined) runOptions['temperature'] = options.temperature;
    if (options.topP !== undefined) runOptions['top_p'] = options.topP;
    if (options.topK !== undefined) runOptions['top_k'] = options.topK;
    if (options.repetitionPenalty !== undefined) {
      runOptions['repetition_penalty'] = options.repetitionPenalty;
    }
    // A plain prompt would otherwise come back with the prompt in front.
    if (typeof prompt === 'string') runOptions['return_full_text'] = false;

    this.output.set('');
    runOptions['onToken'] = (text: string) => {
      this.output.update((current) => current + text);
      options.onToken?.(text);
    };

    const raw = await this.run(prompt, runOptions);
    const first = Array.isArray(raw) ? raw[0] : raw;
    const generated = first?.generated_text;
    const text = Array.isArray(generated) ? (generated.at(-1)?.content ?? '') : (generated ?? '');
    const reply = text.trim();
    this.output.set(reply);
    return reply;
  }
}

/**
 * Creates a TextGenerator in an injection context; destroyed with the
 * component. dtype defaults to 'q4', the size/quality sweet spot for small
 * decoders on the WebAssembly runtime.
 */
export function createTextGenerator(
  options: Partial<Omit<PipelineRequest, 'task'>> = {},
): TextGenerator {
  const generator = new TextGenerator(
    { task: 'text-generation', model: DEFAULT_TEXT_GENERATION_MODEL, dtype: 'q4', ...options },
    inject(PIPELINE_FACTORY),
    inject(NGX_TRANSFORMERS_CONFIG),
  );
  inject(DestroyRef, { optional: true })?.onDestroy(() => void generator.destroy());
  return generator;
}
