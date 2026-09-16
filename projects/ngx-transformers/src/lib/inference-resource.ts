import {
  Injector,
  effect,
  inject,
  resource,
  signal,
  untracked,
  type ResourceRef,
  type Signal,
} from '@angular/core';

export interface InferenceResourceOptions<TIn, TOut> {
  /**
   * The input to run on, read reactively. Return `undefined` for "nothing
   * to do": the resource stays idle and keeps no value.
   */
  input: () => TIn | undefined;
  /**
   * Runs the model for one input, typically a handle method. The abort
   * signal fires when a newer input supersedes this run; a model run cannot
   * be interrupted, but the stale result is dropped either way.
   */
  run: (input: TIn, abortSignal: AbortSignal) => Promise<TOut>;
  /** Wait this long after the last input change before running (typing). */
  debounceMs?: number;
  /** Required outside an injection context. */
  injector?: Injector;
}

/**
 * Runs inference whenever an input signal changes, as an Angular resource:
 * `value()`, `isLoading()`, `error()` and `status()` are signals, and only
 * the result for the latest input is kept.
 *
 * ```ts
 * readonly text = signal('');
 * readonly classifier = createTextClassifier();
 * readonly sentiment = inferenceResource({
 *   input: () => this.text().trim() || undefined,
 *   run: (text) => this.classifier.classify(text),
 *   debounceMs: 300,
 * });
 * // template: @if (sentiment.value(); as result) { {{ result[0].label }} }
 * ```
 */
export function inferenceResource<TIn, TOut>(
  options: InferenceResourceOptions<TIn, TOut>,
): ResourceRef<TOut | undefined> {
  const injector = options.injector ?? inject(Injector);
  const input = options.debounceMs
    ? debounced(options.input, options.debounceMs, injector)
    : options.input;
  return resource<TOut, TIn | undefined>({
    params: () => input(),
    loader: ({ params, abortSignal }) => options.run(params, abortSignal),
    injector,
  });
}

/** A signal that follows `source` once it has been stable for `ms`. */
function debounced<T>(source: () => T, ms: number, injector: Injector): Signal<T> {
  const out = signal<T>(untracked(source));
  effect(
    (onCleanup) => {
      const value = source();
      const timer = setTimeout(() => out.set(value), ms);
      onCleanup(() => clearTimeout(timer));
    },
    { injector },
  );
  return out.asReadonly();
}
