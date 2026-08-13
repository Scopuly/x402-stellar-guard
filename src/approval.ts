import {X402GuardError} from "./errors.js";

export const DEFAULT_APPROVAL_TOKEN_TTL_MS = 60_000;

interface Approval {
  fingerprint: string;
  expiresAt: number;
}

export interface ApprovalTokenStoreOptions {
  ttlMs?: number;
  randomBytes?: (length: number) => Uint8Array;
}

const secureRandomBytes = (length: number): Uint8Array => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new X402GuardError("Secure randomness is unavailable.", "X402_APPROVAL_RANDOM_UNAVAILABLE");
  }

  return globalThis.crypto.getRandomValues(new Uint8Array(length));
};

export class ApprovalTokenStore {
  readonly #approvals = new Map<string, Approval>();
  readonly #ttlMs: number;
  readonly #randomBytes: (length: number) => Uint8Array;

  constructor(options: ApprovalTokenStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TOKEN_TTL_MS;
    this.#randomBytes = options.randomBytes ?? secureRandomBytes;

    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > 5 * 60_000) {
      throw new X402GuardError("Approval token TTL is outside the safe range.", "X402_APPROVAL_TTL_INVALID");
    }
  }

  issue(fingerprint: string, now = Date.now()): string {
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
      throw new X402GuardError("A SHA-256 payment fingerprint is required.", "X402_APPROVAL_FINGERPRINT_INVALID");
    }

    this.prune(now);
    const token = Array.from(
      this.#randomBytes(24),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");

    if (!/^[a-f0-9]{48}$/i.test(token) || this.#approvals.has(token)) {
      throw new X402GuardError("A unique approval token could not be created.", "X402_APPROVAL_TOKEN_INVALID");
    }

    this.#approvals.set(token, {fingerprint, expiresAt: now + this.#ttlMs});
    return token;
  }

  consume(token: string, fingerprint: string, now = Date.now()): boolean {
    this.prune(now);
    const approval = this.#approvals.get(token);

    if (!approval || approval.fingerprint !== fingerprint) return false;

    this.#approvals.delete(token);
    return approval.expiresAt > now;
  }

  clear(): void {
    this.#approvals.clear();
  }

  private prune(now: number): void {
    for (const [token, approval] of this.#approvals) {
      if (approval.expiresAt <= now) this.#approvals.delete(token);
    }
  }
}
