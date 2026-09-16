/**
 * Run Transformers.js pipelines in a Web Worker. This entry point has no
 * Angular dependency, so a worker file can import it; the main thread uses
 * provideTransformersWorker() from ngx-transformers.
 *
 * @module ngx-transformers/worker
 */

export * from './protocol';
export * from './run-options';
export * from './host';
export * from './client';
