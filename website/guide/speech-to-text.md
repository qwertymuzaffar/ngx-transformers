# Speech to text

`createSpeechRecognizer()` transcribes audio with Whisper, fully in the browser: the audio never leaves the device. The default checkpoint is whisper-tiny.en (~41 MB, 4-bit, English only).

```ts
import { createSpeechRecognizer } from 'ngx-transformers';

readonly whisper = createSpeechRecognizer(); // onnx-community/whisper-tiny.en

const { text } = await this.whisper.transcribe(file); // a File or Blob from an <input type="file">
const { text: t, chunks } = await this.whisper.transcribe(url, { returnTimestamps: true });
```

Try it: [speech-to-text story](/storybook/?path=/story/transformers-ngxtransformers--speech-to-text-live){target="_self"} and [dictation story](/storybook/?path=/story/transformers-ngxtransformers--mic-dictation-live){target="_self"}.

## Input

`transcribe()` accepts:

- a URL string, fetched and decoded by Transformers.js;
- a `Blob` or `ArrayBuffer` holding an encoded file (wav, mp3, webm, ogg, anything the browser can decode), decoded to 16 kHz mono with the Web Audio API;
- a `Float32Array` of 16 kHz mono samples, passed through untouched.

`decodeAudio(blob)` is exported for when you want the samples yourself; `WHISPER_SAMPLE_RATE` is 16000.

## Options

| Option | Effect |
| --- | --- |
| `returnTimestamps` | `true` for segment timestamps, `'word'` for word-level. They arrive in `chunks` as `{ text, start, end }` in seconds. |
| `chunkLengthS` | Split audio longer than Whisper's 30-second window into chunks of this many seconds. |
| `strideLengthS` | Overlap between chunks, in seconds. |
| `language` | Source language, multilingual checkpoints only. |
| `task` | `'transcribe'` (default) or `'translate'` into English, multilingual checkpoints only. |

```ts
const result = await this.whisper.transcribe(longRecording, {
  returnTimestamps: true,
  chunkLengthS: 30,
  strideLengthS: 5,
});
```

## Dictation with the microphone

`createMicRecorder()` captures the microphone with `MediaRecorder` and hands you an encoded `Blob` that `transcribe()` decodes:

```ts
import { createMicRecorder, createSpeechRecognizer } from 'ngx-transformers';

readonly mic = createMicRecorder();
readonly whisper = createSpeechRecognizer();
readonly transcript = signal('');

async toggle() {
  if (this.mic.recording()) {
    const audio = await this.mic.stop();
    this.transcript.set((await this.whisper.transcribe(audio)).text);
  } else {
    await this.mic.start(); // asks for microphone permission
  }
}
```

```html
<button (click)="toggle()">{{ mic.recording() ? 'Stop (' + mic.seconds() + 's)' : 'Dictate' }}</button>
@if (mic.error()) {
  <p>Microphone unavailable</p>
}
```

`MicRecorder` exposes `recording`, `seconds` and `error` signals, is disposed with the component (stopping the tracks), and accepts `getUserMedia` and `createRecorder` overrides for [tests](./testing#microphone).

## Models

| Model | Notes |
| --- | --- |
| `onnx-community/whisper-tiny.en` (default) | English, ~41 MB at q4, fastest |
| `onnx-community/whisper-tiny` | Multilingual; accepts `language` and `task` |
| `onnx-community/whisper-base`, `onnx-community/whisper-small` | Multilingual, better accuracy, larger downloads and slower on WebAssembly |

The recognizer defaults to `dtype: 'q4'` because 8-bit Whisper decoders currently fail on the v4 WebAssembly runtime ([transformers.js#1707](https://github.com/huggingface/transformers.js/issues/1707)). Pass `dtype` explicitly to choose another quantization.
