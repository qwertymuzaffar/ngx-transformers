# Text classification

`createTextClassifier()` labels a text with a fine-tuned classifier. The default checkpoint is DistilBERT SST-2, a sentiment model with `POSITIVE` and `NEGATIVE` labels (~65 MB).

```ts
import { createTextClassifier } from 'ngx-transformers';

readonly classifier = createTextClassifier(); // Xenova/distilbert-base-uncased-finetuned-sst-2-english

const [top] = await this.classifier.classify('This library makes on-device ML in Angular a joy.');
// { label: 'POSITIVE', score: 0.9997 }

const all = await this.classifier.classify(text, 2); // every label, best first
```

Try it: <SiteLink to="/storybook/?path=/story/transformers-ngxtransformers--sentiment-analysis-live">sentiment analysis story</SiteLink>.

## API

`classify(text, topK = 1)` resolves to `ClassificationResult[]` (`label`, `score`) sorted by score, best first. `topK` is forwarded to the pipeline; pass the number of labels to get the full distribution.

The handle is a `PipelineHandle`, so `load()`, `dispose()` and the signals work as described in [Concepts](./concepts). `run(text, options)` gives raw access to the pipeline with any Transformers.js option.

## Other classifiers

Any `text-classification` checkpoint works; the labels come from the model:

| Model | Labels |
| --- | --- |
| `Xenova/bert-base-multilingual-uncased-sentiment` | `1 star` to `5 stars`, reviews in six languages |
| `Xenova/toxic-bert` | `toxic`, `severe_toxic`, `obscene`, `threat`, `insult`, `identity_hate` |

```ts
readonly reviews = createTextClassifier({ model: 'Xenova/bert-base-multilingual-uncased-sentiment' });
const [stars] = await this.reviews.classify('Das Essen war hervorragend.'); // { label: '5 stars', ... }
```

For labels the model was not trained on, use [zero-shot classification](./zero-shot).
