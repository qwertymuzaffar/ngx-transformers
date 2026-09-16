import { TestBed } from '@angular/core/testing';
import {
  createTextGenerator,
  DEFAULT_TEXT_GENERATION_MODEL,
  TextGenerator,
} from './text-generator';
import {
  PIPELINE_FACTORY,
  type PipelineFactory,
  type PipelineLike,
} from './transformers.providers';

function generatorWith(output: unknown, tokens: string[] = []) {
  const calls: { task: string; model?: string; options?: Record<string, unknown> }[] = [];
  const runCalls: { input: unknown; options?: Record<string, unknown> }[] = [];
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, model, options });
    return (async (input: unknown, options?: Record<string, unknown>) => {
      runCalls.push({ input, options });
      const onToken = options?.['onToken'] as ((t: string) => void) | undefined;
      for (const token of tokens) onToken?.(token);
      return output;
    }) as PipelineLike;
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
  const generator = TestBed.runInInjectionContext(() => createTextGenerator());
  return { generator, calls, runCalls };
}

describe('TextGenerator', () => {
  it('defaults to SmolLM2-135M-Instruct at q4 on the text-generation task', async () => {
    const { generator, calls } = generatorWith([{ generated_text: 'hi' }]);
    await generator.load();
    expect(calls[0].task).toBe('text-generation');
    expect(calls[0].model).toBe(DEFAULT_TEXT_GENERATION_MODEL);
    expect(calls[0].options?.['dtype']).toBe('q4');
    expect(generator).toBeInstanceOf(TextGenerator);
  });

  it('returns the assistant turn of a chat and streams tokens into output', async () => {
    const chat = [
      { role: 'user' as const, content: 'Hi' },
      { role: 'assistant' as const, content: '  Hello there!  ' },
    ];
    const { generator, runCalls } = generatorWith(
      [{ generated_text: chat }],
      ['Hello', ' there', '!'],
    );
    const seen: string[] = [];
    const outputs: string[] = [];
    const reply = await generator.generate([{ role: 'user', content: 'Hi' }], {
      maxNewTokens: 32,
      temperature: 0.7,
      doSample: true,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.1,
      onToken: (t) => {
        seen.push(t);
        outputs.push(generator.output());
      },
    });
    expect(reply).toBe('Hello there!');
    expect(seen).toEqual(['Hello', ' there', '!']);
    expect(outputs).toEqual(['Hello', 'Hello there', 'Hello there!']);
    expect(generator.output()).toBe('Hello there!');
    const options = runCalls[0].options!;
    expect(options).toMatchObject({
      max_new_tokens: 32,
      temperature: 0.7,
      do_sample: true,
      top_p: 0.9,
      top_k: 40,
      repetition_penalty: 1.1,
    });
    expect(options['return_full_text']).toBeUndefined();
    expect(typeof options['onToken']).toBe('function');
  });

  it('asks for the reply only when the prompt is a string, with a 256-token default', async () => {
    const { generator, runCalls } = generatorWith([{ generated_text: 'Paris.' }]);
    expect(await generator.generate('Capital of France?')).toBe('Paris.');
    expect(runCalls[0].options).toMatchObject({ max_new_tokens: 256, return_full_text: false });
  });

  it('only the latest of two overlapping calls writes output', async () => {
    const calls: { onToken: (t: string) => void; finish: () => void }[] = [];
    const factory: PipelineFactory = async () =>
      (async (_input: unknown, options?: Record<string, unknown>) =>
        new Promise((resolve) => {
          const reply = calls.length === 0 ? 'first' : 'second';
          calls.push({
            onToken: options?.['onToken'] as (t: string) => void,
            finish: () => resolve([{ generated_text: reply }]),
          });
        })) as PipelineLike;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PIPELINE_FACTORY, useValue: factory }],
    });
    const generator = TestBed.runInInjectionContext(() => createTextGenerator());
    const first = generator.generate('a');
    const second = generator.generate('b');
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[0].onToken('fir');
    calls[1].onToken('sec');
    expect(generator.output()).toBe('sec'); // the superseded call's tokens are ignored
    calls[0].finish();
    expect(await first).toBe('first');
    expect(generator.output()).toBe('sec');
    calls[1].onToken('ond');
    calls[1].finish();
    expect(await second).toBe('second');
    expect(generator.output()).toBe('second');
  });

  it('warns once per generator when a reply arrives without streamed tokens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { generator } = generatorWith([{ generated_text: 'no streaming here' }]);
      await generator.generate('a');
      await generator.generate('b');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/PIPELINE_FACTORY/);
      const streaming = generatorWith([{ generated_text: 'hi' }], ['hi']);
      await streaming.generator.generate('c');
      expect(warn).toHaveBeenCalledTimes(1); // tokens arrived: nothing to warn about
    } finally {
      warn.mockRestore();
    }
  });

  it('tolerates bare and empty output and resets output per call', async () => {
    const { generator } = generatorWith({ generated_text: 'one' }, ['one']);
    expect(await generator.generate('a')).toBe('one');
    expect(generator.output()).toBe('one');
    const empty = generatorWith([]);
    expect(await empty.generator.generate('b')).toBe('');
    expect(empty.generator.output()).toBe('');
  });
});
