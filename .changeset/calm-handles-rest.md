---
'ngx-transformers': patch
---

Fix two `PipelineHandle` lifecycle races. `dispose()` during a model download now cancels the load: the model is released when it arrives, the handle stays idle, its progress events are ignored, and a `run()` that was waiting on that load rejects with a clear error instead of the model leaking and the status flipping to ready after the owning component was destroyed. Overlapping `run()` calls now keep the status `busy` until the last one finishes instead of the first one to complete flipping it back to ready. Handles and translators created with `create*()` are now destroyed, not merely disposed, with their component: `destroy()` releases the model and makes later `load()` / `run()` calls reject, so a stale callback can no longer re-download a model nobody would free. `dispose()` keeps its meaning and still allows a reload.

The npm package now ships the LICENSE file and the current README (both copied from the repository root at build time; the package README for 0.3.0 still listed zero-shot classification and translation under "Roadmap").

Add `createDefaultPipelineFactory()`, the lazy-importing factory behind `PIPELINE_FACTORY`, so apps can wrap it (logging, extra options) instead of re-implementing the import.
