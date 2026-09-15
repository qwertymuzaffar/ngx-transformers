# Embeddings and semantic search

`createTextEmbedder()` turns text into vectors with a sentence-embedding model, all-MiniLM-L6-v2 by default (~23 MB, 384 dimensions). Vectors are mean-pooled and L2-normalised, so cosine similarity is a dot product.

```ts
import { createTextEmbedder } from 'ngx-transformers';

readonly embedder = createTextEmbedder(); // Xenova/all-MiniLM-L6-v2

const vectors = await this.embedder.embed(['one', 'two']); // number[][], one vector per text
const score = await this.embedder.similarity('car', 'automobile'); // ~0.8, in [-1, 1]
const ranked = await this.embedder.rank('how do I make my app faster?', docs);
// [{ text: 'Use trackBy and virtual scrolling...', score: 0.28, index: 2 }, ...]
```

Try it: <SiteLink to="/storybook/?path=/story/transformers-ngxtransformers--semantic-search-live">semantic search story</SiteLink>.

## API

- `embed(texts)`: one string or an array; always resolves to `number[][]`. `embed([])` resolves to `[]` without loading the model.
- `similarity(a, b)`: cosine similarity of two texts.
- `rank(query, documents)`: embeds the query and the documents in one batch and resolves to `RankedResult[]` (`text`, `score`, `index`) sorted by similarity, best first.
- `cosineSimilarity(a, b)` is exported on its own for vectors you already have.

## Semantic search in a component

```ts
@Component({
  /* ... */
})
export class SearchComponent {
  readonly embedder = createTextEmbedder();
  readonly results = signal<RankedResult[]>([]);
  readonly documents = ['Enable OnPush change detection.', 'Use trackBy for long lists.' /* ... */];

  async search(query: string) {
    this.results.set(await this.embedder.rank(query, this.documents));
  }
}
```

`rank()` re-embeds the documents on every call, which is fine for a few hundred short texts. For a larger corpus, embed the documents once, keep the vectors, and compare the query against them with `cosineSimilarity()` or a vector store. [browser-rag](https://github.com/qwertymuzaffar/browser-rag) shows a whole retrieval pipeline in the browser built on ngx-transformers.

## Other embedding models

| Model | Dimensions | Notes |
| --- | --- | --- |
| `Xenova/all-MiniLM-L6-v2` (default) | 384 | Fast, English, a good general-purpose baseline |
| `Xenova/bge-small-en-v1.5` | 384 | Higher retrieval quality in the same size class |
| `Xenova/multilingual-e5-small` | 384 | About 100 languages; prefix texts with `query: ` or `passage: ` as the model card asks |

Vectors from different models are not comparable; re-embed everything when you switch.
