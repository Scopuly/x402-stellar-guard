import assert from "node:assert/strict";
import test from "node:test";

import {Networks} from "@stellar/stellar-sdk";

import {inspectX402Endpoint} from "../src/inspect.js";
import {PaymentLedger} from "../src/ledger.js";
import {guardPaymentRequired} from "../src/payment-required.js";
import {createHttpsReceiptResolver, recoverPendingReceipts} from "../src/receipts.js";
import {guardAuthorizationEntry} from "../src/soroban.js";
import type {SettlementReceipt} from "../src/types.js";
import {PAYER, PAY_TO, createAuthEntry, memoryStorage, paymentRequired} from "./helpers.js";

const setupRecord = () => {
  const ledger = new PaymentLedger({storage: memoryStorage()});
  const intent = guardPaymentRequired(paymentRequired(), {
    origin: "https://merchant.example",
    requestUrl: "https://merchant.example/data",
    payer: PAYER,
    network: "stellar:testnet",
  });
  const authorization = guardAuthorizationEntry(createAuthEntry(), Networks.TESTNET, intent, {
    currentLedger: 1_000_000,
  });
  const now = Date.UTC(2026, 7, 13, 12);
  const record = ledger.authorize(ledger.reserve({intent, authorization, now}).id, now + 1);
  const receipt: SettlementReceipt = {
    id: "a".repeat(32),
    status: "pending",
    network: "stellar:testnet",
    asset: intent.asset.contract,
    amountAtomic: intent.amountAtomic,
    payer: PAYER,
    payTo: PAY_TO,
    createdAt: new Date(now + 1_000).toISOString(),
  };
  return {ledger, intent, record, receipt, now};
};

test("inspects a valid Stellar x402 endpoint without making a payment", async () => {
  const header = Buffer.from(JSON.stringify(paymentRequired())).toString("base64");
  const fetchImpl: typeof fetch = async () => new Response("payment required", {
    status: 402,
    headers: {"PAYMENT-REQUIRED": header},
  });
  const report = await inspectX402Endpoint("https://merchant.example/data", {fetchImpl});

  assert.equal(report.valid, true);
  assert.equal(report.stellarRequirements.length, 1);
});

test("endpoint inspection reports a missing PAYMENT-REQUIRED header", async () => {
  const fetchImpl: typeof fetch = async () => new Response("missing", {status: 402});
  const report = await inspectX402Endpoint("https://merchant.example/data", {fetchImpl});

  assert.equal(report.valid, false);
  assert.equal(report.issues[0]?.code, "PAYMENT_REQUIRED_MISSING");
});

test("endpoint inspection rejects malformed URLs and unsafe timeout settings", async () => {
  await assert.rejects(
    inspectX402Endpoint("not a url"),
    (error: unknown) => (error as {code?: string}).code === "X402_INSPECT_URL_INVALID",
  );
  await assert.rejects(
    inspectX402Endpoint("https://merchant.example/data", {timeoutMs: 60_001}),
    (error: unknown) => (error as {code?: string}).code === "X402_INSPECT_CONFIG_INVALID",
  );
});

test("resolves bounded HTTPS receipts and recovers an unresolved local record", async () => {
  const {ledger, intent, record, receipt, now} = setupRecord();
  ledger.attachReceipt(receipt, {origin: intent.origin, payer: PAYER, now: now + 2_000});
  const delivered: SettlementReceipt = {
    ...receipt,
    status: "delivered",
    transaction: "b".repeat(64),
    deliveredAt: new Date(now + 3_000).toISOString(),
  };
  const resolver = createHttpsReceiptResolver({
    allowedOrigins: ["https://merchant.example"],
    buildUrl: () => `https://merchant.example/receipts/${receipt.id}`,
    fetchImpl: async () => new Response(JSON.stringify({receipt: delivered}), {
      status: 200,
      headers: {"content-type": "application/json"},
    }),
  });

  assert.equal((await resolver(record)).status, "delivered");
  const recovered = await recoverPendingReceipts({ledger, resolve: resolver, now: now + 4_000});
  assert.equal(recovered[0]?.status, "delivered");
});

test("receipt resolver rejects origins outside its exact allowlist", async () => {
  const {record} = setupRecord();
  const resolver = createHttpsReceiptResolver({
    allowedOrigins: ["https://merchant.example"],
    buildUrl: () => "https://evil.example/receipt",
    fetchImpl: async () => new Response("{}"),
  });

  await assert.rejects(
    resolver(record),
    (error: unknown) => (error as {code?: string}).code === "X402_RECEIPT_URL_BLOCKED",
  );
});

test("receipt handling rejects malformed resolver URLs and overlong identifiers", async () => {
  const {ledger, intent, receipt, record, now} = setupRecord();
  const resolver = createHttpsReceiptResolver({
    allowedOrigins: ["https://merchant.example"],
    buildUrl: () => "not a url",
    fetchImpl: async () => new Response("{}"),
  });

  await assert.rejects(
    resolver(record),
    (error: unknown) => (error as {code?: string}).code === "X402_RECEIPT_URL_BLOCKED",
  );
  assert.throws(
    () => ledger.attachReceipt({...receipt, id: "a".repeat(65)}, {
      origin: intent.origin,
      payer: PAYER,
      now: now + 2_000,
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_RECEIPT_INVALID",
  );
});
