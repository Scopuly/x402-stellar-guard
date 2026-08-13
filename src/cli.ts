#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import process from "node:process";

import {runGuardConformance} from "./conformance/guard-suite.js";
import {inspectX402Endpoint} from "./inspect.js";
import {guardPaymentRequired, parsePaymentRequired} from "./payment-required.js";
import {createDefaultGuardPolicy} from "./policy.js";

const packageMetadata: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const VERSION = (
  packageMetadata
  && typeof packageMetadata === "object"
  && typeof (packageMetadata as {version?: unknown}).version === "string"
) ? (packageMetadata as {version: string}).version : "unknown";

const usage = `x402-stellar-guard ${VERSION}

Usage:
  x402-stellar-guard conformance [--json]
  x402-stellar-guard inspect <https-url> [--json]
  x402-stellar-guard decode <header-or-file> [--json]
  x402-stellar-guard validate <header-or-file> --origin <https-origin> --request-url <https-url> --payer <G...|C...> [--network stellar:testnet|stellar:pubnet] [--allow-mainnet-origin <https-origin>] [--json]

The CLI never signs or settles a payment. Wallet signing conformance is available through the library API.`;

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const loadInput = async (value: string): Promise<string> => {
  try {
    const stats = await readFile(value, "utf8");
    return stats.trim();
  }
  catch {
    return value;
  }
};

const print = (value: unknown, json: boolean): void => {
  process.stdout.write(`${JSON.stringify(value, null, json ? undefined : 2)}\n`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];
  const json = args.includes("--json");

  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(`${usage}\n`);
    return;
  }

  if (["--version", "-v", "version"].includes(command)) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (command === "conformance") {
    const report = runGuardConformance();
    print(report, json);
    if (!report.passed) process.exitCode = 1;
    return;
  }

  const input = args[1];

  if (!input) throw new Error(`Missing input.\n\n${usage}`);

  if (command === "inspect") {
    const report = await inspectX402Endpoint(input);
    print(report, json);
    if (!report.valid) process.exitCode = 1;
    return;
  }

  const payload = await loadInput(input);

  if (command === "decode") {
    print(parsePaymentRequired(payload), json);
    return;
  }

  if (command === "validate") {
    const origin = option(args, "--origin");
    const requestUrl = option(args, "--request-url");
    const payer = option(args, "--payer");
    const network = option(args, "--network");
    const mainnetOrigin = option(args, "--allow-mainnet-origin");

    if (!origin || !requestUrl || !payer) {
      throw new Error("--origin, --request-url, and --payer are required.");
    }
    if (network && !["stellar:testnet", "stellar:pubnet"].includes(network)) {
      throw new Error("--network must be stellar:testnet or stellar:pubnet.");
    }

    const policy = createDefaultGuardPolicy({
      pubnetEnabled: Boolean(mainnetOrigin),
      allowedOrigins: mainnetOrigin ? [mainnetOrigin] : [],
    });
    const intent = guardPaymentRequired(payload, {
      origin,
      requestUrl,
      payer,
      ...(network ? {network: network as "stellar:testnet" | "stellar:pubnet"} : {}),
    }, {policy});
    print(intent, json);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage}`);
};

try {
  await main();
}
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
