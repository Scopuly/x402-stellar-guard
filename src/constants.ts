import {Networks} from "@stellar/stellar-sdk";

import type {GuardAsset, StellarX402Network} from "./types.js";

export const X402_VERSION = 2 as const;
export const X402_EXACT_SCHEME = "exact" as const;
export const STELLAR_TESTNET = "stellar:testnet" as const satisfies StellarX402Network;
export const STELLAR_PUBNET = "stellar:pubnet" as const satisfies StellarX402Network;
export const MAX_AUTHORIZATION_LEDGER_WINDOW = 120;
export const DEFAULT_MAX_TIMEOUT_SECONDS = 600;
export const STELLAR_LEDGER_CLOSE_SECONDS = 5;

export const STELLAR_USDC_ASSETS: Readonly<Record<StellarX402Network, GuardAsset>> = Object.freeze({
  [STELLAR_TESTNET]: Object.freeze({
    code: "USDC",
    name: "USD Coin",
    decimals: 7,
    contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  }),
  [STELLAR_PUBNET]: Object.freeze({
    code: "USDC",
    name: "USD Coin",
    decimals: 7,
    contract: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  }),
});

export const SCOPULY_SAFETY_LIMITS_ATOMIC: Readonly<Record<StellarX402Network, string>> = Object.freeze({
  [STELLAR_TESTNET]: "10000000000",
  [STELLAR_PUBNET]: "10000000",
});

export const networkToPassphrase = (network: StellarX402Network): string => (
  network === STELLAR_PUBNET ? Networks.PUBLIC : Networks.TESTNET
);

export const passphraseToNetwork = (networkPassphrase: string): StellarX402Network | null => {
  if (networkPassphrase === String(Networks.PUBLIC)) return STELLAR_PUBNET;
  if (networkPassphrase === String(Networks.TESTNET)) return STELLAR_TESTNET;
  return null;
};

export const isStellarX402Network = (value: string): value is StellarX402Network => (
  value === STELLAR_TESTNET || value === STELLAR_PUBNET
);
