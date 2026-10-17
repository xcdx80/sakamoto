import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as speak } from "../app/api/speak/route";
import { POST as covers } from "../app/api/covers/route";
import { POST as page } from "../app/api/pdf-page/route";
import { POST as careful } from "../app/api/pdf-careful/route";
import { POST as key, GET as keyStatus } from "../app/api/key/route";
test("retired optional endpoints explicitly refuse new work without credentials, providers or budget storage", async () => {
  delete process.env.TOGETHER_API_KEY;
  delete process.env.LLAMA_CLOUD_API_KEY;
  delete process.env.DATABASE_URL;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Retired features must not dispatch");
  };
  try {
    for (const handler of [speak, covers, page, careful, key, keyStatus]) {
      const response = await handler(
        new Request("http://localhost/api/retired", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            apiKey: "stale-browser-key",
            text: "Saved source",
            image: "data:image/png;base64,AAAA",
            id: "item",
            topic: "science",
            scene: "scene",
          }),
        }),
      );
      assert.equal(response.status, 410);
      const body = await response.json();
      assert.equal(body.code, "feature_unavailable");
      assert.doesNotMatch(JSON.stringify(body), /need_key|Add your.*key/i);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
