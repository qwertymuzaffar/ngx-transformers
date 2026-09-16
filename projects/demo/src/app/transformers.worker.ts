/// <reference lib="webworker" />
import { runTransformersWorker } from 'ngx-transformers/worker';

// Every pipeline of the demo runs here; see provideTransformersWorker() in app.config.ts.
runTransformersWorker();
