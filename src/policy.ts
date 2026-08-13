import {
  MAX_AUTHORIZATION_LEDGER_WINDOW,
  SCOPULY_SAFETY_LIMITS_ATOMIC,
  STELLAR_PUBNET,
  STELLAR_TESTNET,
  STELLAR_USDC_ASSETS,
} from "./constants.js";
import {PolicyError} from "./errors.js";
import type {GuardNetworkPolicy, GuardPolicy, StellarX402Network} from "./types.js";
import {assertAtomicAmount, isValidContractAddress, normalizeHttpsOrigin} from "./utils.js";

export interface DefaultPolicyOptions {
  allowedOrigins?: string[];
  pubnetEnabled?: boolean;
  testnetEnabled?: boolean;
  now?: number;
}

export const createDefaultGuardPolicy = (options: DefaultPolicyOptions = {}): GuardPolicy => {
  const now = options.now ?? Date.now();
  const allowedOrigins = [...new Set(
    (options.allowedOrigins ?? []).map((origin) => normalizeHttpsOrigin(origin)).filter(Boolean),
  )];

  return {
    version: 1,
    enabled: true,
    generatedAt: new Date(now).toISOString(),
    allowedOrigins,
    maxAuthorizationLedgerWindow: MAX_AUTHORIZATION_LEDGER_WINDOW,
    networks: {
      [STELLAR_TESTNET]: {
        enabled: options.testnetEnabled ?? true,
        assets: [{...STELLAR_USDC_ASSETS[STELLAR_TESTNET]}],
        maxPaymentAtomic: SCOPULY_SAFETY_LIMITS_ATOMIC[STELLAR_TESTNET],
        dailyLimitAtomic: SCOPULY_SAFETY_LIMITS_ATOMIC[STELLAR_TESTNET],
        requireSponsoredFees: true,
      },
      [STELLAR_PUBNET]: {
        enabled: options.pubnetEnabled ?? false,
        assets: [{...STELLAR_USDC_ASSETS[STELLAR_PUBNET]}],
        maxPaymentAtomic: SCOPULY_SAFETY_LIMITS_ATOMIC[STELLAR_PUBNET],
        dailyLimitAtomic: SCOPULY_SAFETY_LIMITS_ATOMIC[STELLAR_PUBNET],
        requireSponsoredFees: true,
      },
    },
  };
};

const validateNetworkPolicy = (
  network: StellarX402Network,
  candidate: GuardNetworkPolicy | undefined,
  ceiling: GuardNetworkPolicy,
): GuardNetworkPolicy => {
  if (
    !candidate
    || typeof candidate !== "object"
    || typeof candidate.enabled !== "boolean"
    || typeof candidate.requireSponsoredFees !== "boolean"
  ) {
    throw new PolicyError(`Policy for ${network} is invalid.`, "X402_POLICY_NETWORK_INVALID");
  }

  const maxPaymentAtomic = assertAtomicAmount(candidate.maxPaymentAtomic, `${network}.maxPaymentAtomic`);
  const dailyLimitAtomic = assertAtomicAmount(candidate.dailyLimitAtomic, `${network}.dailyLimitAtomic`);

  if (
    BigInt(maxPaymentAtomic) > BigInt(ceiling.maxPaymentAtomic)
    || BigInt(dailyLimitAtomic) > BigInt(ceiling.dailyLimitAtomic)
  ) {
    throw new PolicyError(
      `Policy for ${network} exceeds its built-in safety ceiling.`,
      "X402_POLICY_LIMIT_INCREASE",
    );
  }

  if (!Array.isArray(candidate.assets) || candidate.assets.length === 0 || candidate.assets.length > 32) {
    throw new PolicyError(`Policy for ${network} must allow at least one asset.`, "X402_POLICY_ASSETS_INVALID");
  }

  const ceilingAssets = new Map(ceiling.assets.map((asset) => [asset.contract, asset]));
  const seenContracts = new Set<string>();
  const assets = candidate.assets.map((asset) => {
    const trustedAsset = asset && typeof asset === "object"
      ? ceilingAssets.get(asset.contract)
      : undefined;

    if (
      !trustedAsset
      || seenContracts.has(asset.contract)
      || !isValidContractAddress(asset.contract)
      || asset.code !== trustedAsset.code
      || asset.name !== trustedAsset.name
      || asset.decimals !== trustedAsset.decimals
      || asset.issuer !== trustedAsset.issuer
    ) {
      throw new PolicyError(
        `Policy contains an untrusted asset for ${network}.`,
        "X402_POLICY_ASSET_NOT_BUILT_IN",
      );
    }

    seenContracts.add(asset.contract);
    return {...trustedAsset};
  });

  return {
    enabled: candidate.enabled && ceiling.enabled,
    assets,
    maxPaymentAtomic,
    dailyLimitAtomic,
    requireSponsoredFees: ceiling.requireSponsoredFees || candidate.requireSponsoredFees,
  };
};

export const restrictGuardPolicy = (
  candidate: GuardPolicy,
  basePolicy = createDefaultGuardPolicy(),
  now = Date.now(),
): GuardPolicy => {
  if (!candidate || candidate.version !== basePolicy.version || typeof candidate.enabled !== "boolean") {
    throw new PolicyError("Policy version or enabled state is invalid.", "X402_POLICY_INVALID");
  }

  if (
    !Array.isArray(candidate.allowedOrigins)
    || !candidate.networks
    || typeof candidate.networks !== "object"
    || Array.isArray(candidate.networks)
  ) {
    throw new PolicyError("Policy shape is invalid.", "X402_POLICY_INVALID");
  }

  if (
    candidate.generatedAt !== undefined
    && (typeof candidate.generatedAt !== "string" || !Number.isFinite(Date.parse(candidate.generatedAt)))
  ) {
    throw new PolicyError("Policy generation timestamp is invalid.", "X402_POLICY_INVALID");
  }

  if (candidate.expiresAt !== undefined) {
    if (typeof candidate.expiresAt !== "string") {
      throw new PolicyError("Policy expiration is invalid.", "X402_POLICY_EXPIRED");
    }
    const expiresAt = Date.parse(candidate.expiresAt);

    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new PolicyError("Policy is expired.", "X402_POLICY_EXPIRED");
    }
  }

  if (
    !Number.isSafeInteger(candidate.maxAuthorizationLedgerWindow)
    || candidate.maxAuthorizationLedgerWindow <= 0
    || candidate.maxAuthorizationLedgerWindow > basePolicy.maxAuthorizationLedgerWindow
  ) {
    throw new PolicyError(
      "Policy authorization window exceeds the built-in safety ceiling.",
      "X402_POLICY_LEDGER_WINDOW_INVALID",
    );
  }

  const requestedOrigins = [...new Set(
    candidate.allowedOrigins.map((origin) => normalizeHttpsOrigin(origin)).filter(Boolean),
  )];

  if (requestedOrigins.length !== candidate.allowedOrigins.length) {
    throw new PolicyError("Policy contains an invalid HTTPS origin.", "X402_POLICY_ORIGIN_INVALID");
  }

  const baseOrigins = new Set(basePolicy.allowedOrigins);
  const allowedOrigins = requestedOrigins.filter((origin) => baseOrigins.has(origin));

  return {
    version: candidate.version,
    enabled: candidate.enabled && basePolicy.enabled,
    ...(candidate.generatedAt ? {generatedAt: candidate.generatedAt} : {}),
    ...(candidate.expiresAt ? {expiresAt: candidate.expiresAt} : {}),
    allowedOrigins,
    maxAuthorizationLedgerWindow: candidate.maxAuthorizationLedgerWindow,
    networks: {
      [STELLAR_TESTNET]: validateNetworkPolicy(
        STELLAR_TESTNET,
        candidate.networks[STELLAR_TESTNET],
        basePolicy.networks[STELLAR_TESTNET],
      ),
      [STELLAR_PUBNET]: validateNetworkPolicy(
        STELLAR_PUBNET,
        candidate.networks[STELLAR_PUBNET],
        basePolicy.networks[STELLAR_PUBNET],
      ),
    },
  };
};

export interface RemotePolicyOptions {
  basePolicy?: GuardPolicy;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: number;
}

export const loadRestrictedGuardPolicy = async (
  url: string,
  options: RemotePolicyOptions = {},
): Promise<GuardPolicy> => {
  let target: URL;

  try {
    target = new URL(url);
  }
  catch (error) {
    throw new PolicyError("Remote policy URL is invalid.", "X402_POLICY_URL_INVALID", {cause: error});
  }

  if (target.protocol !== "https:" || target.username || target.password || target.hash) {
    throw new PolicyError("Remote policy URL must be clean HTTPS.", "X402_POLICY_URL_INVALID");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  if (
    typeof fetchImpl !== "function"
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > 60_000
  ) {
    throw new PolicyError("Remote policy loader configuration is invalid.", "X402_POLICY_UNAVAILABLE");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(target, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {accept: "application/json"},
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new PolicyError(
        `Remote policy returned HTTP ${response.status}.`,
        "X402_POLICY_UNAVAILABLE",
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 128 * 1_024) {
      throw new PolicyError("Remote policy response is too large.", "X402_POLICY_UNAVAILABLE");
    }

    const body = await response.text();
    if (!body || body.length > 128 * 1_024) {
      throw new PolicyError("Remote policy response is empty or too large.", "X402_POLICY_UNAVAILABLE");
    }

    const payload = JSON.parse(body) as {policy?: GuardPolicy} | GuardPolicy;
    const candidate = "policy" in payload && payload.policy ? payload.policy : payload as GuardPolicy;
    return restrictGuardPolicy(candidate, options.basePolicy, options.now);
  }
  catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("Remote policy could not be loaded.", "X402_POLICY_UNAVAILABLE", {cause: error});
  }
  finally {
    globalThis.clearTimeout(timeout);
  }
};
