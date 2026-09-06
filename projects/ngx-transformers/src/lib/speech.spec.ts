import { TestBed } from '@angular/core/testing';
import { MicRecorder, type RecorderLike } from './mic-recorder';
import { createSpeechRecognizer, DEFAULT_ASR_MODEL, SpeechRecognizer } from './speech-recognizer';
import { PIPELINE_FACTORY, type PipelineFactory, type PipelineLike } from './transformers.providers';

function recognizerWith(output: unknown) {
  const calls: { task: string; model?: string; options?: Record<string, unknown> }[] = [];
  const runCalls: { input: unknown; options?: Record<string, unknown> }[] = [];
  const factory: PipelineFactory = async (task, model, options) => {
    calls.push({ task, model, options });
    return (async (input: unknown, options?: Record<string, unknown>) => {
      runCalls.push({ input, options });
      return output;
    }) as PipelineLike;
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: PIPELINE_FACTORY, useValue: factory }] });
  const recognizer = TestBed.runInInjectionContext(() => createSpeechRecognizer());
  return { recognizer, calls, runCalls };
}

describe('SpeechRecognizer', () => {
  it('defaults to whisper-tiny.en at q4 (q8 breaks the v4 wasm runtime)', async () => {
    const { recognizer, calls } = recognizerWith({ text: 'hi' });
    await recognizer.load();
    expect(calls[0].task).toBe('automatic-speech-recognition');
    expect(calls[0].model).toBe(DEFAULT_ASR_MODEL);
    expect(calls[0].options?.['dtype']).toBe('q4');
  });

  it('transcribe() trims text and passes Float32Array input through untouched', async () => {
    const { recognizer, runCalls } = recognizerWith({ text: '  hello world  ' });
    const pcm = new Float32Array([0.1, -0.1]);
    const out = await recognizer.transcribe(pcm);
    expect(out).toEqual({ text: 'hello world' });
    expect(runCalls[0].input).toBe(pcm);
    expect(runCalls[0].options).toEqual({});
  });

  it('transcribe() accepts a URL string directly', async () => {
    const { recognizer, runCalls } = recognizerWith({ text: 'from url' });
    await recognizer.transcribe('https://example.com/audio.wav');
    expect(runCalls[0].input).toBe('https://example.com/audio.wav');
  });

  it('maps camelCase options to pipeline snake_case options', async () => {
    const { recognizer, runCalls } = recognizerWith({ text: 'x' });
    await recognizer.transcribe(new Float32Array(1), {
      returnTimestamps: true,
      chunkLengthS: 30,
      strideLengthS: 5,
      language: 'french',
      task: 'translate',
    });
    expect(runCalls[0].options).toEqual({
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'french',
      task: 'translate',
    });
  });

  it('normalizes chunks with [start, end] tuples into start/end fields', async () => {
    const { recognizer } = recognizerWith({
      text: ' two parts ',
      chunks: [
        { text: ' two', timestamp: [0, 1.2] },
        { text: ' parts', timestamp: [1.2, null] },
        { text: '!', timestamp: undefined },
      ],
    });
    const out = await recognizer.transcribe(new Float32Array(1), { returnTimestamps: true });
    expect(out.text).toBe('two parts');
    expect(out.chunks).toEqual([
      { text: ' two', start: 0, end: 1.2 },
      { text: ' parts', start: 1.2, end: null },
      { text: '!', start: null, end: null },
    ]);
  });

  it('unwraps array-shaped pipeline output and tolerates empty output', async () => {
    const wrapped = recognizerWith([{ text: 'wrapped' }]);
    expect((await wrapped.recognizer.transcribe(new Float32Array(1))).text).toBe('wrapped');
    const empty = recognizerWith([]);
    expect(await empty.recognizer.transcribe(new Float32Array(1))).toEqual({ text: '' });
  });

  it('is exported as a PipelineHandle subclass with the usual signals', () => {
    const { recognizer } = recognizerWith({ text: '' });
    expect(recognizer).toBeInstanceOf(SpeechRecognizer);
    expect(recognizer.status()).toBe('idle');
    expect(recognizer.ready()).toBe(false);
  });
});

describe('MicRecorder', () => {
  function fakeDeps() {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [{ stop: () => stopped.push('track') }],
    } as unknown as MediaStream;
    const recorder: RecorderLike = {
      ondataavailable: null,
      onstop: null,
      mimeType: 'audio/webm',
      start: () => {
        // one chunk arrives while recording
        recorder.ondataavailable?.({ data: new Blob(['chunk-a'], { type: 'audio/webm' }) });
      },
      stop: () => {
        recorder.ondataavailable?.({ data: new Blob(['chunk-b'], { type: 'audio/webm' }) });
        recorder.onstop?.();
      },
    };
    return {
      stopped,
      deps: {
        getUserMedia: async () => stream,
        createRecorder: () => recorder,
      },
    };
  }

  it('start() flips recording on and resets the clock', async () => {
    const { deps } = fakeDeps();
    const mic = new MicRecorder(deps);
    expect(mic.recording()).toBe(false);
    await mic.start();
    expect(mic.recording()).toBe(true);
    expect(mic.seconds()).toBe(0);
    mic.dispose();
  });

  it('start() while recording is a no-op', async () => {
    let asks = 0;
    const { deps } = fakeDeps();
    const counting = {
      ...deps,
      getUserMedia: async () => {
        asks++;
        return deps.getUserMedia();
      },
    };
    const mic = new MicRecorder(counting);
    await mic.start();
    await mic.start();
    expect(asks).toBe(1);
    mic.dispose();
  });

  it('ticks seconds while recording', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = fakeDeps();
      const mic = new MicRecorder(deps);
      await mic.start();
      vi.advanceTimersByTime(3000);
      expect(mic.seconds()).toBe(3);
      mic.dispose();
      vi.advanceTimersByTime(2000);
      expect(mic.seconds()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() resolves the collected chunks as one Blob and releases the mic', async () => {
    const { deps, stopped } = fakeDeps();
    const mic = new MicRecorder(deps);
    await mic.start();
    const blob = await mic.stop();
    expect(blob.type).toBe('audio/webm');
    expect(blob.size).toBeGreaterThan(0);
    expect(mic.recording()).toBe(false);
    expect(stopped).toEqual(['track']);
  });

  it('stop() without start rejects', async () => {
    const mic = new MicRecorder(fakeDeps().deps);
    await expect(mic.stop()).rejects.toThrow(/not recording/);
  });

  it('a denied microphone sets the error signal and rethrows', async () => {
    const mic = new MicRecorder({
      getUserMedia: async () => {
        throw new Error('Permission denied');
      },
    });
    await expect(mic.start()).rejects.toThrow('Permission denied');
    expect(mic.recording()).toBe(false);
    expect(String(mic.error())).toContain('Permission denied');
  });
});
