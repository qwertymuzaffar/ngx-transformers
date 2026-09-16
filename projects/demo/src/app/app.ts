import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  ClassificationResult,
  ModelProgressComponent,
  RankedResult,
  Transcription,
  createMicRecorder,
  createSpeechRecognizer,
  createTextClassifier,
  createTextEmbedder,
  createTextGenerator,
  createTranslator,
  createZeroShotClassifier,
  inferenceResource,
} from 'ngx-transformers';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelProgressComponent],
  template: `
    <header class="hero">
      <div>
        <h1>ngx-transformers</h1>
        <p>
          On-device ML for Angular - Transformers.js with a signals API. Models run in your browser:
          no server, no API key.
        </p>
      </div>
      <div class="hero-note">
        first run downloads the model, then it is cached · inference runs in a Web Worker
      </div>
    </header>

    <main>
      <section class="card">
        <h2>Sentiment analysis</h2>
        <p class="sub">DistilBERT SST-2 - ~65 MB once, then cached; classifies as you type</p>
        <textarea
          #sentimentInput
          rows="3"
          placeholder="Type something with an opinion in it..."
          [value]="sentimentText()"
          (input)="sentimentText.set(sentimentInput.value)"
        ></textarea>
        <div class="row">
          <ngx-model-progress [status]="classifier.status()" [progress]="classifier.progress()" />
        </div>
        @if (sentiment.value(); as results) {
          <div
            class="result"
            [class.positive]="results[0].label === 'POSITIVE'"
            [class.negative]="results[0].label === 'NEGATIVE'"
          >
            {{ results[0].label }}
            <span class="score">{{ (results[0].score * 100).toFixed(1) }}%</span>
          </div>
        } @else if (sentiment.error(); as err) {
          <p class="err">{{ err.message }}</p>
        }
      </section>

      <section class="card">
        <h2>Semantic search</h2>
        <p class="sub">all-MiniLM-L6-v2 embeddings - ~23 MB once, then cached</p>
        <input
          #queryInput
          type="text"
          [disabled]="embedder.busy()"
          value="how do I make my app faster?"
          (keydown.enter)="search(queryInput.value)"
        />
        <div class="row">
          <button (click)="search(queryInput.value)" [disabled]="embedder.busy()">
            {{ embedder.ready() ? 'Search' : 'Load model & search' }}
          </button>
          <ngx-model-progress [status]="embedder.status()" [progress]="embedder.progress()" />
        </div>
        <ul class="docs">
          @for (r of displayResults(); track r.text) {
            <li>
              @if (r.score !== null) {
                <span class="chip">{{ r.score.toFixed(3) }}</span>
              }
              {{ r.text }}
            </li>
          }
        </ul>
      </section>

      <section class="card">
        <h2>Speech to text</h2>
        <p class="sub">
          Whisper tiny.en - ~41 MB once, then cached; audio never leaves the browser
        </p>
        <audio controls [src]="sampleUrl"></audio>
        <div class="row">
          <button (click)="transcribeSample()" [disabled]="whisper.busy()">
            {{ whisper.ready() ? 'Transcribe sample' : 'Load Whisper & transcribe' }}
          </button>
          <button
            [class.rec]="mic.recording()"
            (click)="toggleDictation()"
            [disabled]="whisper.busy()"
          >
            {{ mic.recording() ? 'Stop (' + mic.seconds() + 's)' : 'Dictate' }}
          </button>
        </div>
        <ngx-model-progress [status]="whisper.status()" [progress]="whisper.progress()" />
        @if (mic.error()) {
          <p class="err">Microphone unavailable: {{ mic.error() }}</p>
        }
        @if (transcript(); as t) {
          <blockquote class="transcript">{{ t.text || '(nothing recognized)' }}</blockquote>
        }
      </section>
      <section class="card">
        <h2>Zero-shot classification</h2>
        <p class="sub">MobileBERT MNLI - ~26 MB once, then cached; any labels, no fine-tuning</p>
        <textarea #zeroShotInput rows="3" [disabled]="zeroShot.busy()">
My invoice shows a charge I never made.</textarea>
        <input
          #labelsInput
          type="text"
          [disabled]="zeroShot.busy()"
          value="billing, bug report, feature request"
          (keydown.enter)="classifyZeroShot(zeroShotInput.value, labelsInput.value)"
        />
        <div class="row">
          <button
            (click)="classifyZeroShot(zeroShotInput.value, labelsInput.value)"
            [disabled]="zeroShot.busy()"
          >
            {{ zeroShot.ready() ? 'Classify' : 'Load model & classify' }}
          </button>
          <ngx-model-progress [status]="zeroShot.status()" [progress]="zeroShot.progress()" />
        </div>
        <ul class="docs">
          @for (r of zeroShotResults(); track r.label) {
            <li>
              <span class="chip">{{ (r.score * 100).toFixed(1) }}%</span>
              {{ r.label }}
            </li>
          }
        </ul>
      </section>

      <section class="card">
        <h2>Translation</h2>
        <p class="sub">opus-mt en-de - ~105 MB once, then cached; one model per language pair</p>
        <textarea #translateInput rows="3" [disabled]="translator.busy()">
The model runs entirely in the browser.</textarea>
        <div class="row">
          <button (click)="translate(translateInput.value)" [disabled]="translator.busy()">
            {{ translator.ready() ? 'Translate to German' : 'Load model & translate' }}
          </button>
          <ngx-model-progress [status]="translator.status()" [progress]="translator.progress()" />
        </div>
        @if (translation(); as t) {
          <blockquote class="transcript">{{ t }}</blockquote>
        }
      </section>
      <section class="card">
        <h2>Text generation</h2>
        <p class="sub">SmolLM2-135M-Instruct - ~100 MB once, then cached; streams as it writes</p>
        <textarea #promptInput rows="3" [disabled]="generator.busy()">
Explain what a signal is in Angular, in two sentences.</textarea>
        <div class="row">
          <button (click)="generate(promptInput.value)" [disabled]="generator.busy()">
            {{ generator.ready() ? 'Generate' : 'Load model & generate' }}
          </button>
          <ngx-model-progress [status]="generator.status()" [progress]="generator.progress()" />
        </div>
        @if (generator.output(); as text) {
          <blockquote class="transcript">{{ text }}</blockquote>
        }
      </section>
    </main>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      font-family: -apple-system, 'Segoe UI', sans-serif;
      background: #f1f5f9;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 18px 24px;
      background: #1e293b;
      color: #fff;
    }
    h1 {
      margin: 0;
      font-size: 20px;
    }
    .hero p {
      margin: 4px 0 0;
      font-size: 13px;
      color: #94a3b8;
      max-width: 560px;
    }
    .hero-note {
      font-size: 12px;
      color: #7ee787;
      font-family: ui-monospace, monospace;
      text-align: right;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 18px;
      padding: 24px;
      align-items: start;
    }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 18px 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }
    h2 {
      margin: 0;
      font-size: 16px;
      color: #1e293b;
    }
    .sub {
      margin: 3px 0 12px;
      font-size: 12px;
      color: #64748b;
    }
    textarea,
    input[type='text'] {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: 13.5px;
      padding: 10px 12px;
      border: 1.5px solid #e2e8f0;
      border-radius: 9px;
      outline: none;
    }
    textarea:focus,
    input:focus {
      border-color: #f59e0b;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin: 12px 0;
    }
    .row ngx-model-progress {
      flex: 1;
    }
    button {
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      border: none;
      border-radius: 9px;
      background: #1e293b;
      color: #fff;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .result {
      display: inline-block;
      font-size: 14px;
      font-weight: 700;
      padding: 7px 14px;
      border-radius: 9px;
      background: #e2e8f0;
    }
    .result.positive {
      background: #dcfce7;
      color: #15803d;
    }
    .result.negative {
      background: #fee2e2;
      color: #b91c1c;
    }
    .score {
      font-weight: 500;
      opacity: 0.75;
    }
    .docs {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .docs li {
      font-size: 13px;
      color: #334155;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      padding: 8px 11px;
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .chip {
      font-family: ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 600;
      background: #fef3c7;
      color: #92400e;
      border-radius: 7px;
      padding: 2px 7px;
      flex: none;
    }
    audio {
      width: 100%;
      margin-bottom: 4px;
    }
    button.rec {
      background: #dc2626;
    }
    .transcript {
      margin: 10px 0 0;
      font-size: 14px;
      border-left: 3px solid #f59e0b;
      padding: 8px 12px;
      background: #fffbeb;
      border-radius: 0 9px 9px 0;
    }
    .err {
      font-size: 12.5px;
      color: #b91c1c;
      margin: 8px 0 0;
    }
  `,
})
export class App {
  readonly classifier = createTextClassifier();
  readonly embedder = createTextEmbedder();
  readonly whisper = createSpeechRecognizer();
  readonly mic = createMicRecorder();
  readonly zeroShot = createZeroShotClassifier();
  readonly translator = createTranslator({ from: 'en', to: 'de' });
  readonly generator = createTextGenerator();

  readonly sentimentText = signal('');
  /** Re-runs the classifier whenever the text settles for 400 ms; empty text stays idle. */
  readonly sentiment = inferenceResource({
    input: () => this.sentimentText().trim() || undefined,
    run: (text, signal) => this.classifier.classify(text, 1, { signal }),
    debounceMs: 400,
  });
  readonly results = signal<{ text: string; score: number | null }[] | null>(null);
  readonly transcript = signal<Transcription | null>(null);
  readonly zeroShotResults = signal<ClassificationResult[]>([]);
  readonly translation = signal<string | null>(null);
  readonly sampleUrl =
    'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';

  readonly documents = [
    'Enable OnPush change detection and lazy-load feature routes.',
    'Our cat prefers the cardboard box over the bed we bought.',
    'Use trackBy and virtual scrolling for very long lists.',
    'The bakery on 5th street sells excellent sourdough.',
    'Precompute expensive values with computed() instead of pipes.',
  ];

  displayResults(): { text: string; score: number | null }[] {
    return this.results() ?? this.documents.map((text) => ({ text, score: null }));
  }

  async generate(prompt: string): Promise<void> {
    if (!prompt.trim()) return;
    await this.generator.generate([{ role: 'user', content: prompt }], { maxNewTokens: 120 });
  }

  async search(query: string): Promise<void> {
    if (!query.trim()) return;
    const ranked: RankedResult[] = await this.embedder.rank(query, this.documents);
    this.results.set(ranked.map(({ text, score }) => ({ text, score })));
  }

  async transcribeSample(): Promise<void> {
    this.transcript.set(null);
    this.transcript.set(await this.whisper.transcribe(this.sampleUrl));
  }

  async classifyZeroShot(text: string, labels: string): Promise<void> {
    const candidates = labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    if (!text.trim() || candidates.length === 0) return;
    this.zeroShotResults.set([]);
    this.zeroShotResults.set(await this.zeroShot.classify(text, candidates));
  }

  async translate(text: string): Promise<void> {
    if (!text.trim()) return;
    this.translation.set(null);
    this.translation.set(await this.translator.translate(text));
  }

  async toggleDictation(): Promise<void> {
    if (this.mic.recording()) {
      const audio = await this.mic.stop();
      this.transcript.set(null);
      this.transcript.set(await this.whisper.transcribe(audio));
    } else {
      await this.mic.start();
    }
  }
}
