import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { createMicRecorder } from './mic-recorder';
import { ModelProgressComponent } from './model-progress.component';
import { createSpeechRecognizer } from './speech-recognizer';
import { createTextClassifier } from './text-classifier';
import { createTextEmbedder } from './text-embedder';
import type { ClassificationResult, Transcription } from './transformers.models';

const meta: Meta<ModelProgressComponent> = {
  title: 'Transformers/NgxTransformers',
  component: ModelProgressComponent,
  parameters: { layout: 'padded' },
  argTypes: {
    status: { control: 'inline-radio', options: ['idle', 'loading', 'ready', 'busy', 'error'] },
  },
};
export default meta;

type Story = StoryObj<ModelProgressComponent>;

/** Presentational status line for any pipeline - drive it with the controls. */
export const ModelProgress: Story = {
  args: {
    status: 'loading',
    progress: { file: 'onnx/model_quantized.onnx', progress: 63, loadedBytes: 41_000_000, totalBytes: 65_000_000 },
  },
};

/**
 * LIVE demo - clicking the button downloads DistilBERT SST-2 (~65 MB, then
 * cached by the browser) and runs sentiment analysis fully on-device.
 */
@Component({
  selector: 'story-sentiment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelProgressComponent],
  template: `
    <div class="wrap">
      <textarea #box rows="3">On-device inference in Angular is finally pleasant to use.</textarea>
      <div class="row">
        <button (click)="analyze(box.value)" [disabled]="classifier.busy()">
          {{ classifier.ready() ? 'Analyze' : 'Load model & analyze' }}
        </button>
        <ngx-model-progress [status]="classifier.status()" [progress]="classifier.progress()" />
      </div>
      @if (result(); as r) {
        <strong [style.color]="r.label === 'POSITIVE' ? '#15803d' : '#b91c1c'">
          {{ r.label }} {{ (r.score * 100).toFixed(1) }}%
        </strong>
      }
    </div>
  `,
  styles: `
    .wrap { max-width: 560px; display: flex; flex-direction: column; gap: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; }
    textarea { font: inherit; font-size: 13.5px; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 9px; }
    .row { display: flex; align-items: center; gap: 14px; }
    .row ngx-model-progress { flex: 1; }
    button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border: none; border-radius: 9px; background: #1e293b; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.55; }
  `,
})
class SentimentStoryComponent {
  readonly classifier = createTextClassifier();
  readonly result = signal<ClassificationResult | null>(null);

  async analyze(text: string): Promise<void> {
    this.result.set(null);
    const [top] = await this.classifier.classify(text);
    this.result.set(top ?? null);
  }
}

export const SentimentAnalysisLive: StoryObj = {
  render: () => ({ template: '<story-sentiment />', moduleMetadata: { imports: [SentimentStoryComponent] } }),
};

/**
 * LIVE demo - all-MiniLM-L6-v2 embeddings (~23 MB) rank documents by
 * meaning, not keywords: "make my app faster" finds the performance tips.
 */
@Component({
  selector: 'story-semantic-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelProgressComponent],
  template: `
    <div class="wrap">
      <input #q type="text" value="how do I make my app faster?" (keydown.enter)="search(q.value)" />
      <div class="row">
        <button (click)="search(q.value)" [disabled]="embedder.busy()">
          {{ embedder.ready() ? 'Search' : 'Load model & search' }}
        </button>
        <ngx-model-progress [status]="embedder.status()" [progress]="embedder.progress()" />
      </div>
      <ul>
        @for (r of rows(); track r.text) {
          <li>
            @if (r.score !== null) {
              <code>{{ r.score.toFixed(3) }}</code>
            }
            {{ r.text }}
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .wrap { max-width: 560px; display: flex; flex-direction: column; gap: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; }
    input { font: inherit; font-size: 13.5px; padding: 10px 12px; border: 1.5px solid #e2e8f0; border-radius: 9px; }
    .row { display: flex; align-items: center; gap: 14px; }
    .row ngx-model-progress { flex: 1; }
    button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border: none; border-radius: 9px; background: #1e293b; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.55; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    li { font-size: 13px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9px; padding: 8px 11px; display: flex; gap: 9px; align-items: center; }
    code { font-size: 11.5px; font-weight: 600; background: #fef3c7; color: #92400e; border-radius: 7px; padding: 2px 7px; }
  `,
})
class SemanticSearchStoryComponent {
  readonly embedder = createTextEmbedder();
  readonly results = signal<{ text: string; score: number | null }[] | null>(null);

  readonly documents = [
    'Enable OnPush change detection and lazy-load feature routes.',
    'Our cat prefers the cardboard box over the bed we bought.',
    'Use trackBy and virtual scrolling for very long lists.',
    'The bakery on 5th street sells excellent sourdough.',
    'Precompute expensive values with computed() instead of pipes.',
  ];

  rows(): { text: string; score: number | null }[] {
    return this.results() ?? this.documents.map((text) => ({ text, score: null }));
  }

  async search(query: string): Promise<void> {
    const ranked = await this.embedder.rank(query, this.documents);
    this.results.set(ranked.map(({ text, score }) => ({ text, score })));
  }
}

export const SemanticSearchLive: StoryObj = {
  render: () => ({ template: '<story-semantic-search />', moduleMetadata: { imports: [SemanticSearchStoryComponent] } }),
};

/**
 * LIVE demo - Whisper tiny.en (~41 MB, then cached) transcribes JFK's
 * "ask not" line fully in your browser, with segment timestamps.
 */
@Component({
  selector: 'story-transcribe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelProgressComponent],
  template: `
    <div class="wrap">
      <audio controls [src]="sampleUrl"></audio>
      <div class="row">
        <button (click)="transcribe()" [disabled]="whisper.busy()">
          {{ whisper.ready() ? 'Transcribe sample' : 'Load Whisper & transcribe' }}
        </button>
        <ngx-model-progress [status]="whisper.status()" [progress]="whisper.progress()" />
      </div>
      @if (result(); as r) {
        <blockquote class="transcript">{{ r.text }}</blockquote>
        @if (r.chunks?.length) {
          <ul class="chunks">
            @for (c of r.chunks; track $index) {
              <li><code>{{ c.start }}s - {{ c.end }}s</code> {{ c.text }}</li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: `
    .wrap { max-width: 560px; display: flex; flex-direction: column; gap: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; }
    audio { width: 100%; }
    .row { display: flex; align-items: center; gap: 14px; }
    .row ngx-model-progress { flex: 1; }
    button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border: none; border-radius: 9px; background: #1e293b; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.55; }
    .transcript { margin: 0; font-size: 14px; border-left: 3px solid #f59e0b; padding: 8px 12px; background: #fffbeb; border-radius: 0 9px 9px 0; }
    .chunks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .chunks li { font-size: 12.5px; color: #334155; }
    code { font-size: 11px; background: #f1f5f9; border-radius: 5px; padding: 1px 6px; margin-right: 6px; }
  `,
})
class TranscribeStoryComponent {
  readonly whisper = createSpeechRecognizer();
  readonly result = signal<Transcription | null>(null);
  readonly sampleUrl = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';

  async transcribe(): Promise<void> {
    this.result.set(null);
    this.result.set(await this.whisper.transcribe(this.sampleUrl, { returnTimestamps: true }));
  }
}

export const SpeechToTextLive: StoryObj = {
  render: () => ({ template: '<story-transcribe />', moduleMetadata: { imports: [TranscribeStoryComponent] } }),
};

/**
 * LIVE demo - dictation: record from your microphone, stop, and Whisper
 * transcribes the clip on-device. Nothing ever leaves the browser.
 */
@Component({
  selector: 'story-dictation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModelProgressComponent],
  template: `
    <div class="wrap">
      <div class="row">
        <button [class.rec]="mic.recording()" (click)="toggle()" [disabled]="whisper.busy()">
          {{ mic.recording() ? 'Stop (' + mic.seconds() + 's)' : 'Record dictation' }}
        </button>
        <ngx-model-progress [status]="whisper.status()" [progress]="whisper.progress()" />
      </div>
      @if (mic.error()) {
        <p class="err">Microphone unavailable: {{ mic.error() }}</p>
      }
      @if (text(); as t) {
        <blockquote class="transcript">{{ t }}</blockquote>
      }
    </div>
  `,
  styles: `
    .wrap { max-width: 560px; display: flex; flex-direction: column; gap: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; }
    .row { display: flex; align-items: center; gap: 14px; }
    .row ngx-model-progress { flex: 1; }
    button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border: none; border-radius: 9px; background: #1e293b; color: #fff; cursor: pointer; }
    button.rec { background: #dc2626; animation: pulse 1.2s ease-in-out infinite; }
    button:disabled { opacity: 0.55; }
    .transcript { margin: 0; font-size: 14px; border-left: 3px solid #f59e0b; padding: 8px 12px; background: #fffbeb; border-radius: 0 9px 9px 0; }
    .err { font-size: 12.5px; color: #b91c1c; margin: 0; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
    @media (prefers-reduced-motion: reduce) { button.rec { animation: none; } }
  `,
})
class DictationStoryComponent {
  readonly mic = createMicRecorder();
  readonly whisper = createSpeechRecognizer();
  readonly text = signal<string | null>(null);

  async toggle(): Promise<void> {
    if (this.mic.recording()) {
      const audio = await this.mic.stop();
      this.text.set(null);
      const { text } = await this.whisper.transcribe(audio);
      this.text.set(text || '(nothing recognized)');
    } else {
      await this.mic.start();
    }
  }
}

export const MicDictationLive: StoryObj = {
  render: () => ({ template: '<story-dictation />', moduleMetadata: { imports: [DictationStoryComponent] } }),
};
