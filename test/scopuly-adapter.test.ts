import assert from "node:assert/strict";
import test from "node:test";

import {Networks} from "@stellar/stellar-sdk";

import {
  createScopulyProviderAdapter,
  type ScopulyProvider,
} from "../src/adapters/scopuly-provider.js";
import {runWalletConformance} from "../src/conformance/runner.js";
import {STELLAR_USDC_ASSETS} from "../src/constants.js";
import {PAYER} from "./helpers.js";

const provider = (network: string, networkPassphrase: string): ScopulyProvider => ({
  isScopuly: true,
  platform: "extension",
  requestAccess: async () => ({address: PAYER}),
  getNetwork: async () => ({network, networkPassphrase}),
  signAuthEntry: async () => ({signedAuthEntry: "unused"}),
});

test("maps the real Scopuly PUBLIC/TESTNET provider names to x402 CAIP-2 networks", async () => {
  const testnet = createScopulyProviderAdapter(provider("TESTNET", Networks.TESTNET));
  const pubnet = createScopulyProviderAdapter(provider("PUBLIC", Networks.PUBLIC));

  assert.deepEqual(await testnet.getNetwork(), {
    network: "stellar:testnet",
    networkPassphrase: Networks.TESTNET,
  });
  assert.deepEqual(await pubnet.getNetwork(), {
    network: "stellar:pubnet",
    networkPassphrase: Networks.PUBLIC,
  });
});

test("rejects a provider network/passphrase mismatch", async () => {
  const adapter = createScopulyProviderAdapter(provider("TESTNET", Networks.PUBLIC));
  await assert.rejects(
    adapter.getNetwork(),
    (error: unknown) => (error as {code?: string}).code === "SCOPULY_NETWORK_INVALID",
  );
});

test("wallet conformance version 1 rejects smart-account addresses explicitly", async () => {
  await assert.rejects(
    runWalletConformance({
      adapter: {
        getAddress: async () => STELLAR_USDC_ASSETS["stellar:testnet"].contract,
        getNetwork: async () => ({network: "stellar:testnet", networkPassphrase: Networks.TESTNET}),
        signAuthEntry: async () => ({signedAuthEntry: "unused"}),
      },
      currentLedger: 1_000_000,
      confirmTestnetSigning: true,
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_CONFORMANCE_ACCOUNT_UNSUPPORTED",
  );
});
