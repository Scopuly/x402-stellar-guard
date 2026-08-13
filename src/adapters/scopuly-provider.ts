import {networkToPassphrase} from "../constants.js";
import {ConformanceError} from "../errors.js";
import type {StellarWalletAdapter, StellarX402Network} from "../types.js";

interface ProviderError {
  code?: number;
  message?: string;
}

interface ProviderResult {
  address?: string;
  network?: string;
  networkPassphrase?: string;
  signedAuthEntry?: string;
  signerAddress?: string;
  error?: ProviderError;
}

export interface ScopulyProvider {
  isScopuly?: boolean;
  platform?: string;
  requestAccess?(): Promise<ProviderResult>;
  getAddress?(): Promise<ProviderResult>;
  getPublicKey?(): Promise<string>;
  getNetwork(): Promise<ProviderResult>;
  signAuthEntry(
    authEntry: string,
    options: {address: string; networkPassphrase: string},
  ): Promise<ProviderResult>;
}

const providerError = (result: ProviderResult, fallback: string): Error => (
  new ConformanceError(
    result.error?.message ?? fallback,
    "SCOPULY_PROVIDER_ERROR",
    result.error ? {providerCode: result.error.code} : {},
  )
);

const normalizeProviderNetwork = (value: string | undefined): StellarX402Network | null => {
  if (value === "TESTNET" || value === "stellar:testnet") return "stellar:testnet";
  if (value === "PUBLIC" || value === "stellar:pubnet") return "stellar:pubnet";
  return null;
};

export const createScopulyProviderAdapter = (provider: ScopulyProvider): StellarWalletAdapter => {
  if (!provider || provider.isScopuly !== true || !["mobile", "extension"].includes(provider.platform ?? "")) {
    throw new ConformanceError(
      "A Scopuly Mobile or paired browser extension provider is required.",
      "SCOPULY_PROVIDER_UNAVAILABLE",
    );
  }

  return {
    async getAddress() {
      const access = provider.requestAccess ? await provider.requestAccess() : undefined;
      if (access?.error) throw providerError(access, "Scopuly access request failed.");
      if (access?.address) return access.address;

      if (provider.getAddress) {
        const result = await provider.getAddress();
        if (result.error) throw providerError(result, "Scopuly address request failed.");
        if (result.address) return result.address;
      }

      if (provider.getPublicKey) return provider.getPublicKey();
      throw new ConformanceError("Scopuly did not return an address.", "SCOPULY_ADDRESS_UNAVAILABLE");
    },

    async getNetwork() {
      const result = await provider.getNetwork();
      if (result.error) throw providerError(result, "Scopuly network request failed.");
      const network = normalizeProviderNetwork(result.network);

      if (
        !network
        || !result.networkPassphrase
        || result.networkPassphrase !== networkToPassphrase(network)
      ) {
        throw new ConformanceError("Scopuly returned an unsupported network.", "SCOPULY_NETWORK_INVALID");
      }

      return {
        network,
        networkPassphrase: result.networkPassphrase,
      };
    },

    async signAuthEntry(authEntry, options) {
      const result = await provider.signAuthEntry(authEntry, options);
      if (result.error) throw providerError(result, "Scopuly rejected the authorization entry.");
      if (!result.signedAuthEntry) {
        throw new ConformanceError("Scopuly returned no signature.", "SCOPULY_SIGNATURE_MISSING");
      }

      return {
        signedAuthEntry: result.signedAuthEntry,
        ...(result.signerAddress ? {signerAddress: result.signerAddress} : {}),
      };
    },
  };
};
