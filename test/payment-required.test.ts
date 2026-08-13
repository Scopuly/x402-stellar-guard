import assert from "node:assert/strict";
import test from "node:test";

import {STELLAR_USDC_ASSETS} from "../src/constants.js";
import {guardPaymentRequired, parsePaymentRequired} from "../src/payment-required.js";
import {createDefaultGuardPolicy} from "../src/policy.js";
import {PAYER, paymentRequired} from "./helpers.js";

test("parses x402 v2 PAYMENT-REQUIRED from URL-safe base64", () => {
  const header = Buffer.from(JSON.stringify(paymentRequired())).toString("base64url");
  const parsed = parsePaymentRequired(header);

  assert.equal(parsed.x402Version, 2);
  assert.equal(parsed.accepts[0]?.network, "stellar:testnet");
});

test("rejects Base64 payloads containing invalid UTF-8", () => {
  const json = JSON.stringify(paymentRequired());
  const marker = "Protected data";
  const markerOffset = json.indexOf(marker);
  const bytes = Buffer.concat([
    Buffer.from(json.slice(0, markerOffset), "utf8"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(json.slice(markerOffset + marker.length), "utf8"),
  ]);

  assert.throws(
    () => parsePaymentRequired(bytes.toString("base64")),
    (error: unknown) => (error as {code?: string}).code === "X402_PAYMENT_REQUIRED_BASE64_INVALID",
  );
});

test("preserves current x402 v2 resource metadata with strict field types", () => {
  const base = paymentRequired();
  const payload = {
    ...base,
    error: "Payment is required",
    resource: {
      ...base.resource,
      mimeType: "application/json",
      serviceName: "Scopuly API",
      tags: ["stellar", "x402"],
      iconUrl: "https://merchant.example/icon.png",
    },
  };
  const parsed = parsePaymentRequired(payload);

  assert.equal(parsed.error, "Payment is required");
  assert.equal(parsed.resource.serviceName, "Scopuly API");
  assert.deepEqual(parsed.resource.tags, ["stellar", "x402"]);
  assert.equal(parsed.resource.iconUrl, "https://merchant.example/icon.png");

  assert.throws(() => parsePaymentRequired({...payload, x402Version: "2"}));
  assert.throws(() => parsePaymentRequired(paymentRequired({amount: 10_000})));
  assert.throws(() => parsePaymentRequired({...payload, resource: {...payload.resource, tags: ["a", "b", "c", "d", "e", "f"]}}));
});

test("rejects excessively deep PAYMENT-REQUIRED JSON", () => {
  let metadata: Record<string, unknown> = {};
  for (let depth = 0; depth < 40; depth += 1) metadata = {nested: metadata};

  assert.throws(
    () => parsePaymentRequired(paymentRequired({extra: {areFeesSponsored: true, metadata}})),
    (error: unknown) => (error as {code?: string}).code === "X402_PAYMENT_REQUIRED_SIZE_INVALID",
  );
});

test("freezes and fingerprints a bounded sponsored Testnet requirement", () => {
  const intent = guardPaymentRequired(paymentRequired(), {
    origin: "https://merchant.example",
    requestUrl: "https://merchant.example/data",
    payer: PAYER,
    network: "stellar:testnet",
  });

  assert.equal(intent.amountDisplay, "0.001");
  assert.match(intent.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(Object.isFrozen(intent.requirement), true);
});

test("deep-freezes requirement metadata used by the payment fingerprint", () => {
  const intent = guardPaymentRequired(paymentRequired({
    extra: {areFeesSponsored: true, metadata: {source: "merchant"}},
  }), {
    origin: "https://merchant.example",
    payer: PAYER,
  });

  assert.equal(Object.isFrozen(intent.requirement.extra), true);
  assert.equal(Object.isFrozen(intent.requirement.extra?.metadata as object), true);
});

test("rejects origin mismatch, unsponsored fees, and disallowed assets", () => {
  assert.throws(
    () => guardPaymentRequired(paymentRequired(), {origin: "https://evil.example", payer: PAYER}),
    (error: unknown) => (error as {code?: string}).code === "X402_RESOURCE_ORIGIN_MISMATCH",
  );
  assert.throws(
    () => guardPaymentRequired(paymentRequired({extra: {areFeesSponsored: false}}), {
      origin: "https://merchant.example",
      payer: PAYER,
    }),
    (error: unknown) => (error as {code?: string}).code === "X402_FEES_NOT_SPONSORED",
  );
  assert.throws(
    () => guardPaymentRequired(paymentRequired({
      asset: STELLAR_USDC_ASSETS["stellar:pubnet"].contract,
    }), {origin: "https://merchant.example", payer: PAYER}),
    (error: unknown) => (error as {code?: string}).code === "X402_ASSET_BLOCKED",
  );
});

test("Mainnet is fail-closed until explicitly enabled for one origin", () => {
  const mainnet = paymentRequired({
    network: "stellar:pubnet",
    asset: STELLAR_USDC_ASSETS["stellar:pubnet"].contract,
  });

  assert.throws(
    () => guardPaymentRequired(mainnet, {origin: "https://merchant.example", payer: PAYER}),
    (error: unknown) => (error as {code?: string}).code === "X402_NETWORK_DISABLED",
  );

  const policy = createDefaultGuardPolicy({
    pubnetEnabled: true,
    allowedOrigins: ["https://merchant.example"],
  });
  const intent = guardPaymentRequired(mainnet, {
    origin: "https://merchant.example",
    payer: PAYER,
    network: "stellar:pubnet",
  }, {policy});

  assert.equal(intent.network, "stellar:pubnet");
});
