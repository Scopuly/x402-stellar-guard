import {
  Address,
  Keypair,
  Networks,
  buildAuthorizationEntryPreimage,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {Buffer} from "buffer";

import {SCOPULY_SAFETY_LIMITS_ATOMIC, STELLAR_USDC_ASSETS} from "../constants.js";

export interface WalletConformanceVector {
  id: string;
  name: string;
  expected: "sign" | "reject";
  authEntry: string;
}

const TEST_RECIPIENT = "GBT2RH3RELBKMXVPEKTR7TMEV6YFSIEDOK63SH2XOHM74KFU3PZF2BMY";

const createInvocation = ({
  contract = STELLAR_USDC_ASSETS["stellar:testnet"].contract,
  from,
  to = TEST_RECIPIENT,
  amount = "1",
  functionName = "transfer",
  subInvocations = [],
}: {
  contract?: string;
  from: string;
  to?: string;
  amount?: string;
  functionName?: string;
  subInvocations?: xdr.SorobanAuthorizedInvocation[];
}): xdr.SorobanAuthorizedInvocation => {
  const contractFn = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contract).toScAddress(),
    functionName: Buffer.from(functionName),
    args: [
      nativeToScVal(from, {type: "address"}),
      nativeToScVal(to, {type: "address"}),
      nativeToScVal(amount, {type: "i128"}),
    ],
  });

  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(contractFn),
    subInvocations,
  });
};

const createPreimage = ({
  invocation,
  address,
  expirationLedger,
  credentialVersion = "legacy",
}: {
  invocation: xdr.SorobanAuthorizedInvocation;
  address: string;
  expirationLedger: number;
  credentialVersion?: "legacy" | "v2";
}): string => {
  const credentials = new xdr.SorobanAddressCredentials({
    address: Address.fromString(address).toScAddress(),
    nonce: xdr.Int64.fromString("402"),
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

export const createWalletConformanceVectors = (
  address: string,
  currentLedger: number,
): WalletConformanceVector[] => {
  const expirationLedger = currentLedger + 12;
  const other = Keypair.random().publicKey();
  const hidden = createInvocation({from: address, functionName: "approve"});

  return [
    {
      id: "safe-direct-transfer",
      name: "signs one bounded Testnet USDC transfer",
      expected: "sign",
      authEntry: createPreimage({
        invocation: createInvocation({from: address}),
        address,
        expirationLedger,
      }),
    },
    {
      id: "bound-address-mismatch",
      name: "rejects an authorization bound to another account",
      expected: "reject",
      authEntry: createPreimage({
        invocation: createInvocation({from: other}),
        address: other,
        expirationLedger,
        credentialVersion: "v2",
      }),
    },
    {
      id: "hidden-sub-invocation",
      name: "rejects hidden Soroban sub-invocations",
      expected: "reject",
      authEntry: createPreimage({
        invocation: createInvocation({from: address, subInvocations: [hidden]}),
        address,
        expirationLedger,
      }),
    },
    {
      id: "cross-network-asset",
      name: "rejects the Mainnet USDC contract on Testnet",
      expected: "reject",
      authEntry: createPreimage({
        invocation: createInvocation({
          contract: STELLAR_USDC_ASSETS["stellar:pubnet"].contract,
          from: address,
        }),
        address,
        expirationLedger,
      }),
    },
    {
      id: "payment-limit",
      name: "rejects a transfer above the built-in Testnet cap",
      expected: "reject",
      authEntry: createPreimage({
        invocation: createInvocation({
          from: address,
          amount: (BigInt(SCOPULY_SAFETY_LIMITS_ATOMIC["stellar:testnet"]) + 1n).toString(),
        }),
        address,
        expirationLedger,
      }),
    },
    {
      id: "expired-authorization",
      name: "rejects an expired authorization",
      expected: "reject",
      authEntry: createPreimage({
        invocation: createInvocation({from: address}),
        address,
        expirationLedger: currentLedger,
      }),
    },
  ];
};

export const TESTNET_CONFORMANCE_RECIPIENT = TEST_RECIPIENT;
