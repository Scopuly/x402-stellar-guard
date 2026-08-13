export type GuardErrorDetails = Record<string, unknown>;

export class X402GuardError extends Error {
  readonly code: string;
  readonly details: GuardErrorDetails;

  constructor(message: string, code = "X402_GUARD_ERROR", details: GuardErrorDetails = {}) {
    super(message);
    this.name = "X402GuardError";
    this.code = code;
    this.details = details;
  }
}

export class PaymentRequiredError extends X402GuardError {
  constructor(message: string, code = "X402_PAYMENT_REQUIRED_INVALID", details: GuardErrorDetails = {}) {
    super(message, code, details);
    this.name = "PaymentRequiredError";
  }
}

export class AuthorizationGuardError extends X402GuardError {
  constructor(message: string, code = "X402_AUTHORIZATION_UNSAFE", details: GuardErrorDetails = {}) {
    super(message, code, details);
    this.name = "AuthorizationGuardError";
  }
}

export class PolicyError extends X402GuardError {
  constructor(message: string, code = "X402_POLICY_ERROR", details: GuardErrorDetails = {}) {
    super(message, code, details);
    this.name = "PolicyError";
  }
}

export class PaymentLedgerError extends X402GuardError {
  constructor(message: string, code = "X402_LEDGER_ERROR", details: GuardErrorDetails = {}) {
    super(message, code, details);
    this.name = "PaymentLedgerError";
  }
}

export class ConformanceError extends X402GuardError {
  constructor(message: string, code = "X402_CONFORMANCE_ERROR", details: GuardErrorDetails = {}) {
    super(message, code, details);
    this.name = "ConformanceError";
  }
}
