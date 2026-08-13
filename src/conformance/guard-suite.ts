import {Keypair, Networks} from "@stellar/stellar-sdk";

import {STELLAR_USDC_ASSETS} from "../constants.js";
import {guardPaymentRequired} from "../payment-required.js";
import {createDefaultGuardPolicy} from "../policy.js";
import {guardAuthorizationEntry} from "../soroban.js";
import type {ConformanceCaseResult, GuardConformanceReport} from "../types.js";
import {createWalletConformanceVectors, TESTNET_CONFORMANCE_RECIPIENT} from "./vectors.js";

export const runGuardConformance = (now = Date.now()): GuardConformanceReport => {
  const payer = Keypair.random().publicKey();
  const currentLedger = 1_000_000;
  const policy = createDefaultGuardPolicy({now});
  const intent = guardPaymentRequired({
    x402Version: 2,
    resource: {url: "https://merchant.example/data", description: "Conformance fixture"},
    accepts: [{
      scheme: "exact",
      network: "stellar:testnet",
      amount: "1",
      asset: STELLAR_USDC_ASSETS["stellar:testnet"].contract,
      payTo: TESTNET_CONFORMANCE_RECIPIENT,
      maxTimeoutSeconds: 60,
      extra: {areFeesSponsored: true},
    }],
  }, {
    origin: "https://merchant.example",
    requestUrl: "https://merchant.example/data",
    network: "stellar:testnet",
    payer,
  }, {policy});
  const vectors = createWalletConformanceVectors(payer, currentLedger);
  const results: ConformanceCaseResult[] = vectors.map((vector) => {
    try {
      guardAuthorizationEntry(vector.authEntry, Networks.TESTNET, intent, {currentLedger});
      const passed = vector.expected === "sign";
      return {
        id: vector.id,
        name: vector.name,
        expected: vector.expected,
        passed,
        message: passed ? "Guard accepted the safe vector." : "Guard accepted an unsafe vector.",
      };
    }
    catch (error) {
      const passed = vector.expected === "reject";
      return {
        id: vector.id,
        name: vector.name,
        expected: vector.expected,
        passed,
        message: passed
          ? "Guard rejected the unsafe vector."
          : `Guard rejected the safe vector: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  return {
    standard: "scopuly-stellar-x402-guard-conformance",
    version: 1,
    generatedAt: new Date(now).toISOString(),
    passed: results.every((result) => result.passed),
    results,
  };
};
