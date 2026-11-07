export const ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_CREDENTIALS',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'QUOTA_EXCEEDED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const invalidInput = (message: string, details?: unknown) =>
  new AppError('INVALID_INPUT', 400, message, { details });

export const invalidCredentials = (message = 'Email or password is incorrect') =>
  new AppError('INVALID_CREDENTIALS', 401, message);

export const unauthorized = (message = 'Authentication required') =>
  new AppError('UNAUTHORIZED', 401, message);

export const notFound = (message = 'Resource not found') => new AppError('NOT_FOUND', 404, message);

export const quotaExceeded = (message: string, retryAfterSeconds: number, details?: unknown) =>
  new AppError('QUOTA_EXCEEDED', 429, message, { retryAfterSeconds, details });

export const internal = (message = 'Internal server error') => new AppError('INTERNAL', 500, message);
