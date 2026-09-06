import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ModelProgress, PipelineStatus } from './transformers.models';

/**
 * Drop-in status line for a PipelineHandle: shows model download progress
 * while loading, then the ready/busy/error state. Themeable via CSS custom
 * properties (--nt-accent, --nt-ink, --nt-muted, --nt-track).
 *
 * ```html
 * <ngx-model-progress [status]="classifier.status()" [progress]="classifier.progress()" />
 * ```
 */
@Component({
  selector: 'ngx-model-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nt-row" [class.nt-error]="status() === 'error'" role="status">
      <span class="nt-dot" [attr.data-status]="status()"></span>
      <span class="nt-label">{{ label() }}</span>
      @if (status() === 'loading' && progress(); as p) {
        <span class="nt-file">{{ p.file }}</span>
        <div class="nt-track" role="progressbar" [attr.aria-valuenow]="p.progress" aria-valuemin="0" aria-valuemax="100">
          <div class="nt-fill" [style.width.%]="p.progress"></div>
        </div>
        <span class="nt-pct">{{ p.progress }}%</span>
      }
    </div>
  `,
  styles: `
    :host {
      --nt-accent: #f59e0b;
      --nt-ink: #1e293b;
      --nt-muted: #64748b;
      --nt-track: #e2e8f0;
      display: block;
      font-size: 12.5px;
      color: var(--nt-ink);
    }
    .nt-row { display: flex; align-items: center; gap: 8px; }
    .nt-dot {
      width: 8px; height: 8px; border-radius: 50%; flex: none;
      background: var(--nt-muted);
    }
    .nt-dot[data-status='loading'] { background: var(--nt-accent); animation: nt-blink 1s ease-in-out infinite; }
    .nt-dot[data-status='ready'] { background: #22c55e; }
    .nt-dot[data-status='busy'] { background: #3b82f6; animation: nt-blink 0.7s ease-in-out infinite; }
    .nt-dot[data-status='error'] { background: #dc2626; }
    .nt-label { font-weight: 600; }
    .nt-file { color: var(--nt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
    .nt-track {
      flex: 1; min-width: 60px; height: 6px; border-radius: 3px;
      background: var(--nt-track); overflow: hidden;
    }
    .nt-fill { height: 100%; background: var(--nt-accent); border-radius: 3px; transition: width 120ms linear; }
    .nt-pct { font-variant-numeric: tabular-nums; color: var(--nt-muted); }
    .nt-error .nt-label { color: #dc2626; }
    @keyframes nt-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) {
      .nt-dot { animation: none; }
      .nt-fill { transition: none; }
    }
  `,
})
export class ModelProgressComponent {
  status = input.required<PipelineStatus>();
  progress = input<ModelProgress | null>(null);
  /** Labels per status; override to localize. */
  labels = input<Partial<Record<PipelineStatus, string>>>({});

  readonly label = computed(() => {
    const defaults: Record<PipelineStatus, string> = {
      idle: 'Model not loaded',
      loading: 'Downloading model',
      ready: 'Model ready',
      busy: 'Running',
      error: 'Failed to load model',
    };
    return this.labels()[this.status()] ?? defaults[this.status()];
  });
}
