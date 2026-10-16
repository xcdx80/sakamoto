import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { createToken } from "../lib/db";
import { makeToken } from "../lib/agent";
import { handle } from "../lib/mcp";
import { configureArticleFetch } from "../lib/fetch-article";
import { textPdf } from "./pdf-fixtures";
const originalFetch = globalThis.fetch;
let token = "";
before(async () => {
  await setupPostgres();
  delete process.env.GOOGLE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  process.env.OPENAI_API_KEY = "fixture-openai";
  process.env.DATABASE_URL = "test-adapter-only";
  const identity = makeToken();
  token = identity.token;
  await createToken(
    "pdf-answer",
    identity.id,
    identity.hash,
    "PDF answer fixture",
  );
});
after(async () => {
  configureArticleFetch({});
  globalThis.fetch = originalFetch;
  await pool.end();
});
async function call(name: string, args: unknown) {
  const response = await handle(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}
test("a real linked partial PDF answers through MCP with saved document type, physical page and extraction coverage", async () => {
  configureArticleFetch({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () =>
      new Response(
        textPdf([
          "Lensing calibration compares the image against a reference star.",
          "",
        ]),
        { headers: { "content-type": "application/pdf" } },
      ),
  });
  await call("save_bookmarks", {
    posts: [
      {
        postId: "908901",
        url: "https://x.com/observer/status/908901",
        text: "A linked optics paper.",
        author: { name: "Observer", handle: "observer" },
        observedAt: "2026-10-16T12:00:00Z",
        links: ["https://public.example/lensing.pdf"],
      },
    ],
  });
  const processed = await call("process_library", { limit: 4 });
  const itemId = processed.jobs.find(
    (job: any) => job.kind === "link",
  ).resultItemId;
  assert.ok(itemId);
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const context = JSON.parse(
      JSON.parse(String(init?.body)).messages[1].content,
    );
    assert.equal(context.evidence[0].contentType, "document");
    assert.equal(context.evidence[0].address.page, 1);
    assert.equal(context.evidence[0].coverage.status, "partial");
    assert.deepEqual(context.evidence[0].coverage.parsedPages, [1]);
    const answer = {
      status: "partial",
      claims: [
        {
          text: "The retained page compares the image against a reference star.",
          citations: ["E1"],
        },
      ],
      gaps: ["The second physical page has no retained text."],
    };
    return new Response(
      [
        {
          choices: [
            {
              delta: { content: JSON.stringify(answer) },
              finish_reason: "stop",
            },
          ],
        },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } },
      ]
        .map((frame) => "data: " + JSON.stringify(frame) + "\n\n")
        .join("") + "data: [DONE]\n\n",
    );
  };
  const answer = await call("ask_library", {
    query: "Lensing calibration",
    contentType: "document",
    semantic: false,
  });
  assert.equal(answer.status, "partial");
  const citation = answer.citations[0];
  assert.equal(citation.itemId, itemId);
  assert.equal(citation.contentType, "document");
  assert.equal(citation.sourceRevision, 1);
  assert.equal(citation.address.blockId, "p1-text");
  assert.equal(citation.address.page, 1);
  assert.equal(citation.originalUrl, "https://public.example/lensing.pdf");
  assert.match(citation.readUrl, /passage=p1-text&revision=1$/);
  assert.equal(citation.coverage.status, "partial");
  assert.equal(citation.coverage.totalPages, 2);
  assert.deepEqual(citation.coverage.parsedPages, [1]);
  assert.deepEqual(citation.coverage.missingPages, [2]);
});
