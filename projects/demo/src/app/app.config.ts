import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTransformersWorker } from 'ngx-transformers';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Inference runs in a Web Worker, so the page stays responsive while a model works.
    provideTransformersWorker(
      () => new Worker(new URL('./transformers.worker', import.meta.url), { type: 'module' }),
    ),
  ],
};
