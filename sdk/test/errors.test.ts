import { describe, expect, it } from 'vitest';
import {
  BlindMarketError,
  ConfigError,
  CryptoError,
  StorageError,
  ChainError,
  ComputeError,
  ApiError,
  LifecycleError,
  TimeoutError,
} from '../src/errors/index.js';

describe('BlindMarketError', () => {
  it('preserves code, message, retriable, context, cause', () => {
    const cause = new Error('root');
    const err = new StorageError('STORAGE/UPLOAD_FAILED', 'upload blew up', {
      retriable: true,
      context: { attempt: 1 },
      cause,
    });
    expect(err).toBeInstanceOf(BlindMarketError);
    expect(err.name).toBe('StorageError');
    expect(err.code).toBe('STORAGE/UPLOAD_FAILED');
    expect(err.message).toBe('upload blew up');
    expect(err.retriable).toBe(true);
    expect(err.context).toEqual({ attempt: 1 });
    expect(err.cause).toBe(cause);
  });

  it('defaults retriable to false', () => {
    const err = new ConfigError('CONFIG/MISSING_SIGNER', 'no signer');
    expect(err.retriable).toBe(false);
  });

  it('exposes a stable toJSON for telemetry (no secrets)', () => {
    const err = new ApiError('API/VALIDATION', 'bad input', { context: { field: 'reward' } });
    const j = err.toJSON();
    expect(j).toMatchObject({
      name: 'ApiError',
      code: 'API/VALIDATION',
      message: 'bad input',
      retriable: false,
      context: { field: 'reward' },
    });
    expect(j).not.toHaveProperty('cause');
  });

  it.each([
    [ConfigError, 'CONFIG/MISSING_SIGNER'],
    [CryptoError, 'CRYPTO/DECRYPT_FAILED'],
    [StorageError, 'STORAGE/NOT_FOUND'],
    [ChainError, 'CHAIN/TX_REVERTED'],
    [ComputeError, 'COMPUTE/BROKER_UNREACHABLE'],
    [ApiError, 'API/RATE_LIMITED'],
    [LifecycleError, 'LIFECYCLE/ILLEGAL_TRANSITION'],
    [TimeoutError, 'TIMEOUT'],
  ] as const)('subclass %p accepts its canonical code', (Ctor, code) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic ctor call for table test
    const err = new (Ctor as any)(code, 'msg');
    expect(err.code).toBe(code);
    expect(err).toBeInstanceOf(BlindMarketError);
  });
});
