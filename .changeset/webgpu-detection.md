---
'ngx-transformers': patch
---

Add `hasWebGpu()` and `detectDevice()`, a cached WebGPU probe that also requests an adapter and resolves to the WASM answer on the server, plus an `autoDevice` option for `provideTransformers()` that picks `'webgpu'` when available for every handle without an explicit device.
