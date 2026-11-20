export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  QUARTER_CLOSED: 'QUARTER_CLOSED',
  QUARTER_NOT_READY: 'QUARTER_NOT_READY',
  CRITICAL_ALERTS: 'CRITICAL_ALERTS',
  DUPLICATE_INVOICE: 'DUPLICATE_INVOICE',
  BEFORE_ACTIVITY_START: 'BEFORE_ACTIVITY_START',
  INVALID_VAT: 'INVALID_VAT',
  INVALID_TOTAL: 'INVALID_TOTAL',
  INVALID_IRPF: 'INVALID_IRPF',
  VAT_ZERO_NEEDS_TREATMENT: 'VAT_ZERO_NEEDS_TREATMENT',
  LOCKED_MOVEMENT: 'LOCKED_MOVEMENT',
  CORRECTION_REQUIRED: 'CORRECTION_REQUIRED',
  REOPEN_REQUIRED: 'REOPEN_REQUIRED',
  TAX_RULE_UNCERTAIN: 'TAX_RULE_UNCERTAIN',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ApiErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
