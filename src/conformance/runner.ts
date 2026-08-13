import {Keypair} from "@stellar/stellar-sdk";
import {Buffer} from "buffer";

import {STELLAR_TESTNET, networkToPassphrase} from "../constants.js";
import {ConformanceError} from "../errors.js";
import {authorizationPayloadHash} from "../soroban.js";
import type {ConformanceReport, StellarWalletAdapter} from "../types.js";
import {isValidStellarAddress} from "../utils.js";
import {createWalletConformanceVectors} from "./vectors.js";

export interface WalletConformanceOptions {
  adapter: StellarWalletAdapter;
  currentLedger: number;
  confirmTestnetSigning: boolean;
  now?: number;
}

export const runWalletConformance = async (
  options: WalletConformanceOptions,
): Promise<ConformanceReport> => {
  if (!options.confirmTestnetSigning) {
    throw new ConformanceError(
      "Explicit confirmation is required before requesting Testnet signatures.",
      "X402_CONFORMANCE_CONFIRMATION_REQUIRED",
    );
  }

  if (!Number.isSafeInteger(options.currentLedger) || options.currentLedger <= 0) {
    throw new ConformanceError("A fresh Testnet ledger sequence is required.", "X402_CONFORMANCE_LEDGER_INVALID");
  }

  const [address, walletNetwork] = await Promise.all([
    options.adapter.getAddress(),
    options.adapter.getNetwork(),
  ]);

  if (!isValidStellarAddress(address)) {
    throw new ConformanceError("Wallet returned an invalid Stellar address.", "X402_CONFORMANCE_ADDRESS_INVALID");
  }

  if (!address.startsWith("G")) {
    throw new ConformanceError(
      "Wallet conformance version 1 requires a classic Ed25519 G-account.",
      "X402_CONFORMANCE_ACCOUNT_UNSUPPORTED",
    );
  }

  if (walletNetwork.network !== STELLAR_TESTNET) {
    throw new ConformanceError(
      "Wallet conformance runs only on Stellar Testnet.",
      "X402_CONFORMANCE_TESTNET_REQUIRED",
    );
  }

  if (walletNetwork.networkPassphrase !== networkToPassphrase(STELLAR_TESTNET)) {
    throw new ConformanceError(
      "Wallet returned an invalid Testnet network passphrase.",
      "X402_CONFORMANCE_NETWORK_PASSPHRASE_INVALID",
    );
  }

  const vectors = createWalletConformanceVectors(address, options.currentLedger);
  const results = [];

  for (const vector of vectors) {
    let signed: Awaited<ReturnType<StellarWalletAdapter["signAuthEntry"]>>;

    try {
      signed = await options.adapter.signAuthEntry(vector.authEntry, {
        address,
        networkPassphrase: walletNetwork.networkPassphrase,
      });
    }
    catch (error) {
      const passed = vector.expected === "reject";
      results.push({
        id: vector.id,
        name: vector.name,
        expected: vector.expected,
        passed,
        message: passed
          ? "Wallet rejected the unsafe vector."
          : `Wallet rejected the safe vector: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const encodedSignature = signed.signedAuthEntry;
    const signature = typeof encodedSignature === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature)
      ? Buffer.from(encodedSignature, "base64")
      : Buffer.alloc(0);
    const canonicalSignature = signature.length === 64 && signature.toString("base64") === encodedSignature;
    const signerMatches = !signed.signerAddress || signed.signerAddress === address;
    const payloadHash = authorizationPayloadHash(vector.authEntry, walletNetwork.networkPassphrase);
    const validSignature = canonicalSignature
      && signerMatches
      && Keypair.fromPublicKey(address).verify(Buffer.from(payloadHash), signature);
    const passed = vector.expected === "sign" && validSignature;
    results.push({
      id: vector.id,
      name: vector.name,
      expected: vector.expected,
      passed,
      message: passed
        ? "Wallet returned a valid signature."
        : vector.expected === "reject"
          ? "Wallet returned from signing for an unsafe conformance vector."
          : !signerMatches
            ? "Wallet returned a different signer address."
            : "Wallet returned an invalid signature.",
    });
  }

  return {
    standard: "scopuly-stellar-x402-wallet-conformance",
    version: 1,
    network: STELLAR_TESTNET,
    address,
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    passed: results.every((result) => result.passed),
    results,
  };
};
