import { test } from "node:test";
import assert from "node:assert/strict";
import { usageMicros } from "../lib/paid-work";

test("post review usage uses the qualified Sol price while reader usage keeps its existing price", () => {
  assert.equal(usageMicros("gpt-6-sol", { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 100 }), 3820);
  assert.equal(usageMicros("gpt-6-luna", { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 100 }), 191);
});

test("review pricing rejects usage outside its qualified context envelope", () => {
  assert.throws(() => usageMicros("gpt-6-sol", { inputTokens: 64001, outputTokens: 1 }), /authorized bound/);
});
