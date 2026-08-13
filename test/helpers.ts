import {
  Address,
  Networks,
  buildAuthorizationEntryPreimage,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {Buffer} from "buffer";

import {STELLAR_USDC_ASSETS} from "../src/constants.js";
import type {StorageLike} from "../src/types.js";

export const PAYER = "GCRS63JEC7GRT5PVC6H3ONCST7Q6KVUWLQE6672KRXHVHCVPYD7VGXNN";
export const PAY_TO = "GBT2RH3RELBKMXVPEKTR7TMEV6YFSIEDOK63SH2XOHM74KFU3PZF2BMY";

export const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
};

export const paymentRequired = (overrides: Record<string, unknown> = {}) => ({
  x402Version: 2,
  resource: {url: "https://merchant.example/data", description: "Protected data"},
  accepts: [{
    scheme: "exact",
    network: "stellar:testnet",
    amount: "10000",
    asset: STELLAR_USDC_ASSETS["stellar:testnet"].contract,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {areFeesSponsored: true},
    ...overrides,
  }],
});

export const createAuthEntry = ({
  from = PAYER,
  to = PAY_TO,
  amount = "10000",
  contract = STELLAR_USDC_ASSETS["stellar:testnet"].contract,
  expirationLedger = 1_000_012,
  boundAddress = from,
  credentialVersion = "v2",
  subInvocations = [],
}: {
  from?: string;
  to?: string;
  amount?: string;
  contract?: string;
  expirationLedger?: number;
  boundAddress?: string;
  credentialVersion?: "legacy" | "v2";
  subInvocations?: xdr.SorobanAuthorizedInvocation[];
} = {}): string => {
  const contractFn = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contract).toScAddress(),
    functionName: Buffer.from("transfer"),
    args: [
      nativeToScVal(from, {type: "address"}),
      nativeToScVal(to, {type: "address"}),
      nativeToScVal(amount, {type: "i128"}),
    ],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(contractFn),
    subInvocations,
  });
  const credentials = new xdr.SorobanAddressCredentials({
    address: Address.fromString(boundAddress).toScAddress(),
    nonce: xdr.Int64.fromString("42"),
    signatureExpirationLedger: 0,
    signature: xdr.ScVal.scvVec([]),
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: credentialVersion === "v2"
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
  });

  return buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET).toXDR("base64");
};
