import assert from "node:assert/strict";
import test from "node:test";

import {Keypair, Networks} from "@stellar/stellar-sdk";

import {runGuardConformance} from "../src/conformance/guard-suite.js";
import {runWalletConformance} from "../src/conformance/runner.js";
import {authorizationPayloadHash} from "../src/soroban.js";

test("the reference guard passes every built-in safety vector", () => {
  const report = runGuardConformance(Date.UTC(2026, 7, 13));

  assert.equal(report.passed, true);
  assert.ok(report.results.length >= 6);
  assert.equal(report.results.every((result) => result.passed), true);
});

test("wallet conformance verifies the safe signature and required rejections", async () => {
  const signer = Keypair.random();
  let request = 0;
  const report = await runWalletConformance({
    adapter: {
      getAddress: async () => signer.publicKey(),
      getNetwork: async () => ({network: "stellar:testnet", networkPassphrase: Networks.TESTNET}),
      signAuthEntry: async (authEntry) => {
        request += 1;
        if (request > 1) throw new Error("Rejected by test wallet policy");
        return {
          signedAuthEntry: signer.sign(Buffer.from(
            authorizationPayloadHash(authEntry, Networks.TESTNET),
          )).toString("base64"),
          signerAddress: signer.publicKey(),
        };
      },
    },
    currentLedger: 1_000_000,
    confirmTestnetSigning: true,
    now: Date.UTC(2026, 7, 13),
  });

  assert.equal(report.passed, true);
  assert.equal(report.results.every((result) => result.passed), true);
});

test("wallet conformance requires explicit signing confirmation", async () => {
  await assert.rejects(
    runWalletConformance({
      adapter: {
        getAddress: async () => Keypair.random().publicKey(),
        getNetwork: async () => ({network: "stellar:testnet", networkPassphrase: Networks.TESTNET}),
        signAuthEntry: async () => ({signedAuthEntry: "unused"}),
      },
      currentLedger: 1_000_000,
      confirmTestnetSigning: false,
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_CONFORMANCE_CONFIRMATION_REQUIRED",
  );
});

test("wallet conformance rejects a false Testnet network identity", async () => {
  const signer = Keypair.random();
  await assert.rejects(
    runWalletConformance({
      adapter: {
        getAddress: async () => signer.publicKey(),
        getNetwork: async () => ({network: "stellar:testnet", networkPassphrase: Networks.PUBLIC}),
        signAuthEntry: async () => ({signedAuthEntry: "unused"}),
      },
      currentLedger: 1_000_000,
      confirmTestnetSigning: true,
    }),
    (error: unknown) => (
      (error as {code?: string}).code === "X402_CONFORMANCE_NETWORK_PASSPHRASE_INVALID"
    ),
  );
});

test("wallet conformance does not treat malformed signing responses as policy rejection", async () => {
  const signer = Keypair.random();
  let request = 0;
  const report = await runWalletConformance({
    adapter: {
      getAddress: async () => signer.publicKey(),
      getNetwork: async () => ({network: "stellar:testnet", networkPassphrase: Networks.TESTNET}),
      signAuthEntry: async (authEntry) => {
        request += 1;
        if (request > 1) return {signedAuthEntry: "not-base64"};
        return {
          signedAuthEntry: signer.sign(Buffer.from(
            authorizationPayloadHash(authEntry, Networks.TESTNET),
          )).toString("base64"),
          signerAddress: signer.publicKey(),
        };
      },
    },
    currentLedger: 1_000_000,
    confirmTestnetSigning: true,
  });

  assert.equal(report.passed, false);
  assert.equal(report.results.slice(1).every((result) => !result.passed), true);
});
