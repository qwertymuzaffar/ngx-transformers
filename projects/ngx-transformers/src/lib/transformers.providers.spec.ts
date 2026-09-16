import { TestBed } from '@angular/core/testing';
import { PIPELINE_FACTORY, createDefaultPipelineFactory } from './transformers.providers';

describe('createDefaultPipelineFactory', () => {
  it('imports the module lazily on pipeline creation and forwards task, model and options', async () => {
    const calls: unknown[][] = [];
    const pipe = async () => 'out';
    let imports = 0;
    const factory = createDefaultPipelineFactory(async () => {
      imports++;
      return {
        pipeline: async (...args: unknown[]) => {
          calls.push(args);
          return pipe;
        },
      };
    });
    expect(imports).toBe(0);

    const created = await factory('text-classification', 'org/model', { dtype: 'q8' });
    expect(await created('input')).toBe('out');
    expect(calls).toEqual([['text-classification', 'org/model', { dtype: 'q8' }]]);

    await factory('translation', undefined, {});
    expect(imports).toBe(2);
  });

  it('turns the onToken run option into a TextStreamer on the pipeline tokenizer', async () => {
    const runs: unknown[][] = [];
    class FakeStreamer {
      constructor(
        readonly tokenizer: unknown,
        readonly options: { callback_function?: (text: string) => void; skip_prompt?: boolean },
      ) {}
    }
    const tokenizer = { name: 'tok' };
    const pipe = Object.assign(
      async (...args: unknown[]) => {
        runs.push(args);
        const streamer = (args[1] as { streamer?: FakeStreamer }).streamer;
        streamer?.options.callback_function?.('Hel');
        streamer?.options.callback_function?.('lo');
        return [{ generated_text: 'Hello' }];
      },
      { tokenizer, dispose: async () => undefined },
    );
    const factory = createDefaultPipelineFactory(async () => ({
      pipeline: async () => pipe,
      TextStreamer: FakeStreamer as never,
    }));
    const created = await factory('text-generation', 'm', {});
    const tokens: string[] = [];
    await created('hi', { max_new_tokens: 5, onToken: (t: string) => tokens.push(t) });
    expect(tokens).toEqual(['Hel', 'lo']);
    const options = runs[0][1] as Record<string, unknown>;
    expect(options['onToken']).toBeUndefined();
    expect(options['max_new_tokens']).toBe(5);
    const streamer = options['streamer'] as FakeStreamer;
    expect(streamer.tokenizer).toBe(tokenizer);
    expect(streamer.options.skip_prompt).toBe(true);
    // without onToken the pipeline is called as is
    await created('plain', { max_new_tokens: 1 });
    expect((runs[1][1] as Record<string, unknown>)['streamer']).toBeUndefined();
    await created.dispose?.();
  });

  it('is what PIPELINE_FACTORY provides out of the box', () => {
    TestBed.configureTestingModule({});
    expect(typeof TestBed.inject(PIPELINE_FACTORY)).toBe('function');
  });
});
