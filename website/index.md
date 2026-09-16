---
layout: home
hero:
  name: ngx-transformers
  text: On-device ML for Angular
  tagline: Hugging Face Transformers.js behind a signals API. Classification, embeddings, translation, Whisper speech-to-text and small LLMs, all in the browser. No server, no API key.
  image:
    src: /favicon.svg
    alt: ngx-transformers
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Demo app
      link: /demo/
      target: _self
    - theme: alt
      text: Storybook
      link: /storybook/
      target: _self
features:
  - icon: 🧠
    title: Runs in the browser
    details: Models execute on WebAssembly or WebGPU through Transformers.js v4. Nothing leaves the device, and everything works offline once the model is cached.
  - icon: 📶
    title: Signals all the way
    details: Every handle exposes status, progress, error, ready and busy as signals, safe to bind in OnPush and zoneless apps.
  - icon: 💤
    title: Lazy by default
    details: Creating a handle costs nothing. The model downloads on the first call, with progress over every file, and the browser caches it.
  - icon: 🧹
    title: Cleanup built in
    details: Handles are disposed with the component that created them, and a download still in flight is cancelled rather than leaked.
  - icon: 🧵
    title: Off the main thread
    details: One provider moves every pipeline into a Web Worker, so Whisper and translation never freeze the page. Same handles, same signals, streaming included.
  - icon: 🎛️
    title: Configurable and testable
    details: Global device and dtype defaults, WebGPU auto-detection, any Hub checkpoint, and a swappable pipeline factory that also makes tests run without a model.
---

<div class="nt-badges">
  <a href="https://www.npmjs.com/package/ngx-transformers"><img src="https://img.shields.io/npm/v/ngx-transformers" alt="ngx-transformers on npm" /></a>
  <a href="https://www.npmjs.com/package/ngx-transformers"><img src="https://img.shields.io/npm/dw/ngx-transformers" alt="weekly npm downloads" /></a>
  <a href="https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml"><img src="https://github.com/qwertymuzaffar/ngx-transformers/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <img src="https://img.shields.io/npm/l/ngx-transformers" alt="MIT license" />
</div>

## Install

```sh
npm install ngx-transformers @huggingface/transformers
```

Angular 22 or newer; `@huggingface/transformers` v4 is a peer dependency. Then follow [Getting started](/guide/getting-started): sentiment analysis is about fifteen lines.

## See it live

The published package, running here. The first click on each card downloads a model (23 to 105 MB); after that the browser cache serves it.

<DemoFrame />

## Why this exists

Transformers.js has a React tutorial and a hooks ecosystem; Angular had nothing. This library wraps each pipeline in a small handle with signals for the lifecycle, defaults that work (a sensible checkpoint per task, quantized weights, WebGPU when the machine has it), DI-friendly configuration, automatic disposal with the owning component, and a drop-in progress line for the download. The [Concepts](/guide/concepts) page explains the design in a few minutes.
