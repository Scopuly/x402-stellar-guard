import {Address, hash} from "@stellar/stellar-sdk";
import {Buffer} from "buffer";

import {X402GuardError} from "./errors.js";

const MAX_SIGNED_I128 = (1n << 127n) - 1n;
const MIN_SIGNED_I128 = -(1n << 127n);

export const assertAtomicAmount = (value: unknown, field = "amount"): string => {
  const amount = typeof value === "string" ? value : "";

  if (
    !/^[1-9][0-9]{0,38}$/.test(amount)
    || BigInt(amount) > MAX_SIGNED_I128
  ) {
    throw new X402GuardError(`${field} must be a positive atomic integer string.`, "X402_AMOUNT_INVALID");
  }

  return amount;
};

export const formatAtomicAmount = (value: string, decimals = 7): string => {
  if (
    typeof value !== "string"
    || !/^-?(?:0|[1-9][0-9]{0,38})$/.test(value)
    || !Number.isSafeInteger(decimals)
    || decimals < 0
    || decimals > 18
  ) {
    throw new X402GuardError(
      "Atomic value or decimal precision is invalid.",
      "X402_AMOUNT_FORMAT_INVALID",
    );
  }

  const amount = BigInt(value);
  if (amount < MIN_SIGNED_I128 || amount > MAX_SIGNED_I128) {
    throw new X402GuardError("Atomic value is outside signed i128.", "X402_AMOUNT_FORMAT_INVALID");
  }
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
};

export const normalizeHttpsOrigin = (value: string, allowLocalhost = false): string => {
  try {
    const url = new URL(value);
    const local = allowLocalhost && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
      return "";
    }

    return url.origin;
  }
  catch {
    return "";
  }
};

export const normalizeResourceUrl = (value: string, allowLocalhost = false): string => {
  try {
    const url = new URL(value);
    const local = allowLocalhost && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) {
      return "";
    }

    return url.toString();
  }
  catch {
    return "";
  }
};

export const isValidStellarAddress = (value: string): boolean => {
  try {
    Address.fromString(value);
    return value.startsWith("G") || value.startsWith("C");
  }
  catch {
    return false;
  }
};

export const isValidContractAddress = (value: string): boolean => {
  try {
    Address.fromString(value);
    return value.startsWith("C");
  }
  catch {
    return false;
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const sha256Hex = (value: string | Uint8Array): string => {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return hash(bytes).toString("hex");
};

export const sanitizeText = (value: unknown, maxLength = 256): string => (
  typeof value === "string" ? value.trim().slice(0, maxLength) : ""
);

export const utcDay = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);
