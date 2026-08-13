import {isStellarX402Network} from "./constants.js";
import {PaymentRequiredError} from "./errors.js";
import {parsePaymentRequired} from "./payment-required.js";
import type {EndpointInspection, GuardIssue} from "./types.js";

const paymentRequiredHeader = (headers: Headers): string => (
  headers.get("payment-required") ?? headers.get("PAYMENT-REQUIRED") ?? ""
);

export interface InspectEndpointOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const inspectX402Endpoint = async (
  input: string,
  options: InspectEndpointOptions = {},
): Promise<EndpointInspection> => {
  let url: URL;

  try {
    url = new URL(input);
  }
  catch (error) {
    throw new PaymentRequiredError("Endpoint must be an absolute URL.", "X402_INSPECT_URL_INVALID", {cause: error});
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new PaymentRequiredError("Endpoint must be a clean HTTPS URL.", "X402_INSPECT_URL_INVALID");
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new PaymentRequiredError(
      "Endpoint inspection timeout must be an integer between 1 and 60000 milliseconds.",
      "X402_INSPECT_CONFIG_INVALID",
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new PaymentRequiredError("Fetch is unavailable.");

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {accept: "application/json"},
      signal: controller.signal,
    });
    const issues: GuardIssue[] = [];

    if (response.status !== 402) {
      issues.push({code: "HTTP_STATUS_NOT_402", message: `Expected HTTP 402, received ${response.status}.`});
    }

    const header = paymentRequiredHeader(response.headers);

    if (!header) {
      issues.push({code: "PAYMENT_REQUIRED_MISSING", message: "PAYMENT-REQUIRED response header is missing."});
      return {
        url: url.toString(),
        status: response.status,
        valid: false,
        paymentRequired: null,
        stellarRequirements: [],
        issues,
      };
    }

    try {
      const paymentRequired = parsePaymentRequired(header);
      const stellarRequirements = paymentRequired.accepts.filter((requirement) => (
        requirement.scheme === "exact" && isStellarX402Network(requirement.network)
      ));

      if (new URL(paymentRequired.resource.url).toString() !== url.toString()) {
        issues.push({code: "RESOURCE_URL_MISMATCH", message: "Declared resource URL does not match the inspected URL."});
      }

      if (stellarRequirements.length === 0) {
        issues.push({code: "STELLAR_REQUIREMENT_MISSING", message: "No Stellar exact requirement was declared."});
      }

      return {
        url: url.toString(),
        status: response.status,
        valid: issues.length === 0,
        paymentRequired,
        stellarRequirements,
        issues,
      };
    }
    catch (error) {
      issues.push({
        code: error instanceof PaymentRequiredError ? error.code : "PAYMENT_REQUIRED_INVALID",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        url: url.toString(),
        status: response.status,
        valid: false,
        paymentRequired: null,
        stellarRequirements: [],
        issues,
      };
    }
  }
  finally {
    globalThis.clearTimeout(timeout);
  }
};
