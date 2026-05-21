// Shared typed error classes for the server/services layer.
// Routes translate these into HTTP responses; UI surfaces the `code` to users.

export type AuthErrorCode =
  | 'email_taken'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'invalid_input'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'duplicate_key';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly details?: unknown;

  constructor(code: AuthErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

export class NotImplementedError extends Error {
  constructor(message = 'not_implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}
