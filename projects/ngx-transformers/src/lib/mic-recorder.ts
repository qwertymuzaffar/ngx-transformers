import { DestroyRef, inject, signal } from '@angular/core';

/** Minimal recorder surface - lets tests (and exotic runtimes) inject fakes. */
export interface RecorderLike {
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  mimeType?: string;
}

export interface MicRecorderDeps {
  /** Defaults to navigator.mediaDevices.getUserMedia({ audio: true }). */
  getUserMedia?: () => Promise<MediaStream>;
  /** Defaults to new MediaRecorder(stream). */
  createRecorder?: (stream: MediaStream) => RecorderLike;
}

/**
 * Microphone capture with a signals API. start() asks for mic permission
 * and records; stop() resolves with the encoded audio Blob - pass it to
 * SpeechRecognizer.transcribe(). Browser-only.
 *
 * ```ts
 * readonly mic = createMicRecorder();
 * readonly whisper = createSpeechRecognizer();
 *
 * async toggle() {
 *   if (this.mic.recording()) {
 *     const audio = await this.mic.stop();
 *     const { text } = await this.whisper.transcribe(audio);
 *   } else {
 *     await this.mic.start();
 *   }
 * }
 * ```
 */
export class MicRecorder {
  readonly recording = signal(false);
  /** Elapsed recording time in whole seconds. */
  readonly seconds = signal(0);
  readonly error = signal<unknown>(null);

  private stream: MediaStream | null = null;
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: MicRecorderDeps = {}) {}

  /** Requests the microphone and starts recording. No-op while recording. */
  async start(): Promise<void> {
    if (this.recording()) return;
    this.error.set(null);
    try {
      this.stream = await (this.deps.getUserMedia
        ? this.deps.getUserMedia()
        : navigator.mediaDevices.getUserMedia({ audio: true }));
      this.recorder = this.deps.createRecorder
        ? this.deps.createRecorder(this.stream)
        : (new MediaRecorder(this.stream) as unknown as RecorderLike);
      this.chunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start();
      this.recording.set(true);
      this.seconds.set(0);
      this.timer = setInterval(() => this.seconds.set(this.seconds() + 1), 1000);
    } catch (err) {
      this.error.set(err);
      this.cleanup();
      throw err;
    }
  }

  /** Stops recording and resolves with the captured audio. */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || !this.recording()) {
      return Promise.reject(new Error('MicRecorder.stop() called while not recording.'));
    }
    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.cleanup();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  /** Stops tracks and timers without resolving audio (e.g. on destroy). */
  dispose(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.recording.set(false);
  }
}

/** Creates a MicRecorder in an injection context; disposed with the component. */
export function createMicRecorder(deps: MicRecorderDeps = {}): MicRecorder {
  const recorder = new MicRecorder(deps);
  inject(DestroyRef, { optional: true })?.onDestroy(() => recorder.dispose());
  return recorder;
}
