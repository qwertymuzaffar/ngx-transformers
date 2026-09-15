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
    expect(created).toBe(pipe);
    expect(calls).toEqual([['text-classification', 'org/model', { dtype: 'q8' }]]);

    await factory('translation', undefined, {});
    expect(imports).toBe(2);
  });

  it('is what PIPELINE_FACTORY provides out of the box', () => {
    TestBed.configureTestingModule({});
    expect(typeof TestBed.inject(PIPELINE_FACTORY)).toBe('function');
  });
});
