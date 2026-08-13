import {PaymentLedgerError} from "./errors.js";
import type {PaymentLedger} from "./ledger.js";
import type {PaymentRecord, SettlementReceipt} from "./types.js";
import {normalizeHttpsOrigin} from "./utils.js";

export type ReceiptResolver = (record: PaymentRecord) => Promise<SettlementReceipt>;
const MAX_RECEIPT_BODY_LENGTH = 128 * 1_024;

const RECEIPT_STATUSES = new Set([
  "pending",
  "verified",
  "settling",
  "settled",
  "fulfilling",
  "delivered",
  "failed",
  "settlement_unknown",
]);

const nullableString = (value: unknown): boolean => (
  value === undefined || value === null || typeof value === "string"
);

const isSettlementReceipt = (value: unknown): value is SettlementReceipt => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;

  return (
    typeof receipt.id === "string"
    && typeof receipt.status === "string"
    && RECEIPT_STATUSES.has(receipt.status)
    && (receipt.network === "stellar:testnet" || receipt.network === "stellar:pubnet")
    && typeof receipt.asset === "string"
    && typeof receipt.amountAtomic === "string"
    && typeof receipt.payTo === "string"
    && typeof receipt.createdAt === "string"
    && nullableString(receipt.payer)
    && nullableString(receipt.transaction)
    && nullableString(receipt.deliveredAt)
    && nullableString(receipt.settledAt)
    && nullableString(receipt.servedAt)
  );
};

export const recoverPendingReceipts = async ({
  ledger,
  resolve,
  limit = 5,
  now = Date.now(),
}: {
  ledger: PaymentLedger;
  resolve: ReceiptResolver;
  limit?: number;
  now?: number;
}): Promise<PaymentRecord[]> => {
  const records = ledger.list()
    .filter((record) => (
      record.receipt?.id
      && ["authorized", "submitted", "settlement_unknown"].includes(record.status)
    ))
    .slice(0, Math.max(0, Math.min(limit, 20)));
  const results: PaymentRecord[] = [];

  for (const record of records) {
    try {
      const receipt = await resolve(record);
      results.push(ledger.attachReceipt(receipt, {origin: record.origin, payer: record.payer, now}));
    }
    catch {
      results.push(record);
    }
  }

  return results;
};

export const createHttpsReceiptResolver = ({
  buildUrl,
  allowedOrigins,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
}: {
  buildUrl: (record: PaymentRecord) => string;
  allowedOrigins: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ReceiptResolver => {
  const normalizedOrigins = allowedOrigins.map((origin) => normalizeHttpsOrigin(origin));
  const origins = new Set(normalizedOrigins.filter(Boolean));

  if (
    origins.size === 0
    || origins.size !== allowedOrigins.length
    || typeof fetchImpl !== "function"
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > 60_000
  ) {
    throw new PaymentLedgerError("Receipt resolver configuration is invalid.", "X402_RECEIPT_RESOLVER_INVALID");
  }

  return async (record) => {
    let url: URL;

    try {
      url = new URL(buildUrl(record));
    }
    catch (error) {
      throw new PaymentLedgerError("Receipt URL is invalid.", "X402_RECEIPT_URL_BLOCKED", {cause: error});
    }

    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.hash
      || !origins.has(url.origin)
    ) {
      throw new PaymentLedgerError("Receipt URL is not allowed.", "X402_RECEIPT_URL_BLOCKED");
    }

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {accept: "application/json"},
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new PaymentLedgerError(
          `Receipt endpoint returned HTTP ${response.status}.`,
          "X402_RECEIPT_UNAVAILABLE",
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RECEIPT_BODY_LENGTH) {
        throw new PaymentLedgerError("Receipt response is too large.", "X402_RECEIPT_INVALID");
      }

      const body = await response.text();
      if (!body || body.length > MAX_RECEIPT_BODY_LENGTH) {
        throw new PaymentLedgerError("Receipt response is empty or too large.", "X402_RECEIPT_INVALID");
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      }
      catch (error) {
        throw new PaymentLedgerError("Receipt response is not valid JSON.", "X402_RECEIPT_INVALID", {cause: error});
      }
      const receipt = payload && typeof payload === "object" && !Array.isArray(payload) && "receipt" in payload
        ? (payload as {receipt?: unknown}).receipt
        : payload;

      if (!isSettlementReceipt(receipt)) {
        throw new PaymentLedgerError("Receipt response is invalid.", "X402_RECEIPT_INVALID");
      }

      return receipt;
    }
    finally {
      globalThis.clearTimeout(timeout);
    }
  };
};
