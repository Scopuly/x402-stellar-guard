import assert from "node:assert/strict";
import test from "node:test";

import {formatAtomicAmount} from "../src/utils.js";

test("formats bounded signed i128 values", () => {
  assert.equal(formatAtomicAmount("10000001", 7), "1.0000001");
  assert.equal(formatAtomicAmount("-100", 2), "-1");
  assert.equal(formatAtomicAmount("0", 7), "0");
});

test("rejects unsafe amount formatting inputs", () => {
  assert.throws(() => formatAtomicAmount("01", 7));
  assert.throws(() => formatAtomicAmount("1", 1_000_000));
  assert.throws(() => formatAtomicAmount((1n << 127n).toString(), 7));
});
