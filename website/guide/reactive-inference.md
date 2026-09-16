# Reactive inference

`inferenceResource()` runs a model whenever an input signal changes and exposes the result as an Angular [resource](https://angular.dev/guide/signals/resource): `value()`, `isLoading()`, `error()` and `status()` are signals, and only the result for the latest input is kept. It is the idiomatic way to wire "classify as the user types" or "re-rank when the query changes".

```ts
import { Component, signal } from '@angular/core';
import { createTextClassifier, inferenceResource } from 'ngx-transformers';

@Component({
  template: `
    <textarea #box (input)="text.set(box.value)"></textarea>
    @if (sentiment.isLoading()) {
      <span>thinking</span>
    }
    @if (sentiment.value(); as result) {
      <strong>{{ result[0].label }}</strong>
    }
    @if (sentiment.error(); as err) {
      <p>{{ err.message }}</p>
    }
  `,
})
export class SentimentComponent {
  readonly text = signal('');
  readonly classifier = createTextClassifier();
  readonly sentiment = inferenceResource({
    input: () => this.text().trim() || undefined,
    run: (text) => this.classifier.classify(text),
    debounceMs: 300,
  });
}
```

The demo app's sentiment card is built this way.

## Options

| Option | Effect |
| --- | --- |
| `input` | Read reactively. Return `undefined` for "nothing to run": the resource goes idle and drops its value. |
| `run(input, abortSignal)` | Runs the model, usually a handle method. The signal aborts when a newer input supersedes this run. |
| `debounceMs` | Wait this long after the last change before running. The initial input runs at once; later changes are coalesced. |
| `injector` | Required when called outside an injection context. |

## Behaviour

- **Latest wins.** If the input changes while a run is in flight, the older result is discarded when it arrives. A model run cannot be interrupted, so it still finishes in the background; check `abortSignal.aborted` after an `await` when `run` does several steps and the later ones are worth skipping.
- **Equality.** Inputs are compared with `Object.is`, so an unchanged string does not re-run. Objects and arrays re-run on every new instance; derive a stable value (a joined string, an id) when that matters.
- **Lifecycle.** The resource is destroyed with the injection context it was created in, like the handle itself. Model loading and disposal stay with the handle: the first run triggers the download, and `<ngx-model-progress>` shows it as usual.

## Chaining handles

`run` is any async function, so one resource can chain handles: embed the query, rank the documents, translate the best hit. The resource shows one loading state and one error for the whole chain.
