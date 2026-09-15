# Testing

Handles get their pipeline from the `PIPELINE_FACTORY` token, so a test provides a fake factory and never touches the network or WebAssembly. This is how the library's own suite runs, in jsdom under Vitest.

## A fake factory

```ts
import { TestBed } from '@angular/core/testing';
import { PIPELINE_FACTORY, type PipelineFactory, type PipelineLike } from 'ngx-transformers';
import { SentimentComponent } from './sentiment.component';

function fakeFactory(output: unknown): PipelineFactory {
  return async () => {
    const pipe = (async () => output) as PipelineLike;
    pipe.dispose = async () => {};
    return pipe;
  };
}

describe('SentimentComponent', () => {
  it('shows the top label', async () => {
    TestBed.configureTestingModule({
      imports: [SentimentComponent],
      providers: [
        { provide: PIPELINE_FACTORY, useValue: fakeFactory([{ label: 'POSITIVE', score: 0.98 }]) },
      ],
    });
    const fixture = TestBed.createComponent(SentimentComponent);
    await fixture.componentInstance.analyze('great');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('POSITIVE 98.0%');
  });
});
```

The factory receives `(task, model, options)`. Record them to assert that a component asks for the right model, device or dtype. `options.progress_callback` is the function the handle passes for progress; call it with `{ status: 'progress', file: 'onnx/model_quantized.onnx', progress: 50, loaded: 1, total: 2 }` to drive the `progress` signal.

## Driving the lifecycle

To test the loading state, hold the factory's promise until the test releases it:

```ts
let release!: () => void;
const gate = new Promise<void>((resolve) => (release = resolve));
const factory: PipelineFactory = async () => {
  await gate;
  return (async () => []) as PipelineLike;
};

const handle = TestBed.runInInjectionContext(() => createTextClassifier());
const loading = handle.load();
expect(handle.status()).toBe('loading');
release();
await loading;
expect(handle.status()).toBe('ready');
```

A factory that throws puts the handle in the `error` state; the next `load()` retries.

## Handles outside components

`create*()` needs an injection context. In a test, wrap the call: `TestBed.runInInjectionContext(() => createTextEmbedder())`. The handle is then disposed with the test injector, or call `dispose()` yourself.

## Microphone

`createMicRecorder({ getUserMedia, createRecorder })` accepts fakes for `navigator.mediaDevices.getUserMedia()` and `new MediaRecorder(stream)`, so a dictation UI can be tested without a real microphone. The fake recorder implements `start()`, `stop()`, `ondataavailable` and `onstop`; emit a `Blob` from `ondataavailable` and then call `onstop` to resolve `stop()`.

## Audio decoding

`decodeAudio()` needs `AudioContext`, which jsdom does not provide. Either install a fake on `globalThis` whose `decodeAudioData()` returns `{ numberOfChannels, getChannelData }`, or pass `Float32Array` samples to `transcribe()` in tests and skip decoding.

## Real models

For an occasional end-to-end check, run the real pipeline in a browser test runner such as Playwright rather than in jsdom: Transformers.js needs WebAssembly, `fetch` and the Cache API, and the first run downloads the model.
