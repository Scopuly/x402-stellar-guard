import assert from "node:assert/strict";
import test from "node:test";

import {ApprovalTokenStore} from "../src/approval.js";
import {
  createDefaultGuardPolicy,
  loadRestrictedGuardPolicy,
  restrictGuardPolicy,
} from "../src/policy.js";

test("remote policy can restrict but cannot increase built-in limits", () => {
  const base = createDefaultGuardPolicy({pubnetEnabled: true});
  const restricted = structuredClone(base);
  restricted.networks["stellar:pubnet"].maxPaymentAtomic = "10000";
  assert.equal(restrictGuardPolicy(restricted, base).networks["stellar:pubnet"].maxPaymentAtomic, "10000");

  const unsafe = structuredClone(base);
  unsafe.networks["stellar:pubnet"].maxPaymentAtomic = "10000001";
  assert.throws(
    () => restrictGuardPolicy(unsafe, base),
    (error: unknown) => (error as {code?: string}).code === "X402_POLICY_LIMIT_INCREASE",
  );
});

test("remote policy cannot enable networks, origins, or spoof asset metadata", () => {
  const base = createDefaultGuardPolicy();
  const expansion = structuredClone(base);
  expansion.networks["stellar:pubnet"].enabled = true;
  expansion.allowedOrigins = ["https://evil.example"];

  const restricted = restrictGuardPolicy(expansion, base);
  assert.equal(restricted.networks["stellar:pubnet"].enabled, false);
  assert.deepEqual(restricted.allowedOrigins, []);

  const spoofed = structuredClone(base);
  spoofed.networks["stellar:testnet"].assets[0]!.name = "Fake USD";
  assert.throws(
    () => restrictGuardPolicy(spoofed, base),
    (error: unknown) => (error as {code?: string}).code === "X402_POLICY_ASSET_NOT_BUILT_IN",
  );
});

test("approval tokens are fingerprint-bound, expiring, and one-shot", () => {
  const store = new ApprovalTokenStore({
    ttlMs: 1_000,
    randomBytes: () => new Uint8Array(24).fill(7),
  });
  const fingerprint = "a".repeat(64);
  const token = store.issue(fingerprint, 100);

  assert.equal(store.consume(token, "b".repeat(64), 200), false);
  assert.equal(store.consume(token, fingerprint, 200), true);
  assert.equal(store.consume(token, fingerprint, 200), false);
});

test("loads a bounded remote policy and intersects it with the trusted base", async () => {
  const base = createDefaultGuardPolicy({
    pubnetEnabled: true,
    allowedOrigins: ["https://merchant.example"],
  });
  const candidate = structuredClone(base);
  candidate.networks["stellar:pubnet"].maxPaymentAtomic = "10000";
  candidate.allowedOrigins.push("https://evil.example");
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({policy: candidate}), {
    status: 200,
    headers: {"content-type": "application/json"},
  });

  const policy = await loadRestrictedGuardPolicy("https://policy.example/x402.json", {basePolicy: base, fetchImpl});
  assert.equal(policy.networks["stellar:pubnet"].maxPaymentAtomic, "10000");
  assert.deepEqual(policy.allowedOrigins, ["https://merchant.example"]);
});

test("remote policy loader rejects unsafe URLs and oversized responses", async () => {
  await assert.rejects(
    loadRestrictedGuardPolicy("http://policy.example/x402.json"),
    (error: unknown) => (error as {code?: string}).code === "X402_POLICY_URL_INVALID",
  );

  const fetchImpl: typeof fetch = async () => new Response("{}", {
    status: 200,
    headers: {"content-length": String(129 * 1_024)},
  });
  await assert.rejects(
    loadRestrictedGuardPolicy("https://policy.example/x402.json", {fetchImpl}),
    (error: unknown) => (error as {code?: string}).code === "X402_POLICY_UNAVAILABLE",
  );
});
