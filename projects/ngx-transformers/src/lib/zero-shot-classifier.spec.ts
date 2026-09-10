import { TestBed } from '@angular/core/testing';
import { PIPELINE_FACTORY, type PipelineFactory, type PipelineLike } from './transformers.providers';
import { createZeroShotClassifier, DEFAULT_ZERO_SHOT_MODEL, ZeroShotClassifier } from './zero-shot-classifier';

function classifierWith(output: unknown) {
  const calls: { task: string; model?: string; options?: Record<string, unknown> }[] = [];
  const runCalls: unknown[][] = [];
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, model, options });
    return (async (...args: unknown[]) => {
      runCalls.push(args);
      return output;
    }) as PipelineLike;
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
  const classifier = TestBed.runInInjectionContext(() => createZeroShotClassifier());
  return { classifier, calls, runCalls };
}

const rawResult = { sequence: 'text', labels: ['programming', 'sports', 'cooking'], scores: [0.9, 0.06, 0.04] };

describe('ZeroShotClassifier', () => {
  it('defaults to MobileBERT MNLI on the zero-shot-classification task', async () => {
    const { classifier, calls } = classifierWith(rawResult);
    await classifier.load();
    expect(calls[0].task).toBe('zero-shot-classification');
    expect(calls[0].model).toBe(DEFAULT_ZERO_SHOT_MODEL);
  });

  it('passes candidate labels positionally and maps options to snake_case', async () => {
    const { classifier, runCalls } = classifierWith(rawResult);
    await classifier.classify('text', ['programming', 'sports', 'cooking'], {
      multiLabel: true,
      hypothesisTemplate: 'This text is about {}.',
    });
    expect(runCalls[0]).toEqual([
      'text',
      ['programming', 'sports', 'cooking'],
      { multi_label: true, hypothesis_template: 'This text is about {}.' },
    ]);
  });

  it('sends an empty options object when none are given', async () => {
    const { classifier, runCalls } = classifierWith(rawResult);
    await classifier.classify('text', ['programming']);
    expect(runCalls[0]).toEqual(['text', ['programming'], {}]);
  });

  it('pairs labels with scores and sorts top first', async () => {
    const { classifier } = classifierWith({
      sequence: 'text',
      labels: ['cooking', 'programming', 'sports'],
      scores: [0.1, 0.8, 0.1],
    });
    const scored = await classifier.classify('text', ['programming', 'sports', 'cooking']);
    expect(scored).toEqual([
      { label: 'programming', score: 0.8 },
      { label: 'cooking', score: 0.1 },
      { label: 'sports', score: 0.1 },
    ]);
  });

  it('unwraps array-shaped pipeline output', async () => {
    const { classifier } = classifierWith([rawResult]);
    const scored = await classifier.classify('text', ['programming', 'sports', 'cooking']);
    expect(scored[0]).toEqual({ label: 'programming', score: 0.9 });
    expect(scored).toHaveLength(3);
  });

  it('classify() with no labels resolves [] without touching the model', async () => {
    const { classifier, calls, runCalls } = classifierWith(rawResult);
    expect(await classifier.classify('text', [])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(runCalls).toHaveLength(0);
  });

  it('is a PipelineHandle subclass with the usual signals', () => {
    const { classifier } = classifierWith(rawResult);
    expect(classifier).toBeInstanceOf(ZeroShotClassifier);
    expect(classifier.status()).toBe('idle');
    expect(classifier.ready()).toBe(false);
  });
});
