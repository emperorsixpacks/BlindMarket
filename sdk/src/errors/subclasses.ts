import { BlindMarketError, type ErrorOptions } from './BlindMarketError.js';
import type {
  ApiCode,
  ChainCode,
  ComputeCode,
  ConfigCode,
  CryptoCode,
  LifecycleCode,
  StorageCode,
  TimeoutCode,
} from './codes.js';

export class ConfigError extends BlindMarketError {
  constructor(code: ConfigCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class CryptoError extends BlindMarketError {
  constructor(code: CryptoCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class StorageError extends BlindMarketError {
  constructor(code: StorageCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class ChainError extends BlindMarketError {
  constructor(code: ChainCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class ComputeError extends BlindMarketError {
  constructor(code: ComputeCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class ApiError extends BlindMarketError {
  constructor(code: ApiCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class LifecycleError extends BlindMarketError {
  constructor(code: LifecycleCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}

export class TimeoutError extends BlindMarketError {
  constructor(code: TimeoutCode, msg: string, opts?: ErrorOptions) {
    super(code, msg, opts);
  }
}
