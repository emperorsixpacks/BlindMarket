import type { ErrorCode } from './codes.js';

export interface ErrorOptions {
  retriable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class BlindMarketError extends Error {
  readonly code: ErrorCode;
  readonly retriable: boolean;
  readonly context?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, opts: ErrorOptions = {}) {
    super(message);
    this.code = code;
    this.retriable = opts.retriable ?? false;
    if (opts.context !== undefined) this.context = opts.context;
    if (opts.cause !== undefined) this.cause = opts.cause;
    Object.defineProperty(this, 'name', {
      value: this.constructor.name,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retriable: this.retriable,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}
