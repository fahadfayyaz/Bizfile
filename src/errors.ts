/**
 * Typed errors so the HTTP layer can map failures onto sensible status codes
 * instead of turning everything into a 500.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Neither companyName nor companyNumber was supplied, or they were malformed. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

/** The search ran fine, BizFile just has no entity matching the input. */
export class CompanyNotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super('COMPANY_NOT_FOUND', message, 404, details);
  }
}

/**
 * BizFile rejected our reCAPTCHA token (CORELIB-VAL-016), and it kept
 * rejecting it after every retry. Almost always an IP reputation problem.
 */
export class AntiBotError extends AppError {
  constructor(message: string, details?: unknown) {
    super('ANTIBOT_BLOCKED', message, 503, details);
  }
}

/** BizFile answered, but with an error we do not have a specific mapping for. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UPSTREAM_ERROR', message, 502, details);
  }
}

/** The browser could not start, or the session died and would not recover. */
export class BrowserError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BROWSER_ERROR', message, 500, details);
  }
}

/** The whole request exceeded REQUEST_TIMEOUT_MS. */
export class TimeoutError extends AppError {
  constructor(message: string, details?: unknown) {
    super('TIMEOUT', message, 504, details);
  }
}
