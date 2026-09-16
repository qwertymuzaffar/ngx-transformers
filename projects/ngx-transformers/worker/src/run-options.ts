/**
 * Helpers shared by the in-thread and worker pipeline factories for the run
 * options ngx-transformers adds on top of the Transformers.js ones.
 */

/** Run option: called with each piece of generated text (text-generation). */
export type OnToken = (text: string) => void;

const ON_TOKEN = 'onToken';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pulls the `onToken` callback out of a pipeline call's trailing options
 * object. Returns the arguments without it, plus the callback if present.
 */
export function takeOnToken(args: unknown[]): { args: unknown[]; onToken?: OnToken } {
  const last = args[args.length - 1];
  if (!isPlainObject(last) || typeof last[ON_TOKEN] !== 'function') return { args };
  const { [ON_TOKEN]: onToken, ...rest } = last;
  return { args: [...args.slice(0, -1), rest], onToken: onToken as OnToken };
}

/** A shallow copy of an options object without its function-valued entries. */
export function withoutFunctions(options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value !== 'function') out[key] = value;
  }
  return out;
}

/** Same as withoutFunctions() for the trailing options object of a call, if any. */
export function withoutFunctionsInLast(args: unknown[]): unknown[] {
  const last = args[args.length - 1];
  if (!isPlainObject(last)) return args;
  return [...args.slice(0, -1), withoutFunctions(last)];
}
