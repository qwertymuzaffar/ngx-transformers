import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { inferenceResource } from './inference-resource';

/** Settles effects and the resource's pending loaders until `check` passes. */
async function settle(check: () => void): Promise<void> {
  await vi.waitFor(() => {
    TestBed.tick();
    check();
  });
}

describe('inferenceResource', () => {
  it('runs when the input changes, stays idle on undefined, and exposes the value', async () => {
    const text = signal('');
    const runs: string[] = [];
    const res = TestBed.runInInjectionContext(() =>
      inferenceResource({
        input: () => text().trim() || undefined,
        run: async (input) => {
          runs.push(input);
          return input.toUpperCase();
        },
      }),
    );
    TestBed.tick();
    expect(res.status()).toBe('idle');
    expect(res.value()).toBeUndefined();

    text.set('hello');
    await settle(() => expect(res.value()).toBe('HELLO'));
    expect(res.status()).toBe('resolved');
    expect(runs).toEqual(['hello']);

    text.set('   ');
    await settle(() => expect(res.status()).toBe('idle'));
    expect(res.value()).toBeUndefined();
    expect(runs).toEqual(['hello']);
  });

  it('keeps only the result for the latest input when runs overlap', async () => {
    const text = signal('a');
    const resolvers = new Map<string, (v: string) => void>();
    const res = TestBed.runInInjectionContext(() =>
      inferenceResource({
        input: () => text(),
        run: (input) => new Promise<string>((resolve) => resolvers.set(input, resolve)),
      }),
    );
    await settle(() => expect(resolvers.has('a')).toBe(true));
    text.set('b');
    await settle(() => expect(resolvers.has('b')).toBe(true));
    resolvers.get('b')!('B');
    await settle(() => expect(res.value()).toBe('B'));
    resolvers.get('a')!('A'); // stale: arrives after b already resolved
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    expect(res.value()).toBe('B');
    expect(res.status()).toBe('resolved');
  });

  it('surfaces a failed run as error', async () => {
    const text = signal('x');
    const res = TestBed.runInInjectionContext(() =>
      inferenceResource({
        input: () => text(),
        run: async () => {
          throw new Error('model failed');
        },
      }),
    );
    await settle(() => expect(res.status()).toBe('error'));
    expect(res.error()?.message).toBe('model failed');
  });

  it('runs the initial input at once, then debounces changes while typing', async () => {
    vi.useFakeTimers();
    try {
      const text = signal('h');
      const runs: string[] = [];
      const res = TestBed.runInInjectionContext(() =>
        inferenceResource({
          input: () => text(),
          run: async (input) => {
            runs.push(input);
            return input;
          },
          debounceMs: 200,
        }),
      );
      TestBed.tick();
      text.set('he');
      TestBed.tick();
      text.set('hel');
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(150);
      TestBed.tick();
      expect(runs).toEqual(['h']); // the initial value ran immediately; 'he' never will
      await vi.advanceTimersByTimeAsync(100);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();
      expect(runs).toEqual(['h', 'hel']);
      expect(res.value()).toBe('hel');
    } finally {
      vi.useRealTimers();
    }
  });
});
