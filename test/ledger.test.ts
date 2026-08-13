import assert from "node:assert/strict";
import test from "node:test";

import {Networks} from "@stellar/stellar-sdk";

import {PaymentLedger} from "../src/ledger.js";
import {guardPaymentRequired} from "../src/payment-required.js";
import {guardAuthorizationEntry} from "../src/soroban.js";
import {PAYER, PAY_TO, createAuthEntry, memoryStorage, paymentRequired} from "./helpers.js";

const setup = () => {
  const storage = memoryStorage();
  const ledger = new PaymentLedger({storage});
  const intent = guardPaymentRequired(paymentRequired(), {
    origin: "https://merchant.example",
    payer: PAYER,
    network: "stellar:testnet",
  });
  const authorization = guardAuthorizationEntry(createAuthEntry(), Networks.TESTNET, intent, {
    currentLedger: 1_000_000,
  });
  return {storage, ledger, intent, authorization};
};

test("reserves and authorizes without persisting raw signing material", () => {
  const {storage, ledger, intent, authorization} = setup();
  const record = ledger.reserve({intent, authorization, now: Date.UTC(2026, 7, 13)});
  const authorized = ledger.authorize(record.id);
  const raw = storage.getItem("scopuly_x402_guard_v1:ledger") ?? "";

  assert.equal(authorized.status, "authorized");
  assert.equal(raw.includes("authEntry"), false);
  assert.equal(raw.includes("signedAuthEntry"), false);
});

test("enforces monotonic ledger state transitions", () => {
  const {ledger, intent, authorization} = setup();
  const record = ledger.reserve({intent, authorization});

  assert.throws(
    () => ledger.markSubmitted(record.id),
    (error: unknown) => (error as {code?: string}).code === "X402_LEDGER_STATE_INVALID",
  );
  const authorized = ledger.authorize(record.id);
  assert.deepEqual(ledger.authorize(record.id), authorized);
  const submitted = ledger.markSubmitted(record.id);
  assert.deepEqual(ledger.markSubmitted(record.id), submitted);
  const delivered = ledger.attachReceipt({
    id: "e".repeat(32),
    status: "delivered",
    network: "stellar:testnet",
    asset: intent.asset.contract,
    amountAtomic: intent.amountAtomic,
    payer: PAYER,
    payTo: PAY_TO,
    transaction: "f".repeat(64),
    createdAt: new Date(record.createdAt + 1_000).toISOString(),
  }, {origin: intent.origin, payer: PAYER, now: record.createdAt + 2_000});

  assert.equal(delivered.status, "delivered");
  assert.throws(
    () => ledger.fail(record.id),
    (error: unknown) => (error as {code?: string}).code === "X402_LEDGER_STATE_INVALID",
  );
});

test("rejects duplicate authorization fingerprints", () => {
  const {ledger, intent, authorization} = setup();
  const record = ledger.reserve({intent, authorization});
  ledger.fail(record.id);
  assert.throws(
    () => ledger.reserve({intent, authorization}),
    (error: unknown) => (error as {code?: string}).code === "X402_DUPLICATE_AUTHORIZATION",
  );
});

test("rejects forged authorization reviews and mutated intents", () => {
  const first = setup();
  assert.throws(
    () => first.ledger.reserve({
      intent: first.intent,
      authorization: {...first.authorization, fingerprint: "a".repeat(64)},
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_LEDGER_INTENT_MISMATCH",
  );

  const second = setup();
  assert.throws(
    () => second.ledger.reserve({
      intent: {
        ...second.intent,
        resource: {...second.intent.resource, description: "mutated after review"},
      },
      authorization: second.authorization,
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_LEDGER_INTENT_MISMATCH",
  );
});

test("retains replay protection after a payment record is rotated out", () => {
  const storage = memoryStorage();
  const ledger = new PaymentLedger({storage, recordLimit: 10});
  const intent = guardPaymentRequired(paymentRequired(), {
    origin: "https://merchant.example",
    payer: PAYER,
    network: "stellar:testnet",
  });
  const review = (expirationLedger: number) => guardAuthorizationEntry(
    createAuthEntry({expirationLedger}),
    Networks.TESTNET,
    intent,
    {currentLedger: 1_000_000},
  );
  const original = review(1_000_012);
  ledger.fail(ledger.reserve({intent, authorization: original}).id);

  for (let offset = 1; offset <= 10; offset += 1) {
    const authorization = review(1_000_000 + offset);
    ledger.fail(ledger.reserve({intent, authorization}).id);
  }

  assert.equal(ledger.list().some((record) => record.fingerprint === original.fingerprint), false);
  assert.throws(
    () => ledger.reserve({intent, authorization: original}),
    (error: unknown) => (error as {code?: string}).code === "X402_DUPLICATE_AUTHORIZATION",
  );
});

test("fails closed when the replay journal is corrupted", () => {
  const {storage, ledger, intent, authorization} = setup();
  storage.setItem("scopuly_x402_guard_v1:replay-fingerprints", "{not-json");

  assert.throws(
    () => ledger.reserve({intent, authorization}),
    (error: unknown) => (error as {code?: string}).code === "X402_REPLAY_STORAGE_INVALID",
  );
});

test("attaches only a metadata-matching delivered receipt", () => {
  const {ledger, intent, authorization} = setup();
  const now = Date.UTC(2026, 7, 13, 12);
  const record = ledger.reserve({intent, authorization, now});
  ledger.authorize(record.id, now + 1);
  const delivered = ledger.attachReceipt({
    id: "a".repeat(32),
    status: "delivered",
    network: "stellar:testnet",
    asset: intent.asset.contract,
    amountAtomic: intent.amountAtomic,
    payer: PAYER,
    payTo: PAY_TO,
    transaction: "b".repeat(64),
    createdAt: new Date(now + 1_000).toISOString(),
  }, {origin: intent.origin, payer: PAYER, now: now + 2_000});

  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.receipt?.transaction, "b".repeat(64));

  assert.throws(
    () => ledger.attachReceipt({
      id: "a".repeat(32),
      status: "delivered",
      network: "stellar:testnet",
      asset: intent.asset.contract,
      amountAtomic: intent.amountAtomic,
      payer: PAYER,
      payTo: PAY_TO,
      transaction: "c".repeat(64),
      createdAt: new Date(now + 1_000).toISOString(),
    }, {origin: intent.origin, payer: PAYER, now: now + 3_000}),
    (error: unknown) => (error as {code?: string}).code === "X402_RECEIPT_MISMATCH",
  );
});

test("fails closed instead of trusting corrupted persisted records", () => {
  const storage = memoryStorage();
  storage.setItem("scopuly_x402_guard_v1:ledger", JSON.stringify([{
    id: `x402-${"a".repeat(64)}`,
    fingerprint: "a".repeat(64),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    day: "2026-08-13",
    origin: "https://merchant.example",
    network: "stellar:testnet",
    payer: PAYER,
    payTo: PAY_TO,
    assetContract: "not-a-contract",
    amountAtomic: "1",
    status: "authorized",
  }]));

  assert.throws(
    () => new PaymentLedger({storage}).list(),
    (error: unknown) => (error as {code?: string}).code === "X402_LEDGER_STORAGE_INVALID",
  );
});

test("fails closed instead of resetting corrupted daily spend", () => {
  const {storage, ledger, intent} = setup();
  storage.setItem("scopuly_x402_guard_v1:daily-spend", JSON.stringify({invalid: "10000"}));

  assert.throws(
    () => ledger.getDailySummary(intent.network, intent.payer, intent.dailyLimitAtomic),
    (error: unknown) => (error as {code?: string}).code === "X402_DAILY_SPEND_STORAGE_INVALID",
  );
});

test("retains authorization replay state when ordinary history is cleared", () => {
  const {ledger, intent, authorization} = setup();
  ledger.fail(ledger.reserve({intent, authorization}).id);
  ledger.clear();

  assert.deepEqual(ledger.list(), []);
  assert.throws(
    () => ledger.reserve({intent, authorization}),
    (error: unknown) => (error as {code?: string}).code === "X402_DUPLICATE_AUTHORIZATION",
  );
});

test("retains receipt replay protection after payment history is cleared", () => {
  const {ledger, intent, authorization} = setup();
  const now = Date.UTC(2026, 7, 13, 12);
  const receipt = {
    id: "c".repeat(32),
    status: "delivered" as const,
    network: "stellar:testnet" as const,
    asset: intent.asset.contract,
    amountAtomic: intent.amountAtomic,
    payer: PAYER,
    payTo: PAY_TO,
    transaction: "d".repeat(64),
    createdAt: new Date(now + 1_000).toISOString(),
  };
  const first = ledger.reserve({intent, authorization, now});
  ledger.authorize(first.id, now + 1);
  ledger.attachReceipt(receipt, {origin: intent.origin, payer: PAYER, now: now + 2_000});
  ledger.clear();

  const secondAuthorization = guardAuthorizationEntry(
    createAuthEntry({expirationLedger: 1_000_011}),
    Networks.TESTNET,
    intent,
    {currentLedger: 1_000_000},
  );
  const second = ledger.reserve({intent, authorization: secondAuthorization, now});
  ledger.authorize(second.id, now + 1);

  assert.throws(
    () => ledger.attachReceipt(receipt, {origin: intent.origin, payer: PAYER, now: now + 2_000}),
    (error: unknown) => (error as {code?: string}).code === "X402_RECEIPT_REPLAY",
  );
});
