import {
  DEFAULT_MAX_TIMEOUT_SECONDS,
  STELLAR_PUBNET,
  X402_EXACT_SCHEME,
  X402_VERSION,
  isStellarX402Network,
} from "./constants.js";
import {PaymentRequiredError, PolicyError} from "./errors.js";
import {createDefaultGuardPolicy} from "./policy.js";
import type {
  GuardContext,
  GuardPolicy,
  GuardedPaymentIntent,
  X402PaymentRequired,
  X402PaymentRequirements,
  X402Resource,
} from "./types.js";
import {
  assertAtomicAmount,
  canonicalJson,
  formatAtomicAmount,
  isValidContractAddress,
  isValidStellarAddress,
  normalizeHttpsOrigin,
  normalizeResourceUrl,
  sha256Hex,
} from "./utils.js";

const MAX_PAYMENT_REQUIRED_INPUT_LENGTH = 128 * 1_024;
const MAX_PAYMENT_REQUIRED_JSON_DEPTH = 32;
const MAX_PAYMENT_REQUIRED_JSON_NODES = 4_096;
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

const assertBoundedJsonShape = (value: unknown): void => {
  const pending: Array<{value: unknown; depth: number}> = [{value, depth: 0}];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;

    nodes += 1;
    if (nodes > MAX_PAYMENT_REQUIRED_JSON_NODES || current.depth > MAX_PAYMENT_REQUIRED_JSON_DEPTH) {
      throw new PaymentRequiredError(
        "PAYMENT-REQUIRED JSON structure is too complex.",
        "X402_PAYMENT_REQUIRED_SIZE_INVALID",
      );
    }

    if (!current.value || typeof current.value !== "object") continue;
    for (const entry of Object.values(current.value)) {
      pending.push({value: entry, depth: current.depth + 1});
    }
  }
};

const deepFreezeJson = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreezeJson(entry);
    Object.freeze(value);
  }
  return value;
};

const decodeBase64Utf8 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  }
  catch (error) {
    throw new PaymentRequiredError(
      "PAYMENT-REQUIRED is not valid Base64-encoded UTF-8.",
      "X402_PAYMENT_REQUIRED_BASE64_INVALID",
      {cause: error},
    );
  }
};

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentRequiredError(message);
  }

  return value as Record<string, unknown>;
};

const requiredText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== "string") {
    throw new PaymentRequiredError(`${field} must be a string.`, "X402_PAYMENT_REQUIRED_SCHEMA_INVALID");
  }

  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new PaymentRequiredError(`${field} has an invalid length.`, "X402_PAYMENT_REQUIRED_SCHEMA_INVALID");
  }

  return text;
};

const optionalText = (value: unknown, field: string, maxLength: number): string | undefined => {
  if (value === undefined) return undefined;
  return requiredText(value, field, maxLength);
};

const printableMetadata = (value: unknown, field: string): string => {
  const text = requiredText(value, field, 32);
  if (!PRINTABLE_ASCII.test(text)) {
    throw new PaymentRequiredError(`${field} must contain printable ASCII.`, "X402_PAYMENT_REQUIRED_SCHEMA_INVALID");
  }
  return text;
};

const parseTags = (value: unknown): readonly string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5) {
    throw new PaymentRequiredError("resource.tags must contain at most 5 strings.", "X402_PAYMENT_REQUIRED_SCHEMA_INVALID");
  }
  return value.map((tag) => printableMetadata(tag, "resource.tags[]"));
};

const parseIconUrl = (value: unknown): string | undefined => {
  const iconUrl = optionalText(value, "resource.iconUrl", 2_048);
  if (!iconUrl) return undefined;

  try {
    const url = new URL(iconUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  }
  catch {
    throw new PaymentRequiredError("resource.iconUrl must be an absolute HTTP(S) URL.", "X402_PAYMENT_REQUIRED_SCHEMA_INVALID");
  }
};

const parseResource = (value: unknown): X402Resource => {
  const resource = asRecord(value, "PAYMENT-REQUIRED resource is missing.");
  const url = requiredText(resource.url, "resource.url", 2_048);
  const description = optionalText(resource.description, "resource.description", 1_024);
  const mimeType = optionalText(resource.mimeType, "resource.mimeType", 120);
  const serviceName = resource.serviceName === undefined
    ? undefined
    : printableMetadata(resource.serviceName, "resource.serviceName");
  const tags = parseTags(resource.tags);
  const iconUrl = parseIconUrl(resource.iconUrl);

  return {
    url,
    ...(description ? {description} : {}),
    ...(mimeType ? {mimeType} : {}),
    ...(serviceName ? {serviceName} : {}),
    ...(tags ? {tags} : {}),
    ...(iconUrl ? {iconUrl} : {}),
  };
};

const parseRequirement = (value: unknown): X402PaymentRequirements => {
  const requirement = asRecord(value, "PAYMENT-REQUIRED contains an invalid payment requirement.");
  const extra = requirement.extra === undefined
    ? undefined
    : asRecord(requirement.extra, "Payment requirement extra must be an object.");
  const maxTimeoutSeconds = requirement.maxTimeoutSeconds;

  if (!Number.isSafeInteger(maxTimeoutSeconds) || Number(maxTimeoutSeconds) <= 0) {
    throw new PaymentRequiredError(
      "Payment requirement maxTimeoutSeconds must be a positive integer.",
      "X402_PAYMENT_REQUIRED_SCHEMA_INVALID",
    );
  }

  return {
    scheme: requiredText(requirement.scheme, "accepts[].scheme", 40),
    network: requiredText(requirement.network, "accepts[].network", 80),
    amount: requiredText(requirement.amount, "accepts[].amount", 80),
    asset: requiredText(requirement.asset, "accepts[].asset", 120),
    payTo: requiredText(requirement.payTo, "accepts[].payTo", 120),
    maxTimeoutSeconds: Number(maxTimeoutSeconds),
    ...(extra ? {extra: {...extra}} : {}),
  };
};

export const parsePaymentRequired = (input: unknown): X402PaymentRequired => {
  let payload: unknown = input;

  if (typeof input === "string") {
    const trimmed = input.trim();

    if (!trimmed || trimmed.length > MAX_PAYMENT_REQUIRED_INPUT_LENGTH) {
      throw new PaymentRequiredError(
        "PAYMENT-REQUIRED input is empty or too large.",
        "X402_PAYMENT_REQUIRED_SIZE_INVALID",
      );
    }

    try {
      payload = JSON.parse(trimmed.startsWith("{") ? trimmed : decodeBase64Utf8(trimmed));
    }
    catch (error) {
      if (error instanceof PaymentRequiredError) throw error;
      throw new PaymentRequiredError(
        "PAYMENT-REQUIRED is not valid JSON.",
        "X402_PAYMENT_REQUIRED_JSON_INVALID",
        {cause: error},
      );
    }
  }
  else {
    try {
      const serialized = JSON.stringify(input);
      if (!serialized || serialized.length > MAX_PAYMENT_REQUIRED_INPUT_LENGTH) throw new Error();
      payload = JSON.parse(serialized);
    }
    catch (error) {
      throw new PaymentRequiredError(
        "PAYMENT-REQUIRED object must be bounded JSON data.",
        "X402_PAYMENT_REQUIRED_SIZE_INVALID",
        {cause: error},
      );
    }
  }

  assertBoundedJsonShape(payload);
  const record = asRecord(payload, "PAYMENT-REQUIRED must be an object.");
  const accepts = Array.isArray(record.accepts) ? record.accepts.map(parseRequirement) : [];

  if (record.x402Version !== X402_VERSION) {
    throw new PaymentRequiredError("Only x402 version 2 is supported.", "X402_VERSION_UNSUPPORTED");
  }

  if (accepts.length === 0 || accepts.length > 32) {
    throw new PaymentRequiredError("PAYMENT-REQUIRED must contain between 1 and 32 requirements.");
  }

  const error = optionalText(record.error, "error", 1_024);
  let extensions: Record<string, unknown> | undefined;

  if (record.extensions !== undefined) {
    extensions = asRecord(record.extensions, "PAYMENT-REQUIRED extensions must be an object.");
  }

  return {
    x402Version: X402_VERSION,
    ...(error ? {error} : {}),
    resource: parseResource(record.resource),
    accepts,
    ...(extensions ? {extensions: {...extensions}} : {}),
  };
};

export interface GuardPaymentOptions {
  policy?: GuardPolicy;
  allowLocalhost?: boolean;
}

export const guardPaymentRequired = (
  input: unknown,
  context: GuardContext,
  options: GuardPaymentOptions = {},
): GuardedPaymentIntent => {
  const paymentRequired = parsePaymentRequired(input);
  const policy = options.policy ?? createDefaultGuardPolicy();
  const origin = normalizeHttpsOrigin(context.origin, options.allowLocalhost);
  const resourceUrl = normalizeResourceUrl(paymentRequired.resource.url, options.allowLocalhost);

  if (!policy.enabled) {
    throw new PolicyError("x402 payments are disabled by policy.", "X402_POLICY_DISABLED");
  }

  if (policy.expiresAt) {
    const expiresAt = Date.parse(policy.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new PolicyError("x402 payment policy is invalid or expired.", "X402_POLICY_EXPIRED");
    }
  }

  if (!origin || !resourceUrl) {
    throw new PaymentRequiredError(
      "Payment origin and resource must use clean HTTPS URLs.",
      "X402_RESOURCE_URL_UNSAFE",
    );
  }

  if (new URL(resourceUrl).origin !== origin) {
    throw new PaymentRequiredError(
      "PAYMENT-REQUIRED resource origin does not match the requesting origin.",
      "X402_RESOURCE_ORIGIN_MISMATCH",
    );
  }

  if (context.requestUrl) {
    const requestUrl = normalizeResourceUrl(context.requestUrl, options.allowLocalhost);

    if (!requestUrl || requestUrl !== resourceUrl) {
      throw new PaymentRequiredError(
        "PAYMENT-REQUIRED resource URL does not match the requested URL.",
        "X402_RESOURCE_URL_MISMATCH",
      );
    }
  }

  if (!isValidStellarAddress(context.payer)) {
    throw new PaymentRequiredError("A valid Stellar payer is required.", "X402_PAYER_INVALID");
  }

  const matching = paymentRequired.accepts.filter((requirement) => (
    requirement.scheme === X402_EXACT_SCHEME
    && isStellarX402Network(requirement.network)
    && (!context.network || requirement.network === context.network)
  ));

  if (matching.length !== 1) {
    throw new PaymentRequiredError(
      matching.length === 0
        ? "No supported Stellar exact payment requirement was found."
        : "Multiple Stellar requirements match; select a network explicitly.",
      matching.length === 0 ? "X402_REQUIREMENT_UNSUPPORTED" : "X402_REQUIREMENT_AMBIGUOUS",
    );
  }

  const requirement = matching[0];
  if (!requirement || !isStellarX402Network(requirement.network)) {
    throw new PaymentRequiredError("Stellar requirement selection failed.");
  }

  const networkPolicy = policy.networks[requirement.network];

  if (!networkPolicy.enabled) {
    throw new PolicyError(`${requirement.network} is disabled by policy.`, "X402_NETWORK_DISABLED");
  }

  if (requirement.network === STELLAR_PUBNET && !policy.allowedOrigins.includes(origin)) {
    throw new PolicyError("Mainnet origin is not allowed by policy.", "X402_ORIGIN_BLOCKED");
  }

  if (!isValidStellarAddress(requirement.payTo) || !isValidContractAddress(requirement.asset)) {
    throw new PaymentRequiredError("Stellar recipient or asset contract is invalid.", "X402_ADDRESS_INVALID");
  }

  const asset = networkPolicy.assets.find((candidate) => candidate.contract === requirement.asset);

  if (!asset) {
    throw new PolicyError("Payment asset is not allowed by policy.", "X402_ASSET_BLOCKED");
  }

  const amountAtomic = assertAtomicAmount(requirement.amount);

  if (BigInt(amountAtomic) > BigInt(networkPolicy.maxPaymentAtomic)) {
    throw new PolicyError("Payment exceeds the per-payment policy limit.", "X402_PAYMENT_LIMIT_EXCEEDED");
  }

  if (
    !Number.isSafeInteger(requirement.maxTimeoutSeconds)
    || requirement.maxTimeoutSeconds <= 0
    || requirement.maxTimeoutSeconds > DEFAULT_MAX_TIMEOUT_SECONDS
  ) {
    throw new PaymentRequiredError("Payment timeout is outside the safe range.", "X402_TIMEOUT_INVALID");
  }

  if (networkPolicy.requireSponsoredFees && requirement.extra?.areFeesSponsored !== true) {
    throw new PolicyError("Only fee-sponsored Stellar x402 payments are allowed.", "X402_FEES_NOT_SPONSORED");
  }

  const frozenExtra = requirement.extra ? deepFreezeJson({...requirement.extra}) : undefined;
  const frozenRequirement: Readonly<X402PaymentRequirements> = Object.freeze({
    ...requirement,
    ...(frozenExtra ? {extra: frozenExtra} : {}),
  });
  const frozenResource = Object.freeze({
    ...paymentRequired.resource,
    ...(paymentRequired.resource.tags ? {tags: Object.freeze([...paymentRequired.resource.tags])} : {}),
    url: resourceUrl,
  });
  const fingerprint = sha256Hex(canonicalJson({
    x402Version: X402_VERSION,
    resource: frozenResource,
    requirement: frozenRequirement,
    origin,
    payer: context.payer,
  }));

  return Object.freeze({
    fingerprint,
    x402Version: X402_VERSION,
    resource: frozenResource,
    requirement: frozenRequirement,
    network: requirement.network,
    payer: context.payer,
    payTo: requirement.payTo,
    asset: Object.freeze({...asset}),
    amountAtomic,
    amountDisplay: formatAtomicAmount(amountAtomic, asset.decimals),
    origin,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    dailyLimitAtomic: networkPolicy.dailyLimitAtomic,
    policyVersion: policy.version,
  });
};
