export type StellarX402Network = "stellar:testnet" | "stellar:pubnet";

export interface X402Resource {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: readonly string[];
  iconUrl?: string;
}

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: X402Resource;
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface GuardAsset {
  code: string;
  name: string;
  contract: string;
  decimals: number;
  issuer?: string;
}

export interface GuardNetworkPolicy {
  enabled: boolean;
  assets: GuardAsset[];
  maxPaymentAtomic: string;
  dailyLimitAtomic: string;
  requireSponsoredFees: boolean;
}

export interface GuardPolicy {
  version: number;
  enabled: boolean;
  generatedAt?: string;
  expiresAt?: string;
  allowedOrigins: string[];
  maxAuthorizationLedgerWindow: number;
  networks: Record<StellarX402Network, GuardNetworkPolicy>;
}

export interface GuardContext {
  origin: string;
  payer: string;
  requestUrl?: string;
  network?: StellarX402Network;
}

export interface GuardedPaymentIntent {
  fingerprint: string;
  x402Version: 2;
  resource: Readonly<X402Resource>;
  requirement: Readonly<X402PaymentRequirements>;
  network: StellarX402Network;
  payer: string;
  payTo: string;
  asset: GuardAsset;
  amountAtomic: string;
  amountDisplay: string;
  origin: string;
  maxTimeoutSeconds: number;
  dailyLimitAtomic: string;
  policyVersion: number;
}

export interface GuardIssue {
  code: string;
  message: string;
}

export interface TokenTransferInspection {
  kind: "directTokenTransfer";
  functionName: string;
  contract: string;
  from: string;
  to: string;
  amountAtomic: string;
  amountDisplay: string;
  asset: GuardAsset | null;
  activeNetwork: StellarX402Network;
  isAllowedAsset: boolean;
  isSafe: boolean;
  issues: readonly GuardIssue[];
  argumentsCount: number;
  invocationsCount: number;
  subInvocationsCount: number;
}

export interface AuthorizationReview {
  authEntry: string;
  fingerprint: string;
  envelopeType: string;
  network: StellarX402Network;
  networkPassphrase: string;
  expirationLedger: number;
  nonce: string;
  boundAddress: string;
  payment: TokenTransferInspection;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PaymentRecordStatus =
  | "signing"
  | "authorized"
  | "submitted"
  | "settlement_unknown"
  | "delivered"
  | "failed";

export type SettlementStatus =
  | "pending"
  | "verified"
  | "settling"
  | "settled"
  | "fulfilling"
  | "delivered"
  | "failed"
  | "settlement_unknown";

export interface SettlementReceipt {
  id: string;
  status: SettlementStatus;
  network: StellarX402Network;
  asset: string;
  amountAtomic: string;
  payTo: string;
  createdAt: string;
  payer?: string | null;
  transaction?: string | null;
  deliveredAt?: string;
  settledAt?: string;
  servedAt?: string;
}

export interface StoredReceipt {
  id: string;
  status: SettlementStatus;
  transaction: string;
  createdAt: string;
  servedAt: string;
  updatedAt: number;
}

export interface PaymentRecord {
  id: string;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  day: string;
  origin: string;
  serviceName: string;
  network: StellarX402Network;
  payer: string;
  payTo: string;
  assetCode: string;
  assetContract: string;
  assetDecimals: number;
  amountAtomic: string;
  amountDisplay: string;
  dailyLimitAtomic: string;
  policyVersion: number | null;
  expirationLedger: number | null;
  status: PaymentRecordStatus;
  errorCode: string;
  receipt: StoredReceipt | null;
}

export interface DailySpendSummary {
  day: string;
  network: StellarX402Network;
  payer: string;
  spentAtomic: string;
  limitAtomic: string;
  remainingAtomic: string;
  isLimitReached: boolean;
}

export interface StellarWalletAdapter {
  getAddress(): Promise<string>;
  getNetwork(): Promise<{
    network: StellarX402Network;
    networkPassphrase: string;
  }>;
  signAuthEntry(
    authEntry: string,
    options: {address: string; networkPassphrase: string},
  ): Promise<{signedAuthEntry: string; signerAddress?: string}>;
}

export interface ConformanceCaseResult {
  id: string;
  name: string;
  expected: "sign" | "reject";
  passed: boolean;
  message: string;
}

export interface ConformanceReport {
  standard: "scopuly-stellar-x402-wallet-conformance";
  version: 1;
  network: "stellar:testnet";
  address: string;
  generatedAt: string;
  passed: boolean;
  results: ConformanceCaseResult[];
}

export interface GuardConformanceReport {
  standard: "scopuly-stellar-x402-guard-conformance";
  version: 1;
  generatedAt: string;
  passed: boolean;
  results: ConformanceCaseResult[];
}

export interface EndpointInspection {
  url: string;
  status: number;
  valid: boolean;
  paymentRequired: X402PaymentRequired | null;
  stellarRequirements: X402PaymentRequirements[];
  issues: GuardIssue[];
}
