/**
 * Messages between the main thread (client.ts) and the worker (host.ts).
 * Every request carries an id the response echoes; pipelines get a pipeId.
 */

export interface CreateRequest {
  type: 'create';
  id: number;
  task: string;
  model?: string;
  /** Pipeline options without functions; progress is reported by message. */
  options: Record<string, unknown>;
}

export interface RunRequest {
  type: 'run';
  id: number;
  pipeId: number;
  /** The input followed by the pipeline's positional arguments (options last). */
  args: unknown[];
  /** Stream generated text back as `token` messages (the onToken run option). */
  stream: boolean;
}

export interface DisposeRequest {
  type: 'dispose';
  pipeId: number;
}

export type WorkerRequest = CreateRequest | RunRequest | DisposeRequest;

export interface CreatedResponse {
  type: 'created';
  id: number;
  pipeId: number;
}

export interface ResultResponse {
  type: 'result';
  id: number;
  result: unknown;
}

export interface ErrorResponse {
  type: 'error';
  id: number;
  name: string;
  message: string;
}

export interface ProgressResponse {
  type: 'progress';
  id: number;
  event: Record<string, unknown>;
}

export interface TokenResponse {
  type: 'token';
  id: number;
  text: string;
}

export type WorkerResponse =
  CreatedResponse | ResultResponse | ErrorResponse | ProgressResponse | TokenResponse;

/**
 * A Transformers.js Tensor after crossing the worker boundary: the class is
 * lost to structured cloning, so the host sends its shape and buffer.
 */
export interface TensorData {
  dims: number[];
  data: ArrayLike<number>;
}
