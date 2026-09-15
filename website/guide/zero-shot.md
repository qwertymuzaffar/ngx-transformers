# Zero-shot classification

`createZeroShotClassifier()` scores labels you choose at call time against a text, with no fine-tuning: a natural-language-inference model judges whether "This example is {label}." follows from the text. The default checkpoint is MobileBERT MNLI (~26 MB).

```ts
import { createZeroShotClassifier } from 'ngx-transformers';

readonly classifier = createZeroShotClassifier(); // Xenova/mobilebert-uncased-mnli

const scored = await this.classifier.classify(ticket, ['billing', 'bug report', 'feature request']);
// [{ label: 'bug report', score: 0.91 }, { label: 'billing', score: 0.06 }, { label: 'feature request', score: 0.03 }]
```

Try it: <SiteLink to="/storybook/?path=/story/transformers-ngxtransformers--zero-shot-classification-live">zero-shot story</SiteLink>.

## API

`classify(text, labels, options?)` resolves to `ClassificationResult[]` sorted best first. With no labels it resolves to `[]` without loading the model.

| Option | Default | Effect |
| --- | --- | --- |
| `multiLabel` | `false` | Score each label on its own, so several can be high, instead of normalising across labels so they sum to 1. |
| `hypothesisTemplate` | `'This example is {}.'` | The sentence the label is inserted into. Match it to your domain. |

```ts
const tags = await this.classifier.classify(text, ['food', 'repair', 'politics'], {
  multiLabel: true,
  hypothesisTemplate: 'This text is about {}.',
});
```

## Tips

- Label wording matters: the model reads each label as English text. `'refund request'` works better than `'REFUND'`.
- Cost grows with the number of labels, one inference per label, so keep the list short.
- `Xenova/distilbert-base-uncased-mnli` (~80 MB) is the more accurate drop-in: `createZeroShotClassifier({ model: 'Xenova/distilbert-base-uncased-mnli' })`.
