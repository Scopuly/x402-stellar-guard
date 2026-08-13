import {Buffer} from "buffer";

import {isStellarX402Network, passphraseToNetwork} from "./constants.js";
import {PaymentLedgerError} from "./errors.js";
import {authorizationPayloadHash} from "./soroban.js";
import type {
  AuthorizationReview,
  DailySpendSummary,
  GuardedPaymentIntent,
  PaymentRecord,
  PaymentRecordStatus,
  SettlementReceipt,
  SettlementStatus,
  StorageLike,
  StoredReceipt,
} from "./types.js";
import {
  assertAtomicAmount,
  canonicalJson,
  formatAtomicAmount,
  isValidContractAddress,
  isValidStellarAddress,
  normalizeHttpsOrigin,
  sanitizeText,
  sha256Hex,
  utcDay,
} from "./utils.js";

const DEFAULT_RECORD_LIMIT = 250;
export const REPLAY_FINGERPRINT_LIMIT = 10_000;
const MAX_REPLAY_JOURNAL_LENGTH = 1_024 * 1_024;
const MAX_LEDGER_STORAGE_LENGTH = 8 * 1_024 * 1_024;
const MAX_DAILY_SPEND_STORAGE_LENGTH = 1_024 * 1_024;
const SIGNING_RESERVATION_TTL_MS = 10 * 60_000;
const RECEIPT_MATCH_WINDOW_MS = 10 * 60_000;
const PAYMENT_RECORD_STATUSES = new Set<PaymentRecordStatus>([
  "signing",
  "authorized",
  "submitted",
  "settlement_unknown",
  "delivered",
  "failed",
]);
const COUNTED_STATUSES = new Set<PaymentRecordStatus>(["signing", "authorized", "submitted", "delivered"]);
const RECEIPT_STATUSES = new Set<SettlementStatus>([
  "pending",
  "verified",
  "settling",
  "settled",
  "fulfilling",
  "delivered",
  "failed",
  "settlement_unknown",
]);

const isPaymentRecordStatus = (value: unknown): value is PaymentRecordStatus => (
  typeof value === "string" && PAYMENT_RECORD_STATUSES.has(value as PaymentRecordStatus)
);

const isSettlementStatus = (value: unknown): value is SettlementStatus => (
  typeof value === "string" && RECEIPT_STATUSES.has(value as SettlementStatus)
);

export interface PaymentLedgerOptions {
  storage?: StorageLike;
  keyPrefix?: string;
  recordLimit?: number;
}

export interface ReservePaymentOptions {
  intent: GuardedPaymentIntent;
  authorization: AuthorizationReview;
  serviceName?: string;
  now?: number;
}

const defaultStorage = (): StorageLike | null => (
  typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage
);

const normalizeTimestamp = (value: unknown, fallback = Date.now()): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
};

const isCounted = (record: PaymentRecord, now: number): boolean => {
  if (!COUNTED_STATUSES.has(record.status)) return false;
  return record.status !== "signing" || now - record.updatedAt <= SIGNING_RESERVATION_TTL_MS;
};

const dailyKey = (day: string, network: string, payer: string): string => `${day}|${network}|${payer}`;

export class PaymentLedger {
  readonly #storage: StorageLike;
  readonly #ledgerKey: string;
  readonly #dailySpendKey: string;
  readonly #replayKey: string;
  readonly #receiptReplayKey: string;
  readonly #recordLimit: number;

  constructor(options: PaymentLedgerOptions = {}) {
    const storage = options.storage ?? defaultStorage();

    if (!storage) {
      throw new PaymentLedgerError("A persistent storage adapter is required.", "X402_STORAGE_UNAVAILABLE");
    }

    const prefix = sanitizeText(options.keyPrefix ?? "scopuly_x402_guard_v1", 80);
    this.#storage = storage;
    this.#ledgerKey = `${prefix}:ledger`;
    this.#dailySpendKey = `${prefix}:daily-spend`;
    this.#replayKey = `${prefix}:replay-fingerprints`;
    this.#receiptReplayKey = `${prefix}:receipt-ids`;
    this.#recordLimit = options.recordLimit ?? DEFAULT_RECORD_LIMIT;

    if (!prefix || !Number.isSafeInteger(this.#recordLimit) || this.#recordLimit < 10 || this.#recordLimit > 10_000) {
      throw new PaymentLedgerError("Payment ledger configuration is invalid.", "X402_LEDGER_CONFIG_INVALID");
    }
  }

  list(): PaymentRecord[] {
    try {
      const raw = this.#storage.getItem(this.#ledgerKey);
      if (raw === null) return [];
      if (raw.length > MAX_LEDGER_STORAGE_LENGTH) throw new Error();

      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length > this.#recordLimit) throw new Error();

      const records = value.map((entry) => this.sanitizeRecord(entry));
      if (records.some((entry) => entry === null)) throw new Error();
      return records as PaymentRecord[];
    }
    catch (error) {
      if (error instanceof PaymentLedgerError) throw error;
      throw new PaymentLedgerError(
        "The payment ledger is corrupted; refusing to use incomplete safety state.",
        "X402_LEDGER_STORAGE_INVALID",
        {cause: error},
      );
    }
  }

  getDailySummary(
    network: GuardedPaymentIntent["network"],
    payer: string,
    dailyLimitAtomic: string,
    now = Date.now(),
  ): DailySpendSummary {
    const limit = BigInt(assertAtomicAmount(dailyLimitAtomic, "dailyLimitAtomic"));
    const day = utcDay(now);
    const records = this.list();
    const spend = this.readDailySpend();
    const completed = BigInt(spend[dailyKey(day, network, payer)] ?? "0");
    const signing = records
      .filter((record) => (
        record.day === day
        && record.network === network
        && record.payer === payer
        && record.status === "signing"
        && isCounted(record, now)
      ))
      .reduce((total, record) => total + BigInt(record.amountAtomic), 0n);
    const total = completed + signing;

    return {
      day,
      network,
      payer,
      spentAtomic: total.toString(),
      limitAtomic: limit.toString(),
      remainingAtomic: (limit > total ? limit - total : 0n).toString(),
      isLimitReached: total >= limit,
    };
  }

  reserve(options: ReservePaymentOptions): PaymentRecord {
    const now = normalizeTimestamp(options.now);
    const {intent, authorization} = options;

    let expectedAuthorizationFingerprint = "";
    let expectedIntentFingerprint = "";

    try {
      expectedAuthorizationFingerprint = Buffer.from(
        authorizationPayloadHash(authorization.authEntry, authorization.networkPassphrase),
      ).toString("hex");
      expectedIntentFingerprint = sha256Hex(canonicalJson({
        x402Version: intent.x402Version,
        resource: intent.resource,
        requirement: intent.requirement,
        origin: intent.origin,
        payer: intent.payer,
      }));
    }
    catch (error) {
      throw new PaymentLedgerError(
        "Authorization review or guarded intent is invalid.",
        "X402_LEDGER_INTENT_MISMATCH",
        {cause: error},
      );
    }

    if (
      !/^[a-f0-9]{64}$/.test(authorization.fingerprint)
      || authorization.fingerprint !== expectedAuthorizationFingerprint
      || !/^[a-f0-9]{64}$/.test(intent.fingerprint)
      || intent.fingerprint !== expectedIntentFingerprint
      || authorization.network !== intent.network
      || passphraseToNetwork(authorization.networkPassphrase) !== authorization.network
      || authorization.payment.activeNetwork !== intent.network
      || !authorization.payment.isSafe
      || authorization.payment.issues.length !== 0
      || !Number.isSafeInteger(authorization.expirationLedger)
      || authorization.expirationLedger <= 0
      || authorization.payment.from !== intent.payer
      || authorization.payment.to !== intent.payTo
      || authorization.payment.contract !== intent.asset.contract
      || authorization.payment.amountAtomic !== intent.amountAtomic
    ) {
      throw new PaymentLedgerError(
        "Authorization review does not match the guarded intent.",
        "X402_LEDGER_INTENT_MISMATCH",
      );
    }

    const records = this.list();
    const attemptedFingerprints = this.readReplayFingerprints();
    for (const record of records) attemptedFingerprints.add(record.fingerprint.toLowerCase());

    if (attemptedFingerprints.has(authorization.fingerprint)) {
      throw new PaymentLedgerError(
        "This authorization was already attempted; create a fresh authorization entry.",
        "X402_DUPLICATE_AUTHORIZATION",
      );
    }

    if (attemptedFingerprints.size >= REPLAY_FINGERPRINT_LIMIT) {
      throw new PaymentLedgerError(
        "The replay journal is full; protected storage maintenance is required.",
        "X402_REPLAY_JOURNAL_FULL",
      );
    }

    const summary = this.getDailySummary(intent.network, intent.payer, intent.dailyLimitAtomic, now);

    if (BigInt(summary.spentAtomic) + BigInt(intent.amountAtomic) > BigInt(summary.limitAtomic)) {
      throw new PaymentLedgerError(
        "Payment would exceed the daily policy limit.",
        "X402_DAILY_LIMIT_EXCEEDED",
      );
    }

    const record: PaymentRecord = {
      id: `x402-${authorization.fingerprint}`,
      fingerprint: authorization.fingerprint,
      createdAt: now,
      updatedAt: now,
      day: utcDay(now),
      origin: intent.origin,
      serviceName: sanitizeText(options.serviceName, 120),
      network: intent.network,
      payer: intent.payer,
      payTo: intent.payTo,
      assetCode: intent.asset.code,
      assetContract: intent.asset.contract,
      assetDecimals: intent.asset.decimals,
      amountAtomic: intent.amountAtomic,
      amountDisplay: intent.amountDisplay,
      dailyLimitAtomic: intent.dailyLimitAtomic,
      policyVersion: intent.policyVersion,
      expirationLedger: authorization.expirationLedger,
      status: "signing",
      errorCode: "",
      receipt: null,
    };

    attemptedFingerprints.add(authorization.fingerprint);
    this.writeReplayFingerprints(attemptedFingerprints);
    this.write([record, ...records.filter((entry) => entry.id !== record.id)]);
    return record;
  }

  authorize(id: string, now = Date.now()): PaymentRecord {
    const record = this.requireRecord(id);

    if (record.status === "authorized") return record;
    if (record.status !== "signing") {
      throw new PaymentLedgerError(
        `Cannot authorize a payment in ${record.status} state.`,
        "X402_LEDGER_STATE_INVALID",
      );
    }

    const spend = this.readDailySpend();
    const key = dailyKey(record.day, record.network, record.payer);
    spend[key] = (BigInt(spend[key] ?? "0") + BigInt(record.amountAtomic)).toString();
    this.writeDailySpend(spend, now);

    return this.update(id, {status: "authorized", errorCode: ""}, now);
  }

  markSubmitted(id: string, now = Date.now()): PaymentRecord {
    const record = this.requireRecord(id);
    if (record.status === "submitted") return record;
    if (record.status !== "authorized") {
      throw new PaymentLedgerError(
        `Cannot submit a payment in ${record.status} state.`,
        "X402_LEDGER_STATE_INVALID",
      );
    }
    return this.update(id, {status: "submitted"}, now);
  }

  fail(id: string, errorCode = "PAYMENT_FAILED", now = Date.now()): PaymentRecord {
    const record = this.requireRecord(id);
    if (record.status === "failed") return record;
    if (record.status === "delivered") {
      throw new PaymentLedgerError(
        "A delivered payment cannot transition to failed.",
        "X402_LEDGER_STATE_INVALID",
      );
    }
    return this.update(id, {status: "failed", errorCode: sanitizeText(errorCode, 80)}, now);
  }

  attachReceipt(
    receipt: SettlementReceipt,
    context: {origin: string; payer: string; now?: number},
  ): PaymentRecord {
    const now = normalizeTimestamp(context.now);
    const id = typeof receipt.id === "string" ? receipt.id.trim().toLowerCase() : "";
    const transaction = typeof receipt.transaction === "string" ? receipt.transaction.trim().toLowerCase() : "";
    const origin = normalizeHttpsOrigin(context.origin);
    const createdAt = Date.parse(receipt.createdAt);
    const amountAtomic = assertAtomicAmount(receipt.amountAtomic, "receipt.amountAtomic");
    const servedAt = receipt.deliveredAt ?? receipt.settledAt ?? receipt.servedAt ?? receipt.createdAt;

    if (
      !/^[a-f0-9]{32,64}$/i.test(id)
      || !RECEIPT_STATUSES.has(receipt.status)
      || !isStellarX402Network(receipt.network)
      || !origin
      || !isValidStellarAddress(receipt.payTo)
      || (receipt.payer != null && !isValidStellarAddress(receipt.payer))
      || !isValidContractAddress(receipt.asset)
      || !Number.isFinite(createdAt)
      || !Number.isFinite(Date.parse(servedAt))
      || (transaction !== "" && !/^[a-f0-9]{64}$/i.test(transaction))
      || (["settled", "delivered"].includes(receipt.status) && !/^[a-f0-9]{64}$/i.test(transaction))
    ) {
      throw new PaymentLedgerError("Settlement receipt is invalid.", "X402_RECEIPT_INVALID");
    }

    const records = this.list();
    const receiptIds = this.readReceiptIds();
    for (const candidate of records) {
      if (candidate.receipt) receiptIds.add(candidate.receipt.id.toLowerCase());
    }
    const matches = (record: PaymentRecord): boolean => (
      record.origin === origin
      && record.payer === context.payer
      && (!receipt.payer || receipt.payer === record.payer)
      && record.payTo === receipt.payTo
      && record.network === receipt.network
      && record.assetContract === receipt.asset
      && record.amountAtomic === amountAtomic
    );
    const existing = records.find((record) => record.receipt?.id.toLowerCase() === id);

    if (!existing && receiptIds.has(id)) {
      throw new PaymentLedgerError(
        "Receipt identifier was already linked to an earlier authorization.",
        "X402_RECEIPT_REPLAY",
      );
    }

    if (existing && !matches(existing)) {
      throw new PaymentLedgerError(
        "Receipt is already linked to another authorization.",
        "X402_RECEIPT_MISMATCH",
      );
    }

    if (
      existing?.receipt
      && (
        existing.receipt.createdAt !== receipt.createdAt
        || (existing.receipt.transaction && transaction && existing.receipt.transaction !== transaction)
        || (existing.receipt.status === "delivered" && receipt.status !== "delivered")
      )
    ) {
      throw new PaymentLedgerError(
        "Receipt update conflicts with previously stored receipt data.",
        "X402_RECEIPT_MISMATCH",
      );
    }

    const record = existing ?? records
      .filter((candidate) => (
        matches(candidate)
        && !candidate.receipt
        && ["authorized", "submitted"].includes(candidate.status)
        && Math.abs(createdAt - candidate.createdAt) <= RECEIPT_MATCH_WINDOW_MS
      ))
      .sort((left, right) => Math.abs(createdAt - left.createdAt) - Math.abs(createdAt - right.createdAt))[0];

    if (!record) {
      throw new PaymentLedgerError(
        "No matching local authorization was found for this receipt.",
        "X402_RECEIPT_MISMATCH",
      );
    }

    if (!existing && receiptIds.size >= REPLAY_FINGERPRINT_LIMIT) {
      throw new PaymentLedgerError(
        "The receipt replay journal is full; protected storage maintenance is required.",
        "X402_RECEIPT_REPLAY_JOURNAL_FULL",
      );
    }

    const localStatus: PaymentRecordStatus = record.status === "delivered" || receipt.status === "delivered"
      ? "delivered"
      : receipt.status === "failed"
        ? "failed"
        : receipt.status === "settlement_unknown"
          ? "settlement_unknown"
          : "submitted";
    const storedReceipt: StoredReceipt = {
      id,
      status: receipt.status,
      transaction,
      createdAt: receipt.createdAt,
      servedAt,
      updatedAt: now,
    };

    receiptIds.add(id);
    this.writeReceiptIds(receiptIds);
    return this.update(record.id, {status: localStatus, receipt: storedReceipt}, now);
  }

  clear(options: {includeDailySpend?: boolean; includeReplayJournal?: boolean} = {}): void {
    this.#storage.removeItem(this.#ledgerKey);
    if (options.includeDailySpend) this.#storage.removeItem(this.#dailySpendKey);
    if (options.includeReplayJournal) {
      this.#storage.removeItem(this.#replayKey);
      this.#storage.removeItem(this.#receiptReplayKey);
    }
  }

  private requireRecord(id: string): PaymentRecord {
    const record = this.list().find((entry) => entry.id === id);
    if (!record) throw new PaymentLedgerError("Payment record was not found.", "X402_RECORD_NOT_FOUND");
    return record;
  }

  private update(
    id: string,
    patch: Partial<Pick<PaymentRecord, "status" | "errorCode" | "receipt">>,
    now: number,
  ): PaymentRecord {
    const records = this.list();
    let updated: PaymentRecord | null = null;
    const next = records.map((record) => {
      if (record.id !== id) return record;
      updated = {...record, ...patch, updatedAt: normalizeTimestamp(now)};
      return updated;
    });

    if (!updated) throw new PaymentLedgerError("Payment record was not found.", "X402_RECORD_NOT_FOUND");
    this.write(next);
    return updated;
  }

  private write(records: PaymentRecord[]): void {
    this.#storage.setItem(this.#ledgerKey, JSON.stringify(records.slice(0, this.#recordLimit)));
  }

  private readReplayFingerprints(): Set<string> {
    const raw = this.#storage.getItem(this.#replayKey);
    if (raw === null) return new Set();

    try {
      if (raw.length > MAX_REPLAY_JOURNAL_LENGTH) throw new Error();
      const value: unknown = JSON.parse(raw);

      if (!Array.isArray(value) || value.length > REPLAY_FINGERPRINT_LIMIT) throw new Error();
      const fingerprints = new Set<string>();

      for (const fingerprint of value) {
        if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error();
        fingerprints.add(fingerprint.toLowerCase());
      }

      if (fingerprints.size !== value.length) throw new Error();
      return fingerprints;
    }
    catch (error) {
      throw new PaymentLedgerError(
        "The replay journal is corrupted; refusing to reserve a payment.",
        "X402_REPLAY_STORAGE_INVALID",
        {cause: error},
      );
    }
  }

  private writeReplayFingerprints(fingerprints: Set<string>): void {
    this.#storage.setItem(this.#replayKey, JSON.stringify([...fingerprints]));
  }

  private readReceiptIds(): Set<string> {
    const raw = this.#storage.getItem(this.#receiptReplayKey);
    if (raw === null) return new Set();

    try {
      if (raw.length > MAX_REPLAY_JOURNAL_LENGTH) throw new Error();
      const value: unknown = JSON.parse(raw);

      if (!Array.isArray(value) || value.length > REPLAY_FINGERPRINT_LIMIT) throw new Error();
      const ids = new Set<string>();

      for (const id of value) {
        if (typeof id !== "string" || !/^[a-f0-9]{32,64}$/.test(id)) throw new Error();
        ids.add(id);
      }

      if (ids.size !== value.length) throw new Error();
      return ids;
    }
    catch (error) {
      throw new PaymentLedgerError(
        "The receipt replay journal is corrupted; refusing to attach a receipt.",
        "X402_RECEIPT_REPLAY_STORAGE_INVALID",
        {cause: error},
      );
    }
  }

  private writeReceiptIds(ids: Set<string>): void {
    this.#storage.setItem(this.#receiptReplayKey, JSON.stringify([...ids]));
  }

  private readDailySpend(): Record<string, string> {
    try {
      const raw = this.#storage.getItem(this.#dailySpendKey);
      if (raw === null) return {};
      if (raw.length > MAX_DAILY_SPEND_STORAGE_LENGTH) throw new Error();

      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      const entries: Array<[string, string]> = [];

      for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
        const [day, network, payer, ...extra] = key.split("|");
        if (
          extra.length > 0
          || !day
          || !/^\d{4}-\d{2}-\d{2}$/.test(day)
          || !Number.isFinite(Date.parse(`${day}T00:00:00.000Z`))
          || utcDay(Date.parse(`${day}T00:00:00.000Z`)) !== day
          || !network
          || !isStellarX402Network(network)
          || !payer
          || !isValidStellarAddress(payer)
        ) throw new Error();

        entries.push([key, assertAtomicAmount(amount, "stored daily spend")]);
      }

      return Object.fromEntries(entries);
    }
    catch (error) {
      if (error instanceof PaymentLedgerError) throw error;
      throw new PaymentLedgerError(
        "Daily spend storage is corrupted; refusing to reset the safety budget.",
        "X402_DAILY_SPEND_STORAGE_INVALID",
        {cause: error},
      );
    }
  }

  private writeDailySpend(spend: Record<string, string>, now: number): void {
    const oldest = utcDay(now - 14 * 24 * 60 * 60_000);
    const compact = Object.fromEntries(Object.entries(spend).filter(([key]) => key.slice(0, 10) >= oldest));
    this.#storage.setItem(this.#dailySpendKey, JSON.stringify(compact));
  }

  private sanitizeRecord(value: unknown): PaymentRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint : "";
    const createdAt = record.createdAt;
    const updatedAt = record.updatedAt;
    const policyVersion = record.policyVersion;
    const expirationLedger = record.expirationLedger;

    if (
      !/^[a-f0-9]{64}$/i.test(fingerprint)
      || record.id !== `x402-${fingerprint}`
      || !Number.isSafeInteger(createdAt)
      || Number(createdAt) <= 0
      || !Number.isSafeInteger(updatedAt)
      || Number(updatedAt) < Number(createdAt)
      || record.day !== utcDay(Number(createdAt))
      || typeof record.origin !== "string"
      || normalizeHttpsOrigin(record.origin) !== record.origin
      || typeof record.serviceName !== "string"
      || record.serviceName.length > 120
      || typeof record.network !== "string"
      || !isStellarX402Network(record.network)
      || typeof record.payer !== "string"
      || !isValidStellarAddress(record.payer)
      || typeof record.payTo !== "string"
      || !isValidStellarAddress(record.payTo)
      || typeof record.assetCode !== "string"
      || !record.assetCode
      || record.assetCode.length > 32
      || typeof record.assetContract !== "string"
      || !isValidContractAddress(record.assetContract)
      || !Number.isSafeInteger(record.assetDecimals)
      || Number(record.assetDecimals) < 0
      || Number(record.assetDecimals) > 18
      || typeof record.amountDisplay !== "string"
      || !isPaymentRecordStatus(record.status)
      || typeof record.errorCode !== "string"
      || record.errorCode.length > 80
      || !(policyVersion === null || (Number.isSafeInteger(policyVersion) && Number(policyVersion) > 0))
      || !(expirationLedger === null || (Number.isSafeInteger(expirationLedger) && Number(expirationLedger) > 0))
    ) return null;

    let amountAtomic: string;
    let dailyLimitAtomic: string;

    try {
      amountAtomic = assertAtomicAmount(record.amountAtomic);
      dailyLimitAtomic = assertAtomicAmount(record.dailyLimitAtomic, "dailyLimitAtomic");
    }
    catch {
      return null;
    }

    if (
      record.amountDisplay !== formatAtomicAmount(amountAtomic, Number(record.assetDecimals))
      || BigInt(amountAtomic) > BigInt(dailyLimitAtomic)
    ) return null;

    let receipt: StoredReceipt | null = null;
    if (record.receipt !== null) {
      if (!record.receipt || typeof record.receipt !== "object" || Array.isArray(record.receipt)) return null;
      const stored = record.receipt as Record<string, unknown>;

      if (
        typeof stored.id !== "string"
        || !/^[a-f0-9]{32,64}$/i.test(stored.id)
        || !isSettlementStatus(stored.status)
        || typeof stored.transaction !== "string"
        || (stored.transaction !== "" && !/^[a-f0-9]{64}$/i.test(stored.transaction))
        || typeof stored.createdAt !== "string"
        || !Number.isFinite(Date.parse(stored.createdAt))
        || typeof stored.servedAt !== "string"
        || !Number.isFinite(Date.parse(stored.servedAt))
        || !Number.isSafeInteger(stored.updatedAt)
        || Number(stored.updatedAt) <= 0
      ) return null;

      receipt = {
        id: stored.id,
        status: stored.status,
        transaction: stored.transaction,
        createdAt: stored.createdAt,
        servedAt: stored.servedAt,
        updatedAt: Number(stored.updatedAt),
      };
    }

    return {
      id: record.id,
      fingerprint,
      createdAt: Number(createdAt),
      updatedAt: Number(updatedAt),
      day: record.day,
      origin: record.origin,
      serviceName: record.serviceName,
      network: record.network,
      payer: record.payer,
      payTo: record.payTo,
      assetCode: record.assetCode,
      assetContract: record.assetContract,
      assetDecimals: Number(record.assetDecimals),
      amountAtomic,
      amountDisplay: record.amountDisplay,
      dailyLimitAtomic,
      policyVersion: policyVersion === null ? null : Number(policyVersion),
      expirationLedger: expirationLedger === null ? null : Number(expirationLedger),
      status: record.status,
      errorCode: record.errorCode,
      receipt,
    };
  }
}
