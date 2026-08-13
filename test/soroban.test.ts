import assert from "node:assert/strict";
import test from "node:test";

import {Keypair, Networks} from "@stellar/stellar-sdk";

import {STELLAR_USDC_ASSETS} from "../src/constants.js";
import {guardPaymentRequired} from "../src/payment-required.js";
import {guardAuthorizationEntry} from "../src/soroban.js";
import {PAYER, createAuthEntry, paymentRequired} from "./helpers.js";

const intent = () => guardPaymentRequired(paymentRequired(), {
  origin: "https://merchant.example",
  payer: PAYER,
  network: "stellar:testnet",
});

test("binds a CAP-71 authorization to the reviewed x402 intent", () => {
  const review = guardAuthorizationEntry(createAuthEntry(), Networks.TESTNET, intent(), {
    currentLedger: 1_000_000,
  });

  assert.equal(review.payment.from, PAYER);
  assert.equal(review.payment.amountDisplay, "0.001");
  assert.match(review.fingerprint, /^[a-f0-9]{64}$/);
});

test("accepts the legacy auth preimage emitted by the current official Stellar x402 client", () => {
  const review = guardAuthorizationEntry(
    createAuthEntry({credentialVersion: "legacy"}),
    Networks.TESTNET,
    intent(),
    {currentLedger: 1_000_000},
  );

  assert.equal(review.envelopeType, "envelopeTypeSorobanAuthorization");
  assert.equal(review.boundAddress, "");
});

test("binds authorization expiry to maxTimeoutSeconds", () => {
  assert.throws(
    () => guardAuthorizationEntry(
      createAuthEntry({expirationLedger: 1_000_013}),
      Networks.TESTNET,
      intent(),
      {currentLedger: 1_000_000},
    ),
    (error: unknown) => (error as {code?: string}).code === "X402_AUTHORIZATION_TOO_LONG",
  );

  const review = guardAuthorizationEntry(
    createAuthEntry({expirationLedger: 1_000_012}),
    Networks.TESTNET,
    intent(),
    {currentLedger: 1_000_000},
  );
  assert.equal(review.expirationLedger, 1_000_012);
});

test("rejects tampered payer, recipient, amount, asset, and expiration", () => {
  const cases = [
    createAuthEntry({from: Keypair.random().publicKey(), boundAddress: PAYER}),
    createAuthEntry({to: Keypair.random().publicKey()}),
    createAuthEntry({amount: "10001"}),
    createAuthEntry({contract: STELLAR_USDC_ASSETS["stellar:pubnet"].contract}),
    createAuthEntry({expirationLedger: 1_000_000}),
  ];

  for (const authEntry of cases) {
    assert.throws(
      () => guardAuthorizationEntry(authEntry, Networks.TESTNET, intent(), {currentLedger: 1_000_000}),
    );
  }
});

test("rejects an authorization for the wrong network", () => {
  assert.throws(
    () => guardAuthorizationEntry(createAuthEntry(), Networks.PUBLIC, intent(), {currentLedger: 1_000_000}),
    (error: unknown) => (error as {code?: string}).code === "X402_AUTHORIZATION_NETWORK_MISMATCH",
  );
});
