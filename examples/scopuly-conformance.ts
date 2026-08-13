import {createScopulyProviderAdapter} from "../src/adapters/scopuly-provider.js";
import {runWalletConformance} from "../src/conformance/index.js";

declare global {
  interface Window {
    scopuly: Parameters<typeof createScopulyProviderAdapter>[0];
  }
}

export const runScopulyTestnetConformance = async (currentLedger: number) => (
  runWalletConformance({
    adapter: createScopulyProviderAdapter(window.scopuly),
    currentLedger,
    confirmTestnetSigning: true,
  })
);
