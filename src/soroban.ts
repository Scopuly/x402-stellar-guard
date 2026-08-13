import {
  Address,
  hash,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {Buffer} from "buffer";

import {
  MAX_AUTHORIZATION_LEDGER_WINDOW,
  STELLAR_LEDGER_CLOSE_SECONDS,
  passphraseToNetwork,
} from "./constants.js";
import {AuthorizationGuardError} from "./errors.js";
import type {
  AuthorizationReview,
  GuardAsset,
  GuardedPaymentIntent,
  StellarX402Network,
  TokenTransferInspection,
} from "./types.js";
import {formatAtomicAmount, isValidContractAddress} from "./utils.js";

const AUTHORIZED_CONTRACT_FUNCTION = "sorobanAuthorizedFunctionTypeContractFn";
const ADDRESS_VALUE = "scvAddress";
const I128_VALUE = "scvI128";
const LEGACY_AUTHORIZATION = "envelopeTypeSorobanAuthorization";
const ADDRESS_BOUND_AUTHORIZATION = "envelopeTypeSorobanAuthorizationWithAddress";
const MAX_AUTH_ENTRY_BASE64_LENGTH = 256 * 1_024;
const MAX_INVOCATIONS_TO_INSPECT = 64;

const issue = (code: string, message: string) => ({code, message});

const decodeXdrString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
};

const countInvocations = (invocation: xdr.SorobanAuthorizedInvocation): number => {
  const pending = [invocation];
  let count = 0;

  while (pending.length > 0 && count <= MAX_INVOCATIONS_TO_INSPECT) {
    const current = pending.pop();
    if (!current) break;
    count += 1;
    pending.push(...current.subInvocations());
  }

  return count;
};

const assetMap = (
  assets: Partial<Record<StellarX402Network, GuardAsset[]>>,
  network: StellarX402Network,
): Map<string, GuardAsset> => new Map(
  (assets[network] ?? [])
    .filter((asset) => (
      asset
      && typeof asset.code === "string"
      && typeof asset.name === "string"
      && typeof asset.contract === "string"
      && isValidContractAddress(asset.contract)
      && Number.isSafeInteger(asset.decimals)
      && asset.decimals >= 0
      && asset.decimals <= 18
    ))
    .map((asset) => [asset.contract, asset]),
);

export const inspectDirectTokenTransfer = ({
  invocation,
  networkPassphrase,
  assets,
}: {
  invocation: xdr.SorobanAuthorizedInvocation;
  networkPassphrase: string;
  assets: Partial<Record<StellarX402Network, GuardAsset[]>>;
}): TokenTransferInspection | null => {
  const network = passphraseToNetwork(networkPassphrase);

  if (!network) {
    throw new AuthorizationGuardError(
      "Unsupported Stellar network passphrase.",
      "X402_AUTHORIZATION_NETWORK_UNSUPPORTED",
    );
  }

  const authorizedFunction = invocation.function();

  if (authorizedFunction.switch().name !== AUTHORIZED_CONTRACT_FUNCTION) return null;

  const contractFn = authorizedFunction.contractFn();
  const functionName = decodeXdrString(contractFn.functionName());

  if (functionName !== "transfer") return null;

  const issues = [];
  const args = contractFn.args();
  const subInvocationsCount = invocation.subInvocations().length;
  const invocationsCount = countInvocations(invocation);
  let contract = "";
  let from = "";
  let to = "";
  let amountAtomic = "";

  try {
    contract = Address.fromScAddress(contractFn.contractAddress()).toString();
  }
  catch {
    issues.push(issue("INVALID_CONTRACT", "Transfer contract address could not be decoded."));
  }

  if (subInvocationsCount > 0 || invocationsCount !== 1) {
    issues.push(issue(
      "UNEXPECTED_SUB_INVOCATIONS",
      "Direct token transfers must not authorize additional Soroban invocations.",
    ));
  }

  if (args.length !== 3) {
    issues.push(issue("INVALID_ARGUMENT_COUNT", `Transfer must contain exactly 3 arguments, received ${args.length}.`));
  }

  if (args[0]?.switch().name !== ADDRESS_VALUE) {
    issues.push(issue("INVALID_FROM", "Transfer sender must be a Stellar address."));
  }
  else {
    try {
      from = String(scValToNative(args[0]));
    }
    catch {
      issues.push(issue("INVALID_FROM", "Transfer sender could not be decoded."));
    }
  }

  if (args[1]?.switch().name !== ADDRESS_VALUE) {
    issues.push(issue("INVALID_TO", "Transfer recipient must be a Stellar address."));
  }
  else {
    try {
      to = String(scValToNative(args[1]));
    }
    catch {
      issues.push(issue("INVALID_TO", "Transfer recipient could not be decoded."));
    }
  }

  if (args[2]?.switch().name !== I128_VALUE) {
    issues.push(issue("INVALID_AMOUNT", "Transfer amount must be a signed 128-bit integer."));
  }
  else {
    try {
      amountAtomic = String(scValToNative(args[2]));

      if (BigInt(amountAtomic) <= 0n) {
        issues.push(issue("INVALID_AMOUNT", "Transfer amount must be greater than zero."));
      }
    }
    catch {
      issues.push(issue("INVALID_AMOUNT", "Transfer amount could not be decoded."));
    }
  }

  const allowedAsset = assetMap(assets, network).get(contract) ?? null;

  if (!allowedAsset) {
    issues.push(issue("ASSET_NOT_ALLOWED", "Transfer asset is not allowed for the selected Stellar network."));
  }

  return {
    kind: "directTokenTransfer",
    functionName,
    contract,
    from,
    to,
    amountAtomic,
    amountDisplay: amountAtomic && allowedAsset
      ? formatAtomicAmount(amountAtomic, allowedAsset.decimals)
      : amountAtomic,
    asset: allowedAsset,
    activeNetwork: network,
    isAllowedAsset: Boolean(allowedAsset),
    isSafe: issues.length === 0,
    issues,
    argumentsCount: args.length,
    invocationsCount,
    subInvocationsCount,
  };
};

const decodeAuthorization = (authEntry: string, networkPassphrase: string) => {
  let preimage: xdr.HashIdPreimage;

  if (
    typeof authEntry !== "string"
    || authEntry.length === 0
    || authEntry.length > MAX_AUTH_ENTRY_BASE64_LENGTH
    || authEntry.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(authEntry)
  ) {
    throw new AuthorizationGuardError(
      "Soroban authorization entry must be bounded padded Base64.",
      "X402_AUTHORIZATION_ENCODING_INVALID",
    );
  }

  try {
    preimage = xdr.HashIdPreimage.fromXDR(authEntry, "base64");
  }
  catch (error) {
    throw new AuthorizationGuardError(
      "Soroban authorization entry XDR could not be decoded.",
      "X402_AUTHORIZATION_XDR_INVALID",
      {cause: error},
    );
  }

  const envelopeType = preimage.switch().name;

  if (![LEGACY_AUTHORIZATION, ADDRESS_BOUND_AUTHORIZATION].includes(envelopeType)) {
    throw new AuthorizationGuardError(
      "XDR is not a Soroban authorization preimage.",
      "X402_AUTHORIZATION_TYPE_INVALID",
    );
  }

  const authorization = envelopeType === ADDRESS_BOUND_AUTHORIZATION
    ? preimage.sorobanAuthorizationWithAddress()
    : preimage.sorobanAuthorization();
  const boundAddress = envelopeType === ADDRESS_BOUND_AUTHORIZATION
    ? Address.fromScAddress(preimage.sorobanAuthorizationWithAddress().address()).toString()
    : "";
  const expectedNetworkId = hash(Buffer.from(networkPassphrase, "utf8"));

  if (!authorization.networkId().equals(expectedNetworkId)) {
    throw new AuthorizationGuardError(
      "Soroban authorization entry is for a different Stellar network.",
      "X402_AUTHORIZATION_NETWORK_MISMATCH",
    );
  }

  return {preimage, authorization, envelopeType, boundAddress};
};

export const authorizationPayloadHash = (authEntry: string, networkPassphrase: string): Uint8Array => {
  const {preimage} = decodeAuthorization(authEntry, networkPassphrase);
  return hash(preimage.toXDR());
};

export interface GuardAuthorizationOptions {
  currentLedger: number;
  maxLedgerWindow?: number;
  estimatedLedgerCloseSeconds?: number;
}

export const guardAuthorizationEntry = (
  authEntry: string,
  networkPassphrase: string,
  intent: GuardedPaymentIntent,
  options: GuardAuthorizationOptions,
): AuthorizationReview => {
  const network = passphraseToNetwork(networkPassphrase);

  if (!network || network !== intent.network) {
    throw new AuthorizationGuardError(
      "Authorization network does not match the guarded payment intent.",
      "X402_AUTHORIZATION_NETWORK_MISMATCH",
    );
  }

  const {preimage, authorization, envelopeType, boundAddress} = decodeAuthorization(authEntry, networkPassphrase);
  const expirationLedger = Number(authorization.signatureExpirationLedger());
  const currentLedger = Number(options.currentLedger);
  const maxLedgerWindow = options.maxLedgerWindow ?? MAX_AUTHORIZATION_LEDGER_WINDOW;
  const estimatedLedgerCloseSeconds = options.estimatedLedgerCloseSeconds ?? STELLAR_LEDGER_CLOSE_SECONDS;

  if (!Number.isSafeInteger(currentLedger) || currentLedger <= 0) {
    throw new AuthorizationGuardError("Current Stellar ledger is invalid.", "X402_CURRENT_LEDGER_INVALID");
  }

  if (
    !Number.isSafeInteger(maxLedgerWindow)
    || maxLedgerWindow <= 0
    || maxLedgerWindow > MAX_AUTHORIZATION_LEDGER_WINDOW
    || !Number.isFinite(estimatedLedgerCloseSeconds)
    || estimatedLedgerCloseSeconds <= 0
    || estimatedLedgerCloseSeconds > 60
  ) {
    throw new AuthorizationGuardError(
      "Authorization ledger-window configuration is invalid.",
      "X402_AUTHORIZATION_WINDOW_INVALID",
    );
  }

  if (!Number.isSafeInteger(expirationLedger) || expirationLedger <= currentLedger) {
    throw new AuthorizationGuardError("Payment authorization has expired.", "X402_AUTHORIZATION_EXPIRED");
  }

  const timeoutLedgerWindow = Math.ceil(intent.maxTimeoutSeconds / estimatedLedgerCloseSeconds);
  const allowedLedgerWindow = Math.min(maxLedgerWindow, timeoutLedgerWindow);

  if (expirationLedger > currentLedger + allowedLedgerWindow) {
    throw new AuthorizationGuardError(
      "Payment authorization lifetime exceeds the payment timeout or policy limit.",
      "X402_AUTHORIZATION_TOO_LONG",
      {allowedLedgerWindow, timeoutLedgerWindow},
    );
  }

  if (boundAddress && boundAddress !== intent.payer) {
    throw new AuthorizationGuardError(
      "Authorization is bound to a different Stellar account.",
      "X402_AUTHORIZATION_BOUND_ADDRESS_MISMATCH",
    );
  }

  const payment = inspectDirectTokenTransfer({
    invocation: authorization.invocation(),
    networkPassphrase,
    assets: {[network]: [intent.asset]},
  });

  if (!payment) {
    throw new AuthorizationGuardError(
      "Authorization is not a direct SEP-41 transfer.",
      "X402_AUTHORIZATION_NOT_TRANSFER",
    );
  }

  if (!payment.isSafe) {
    throw new AuthorizationGuardError(
      payment.issues.map((entry) => entry.message).join(" "),
      payment.issues[0]?.code ?? "X402_AUTHORIZATION_UNSAFE",
      {issues: payment.issues},
    );
  }

  const mismatches = [
    payment.from !== intent.payer ? "payer" : "",
    payment.to !== intent.payTo ? "recipient" : "",
    payment.contract !== intent.asset.contract ? "asset" : "",
    payment.amountAtomic !== intent.amountAtomic ? "amount" : "",
  ].filter(Boolean);

  if (mismatches.length > 0) {
    throw new AuthorizationGuardError(
      `Authorization does not match the reviewed payment intent: ${mismatches.join(", ")}.`,
      "X402_AUTHORIZATION_INTENT_MISMATCH",
      {mismatches},
    );
  }

  return Object.freeze({
    authEntry,
    fingerprint: hash(preimage.toXDR()).toString("hex"),
    envelopeType,
    network,
    networkPassphrase,
    expirationLedger,
    nonce: authorization.nonce().toString(),
    boundAddress,
    payment: Object.freeze({...payment, issues: Object.freeze([...payment.issues])}),
  });
};
