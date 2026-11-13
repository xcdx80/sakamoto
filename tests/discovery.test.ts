import { connectedOwner } from "./provider-fixtures";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { pool, setupPostgres } from "./postgres";
import { shelveForUser } from "../lib/db";
import { searchEvidence } from "../lib/retrieval";
import { importBookmarks } from "../lib/bookmarks";
import { configureProcessing, processLibrary } from "../lib/processing";

before(setupPostgres);
after(() => pool.end());

async function save(owner: string, id: string, title: string, text: string[]) {
  await shelveForUser(owner, { id, title, contentType: "article" }, {
    id, title, sourceUrl: `https://example.com/${id}`,
    blocks: text.map((text, index) => ({ id: `b${index}`, type: "p", runs: [{ text }] })),
  });
}

test("a natural-language topic query discovers relevant reading before semantic indexing completes", async () => {
  await save("discovery-reader", "expo-controls", "Native component cookbook", [
    "Expo renders native controls. Compose SwiftUI layouts for iOS.",
  ]);
  await save("discovery-reader", "generic-ui", "Web interface", [
    "Building a UI with browser elements and CSS.",
  ]);
  const result = await searchEvidence(await connectedOwner("discovery-reader"), {
    query: "building UI with Expo", semantic: false,
  }, undefined, "discovery");
  assert.ok(result.results.some(source => source.itemId === "expo-controls"));
  assert.deepEqual(result.coverage, { sources: 2, indexedSources: 0 });
});

test("source titles describe passages even when the paragraph uses different wording", async () => {
  await save("title-reader", "evaluation-guide", "Eval design for assistants", [
    "Define failure classes, label representative examples, and reserve a held-out set.",
  ]);
  const result = await searchEvidence(await connectedOwner("title-reader"), { query: "eval design", semantic: false }, undefined, "discovery");
  assert.equal(result.results[0]?.itemId, "evaluation-guide");
});

test("topic results leave room for different sources instead of filling the answer with one article", async () => {
  await save("diverse-reader", "long-guide", "Agentic design", Array.from({ length: 12 }, (_, i) =>
    `Agentic design practices: validate each transition and record the result of step ${i}.`));
  await save("diverse-reader", "second-guide", "Recovery", [
    "Agentic workflows need design that makes retries visible and reversible.",
  ]);
  const result = await searchEvidence(await connectedOwner("diverse-reader"), {
    query: "agentic design best practices", semantic: false, limit: 4,
  }, undefined, "discovery");
  assert.ok(result.results.some(source => source.itemId === "second-guide"));
  assert.ok(result.results.filter(source => source.itemId === "long-guide").length <= 2);
});

test("a matching saved post brings its linked article into discovery without bypassing content filters", async () => {
  await importBookmarks("linked-reader", { posts: [{
    postId: "876543210", url: "https://x.com/writer/status/876543210",
    text: "Expo iOS component guide", author: { name: "Writer", handle: "writer" },
    observedAt: "2026-10-18T12:00:00Z", links: ["https://example.com/controls"],
  }] }, "Fixture");
  configureProcessing({ fetchArticle: async () => ({ ok: true, article: {
    id: "linked-controls", title: "Control catalogue", contentType: "article", sourceUrl: "https://example.com/controls",
    blocks: [{ id: "buttons", type: "p", runs: [{ text: "Use SwiftUI buttons and menus. Configure control state through bindings." }] }],
  } }) });
  try { await processLibrary(await connectedOwner("linked-reader"), { limit: 1 }); }
  finally { configureProcessing({}); }
  const found = await searchEvidence(await connectedOwner("linked-reader"), { query: "Expo", semantic: false }, undefined, "discovery");
  assert.ok(found.results.some(source => source.itemId === "linked-controls"));
  const posts = await searchEvidence(await connectedOwner("linked-reader"), { query: "Expo", contentType: "post", semantic: false }, undefined, "discovery");
  assert.ok(posts.results.every(source => source.contentType === "post"));
});

test("covering the question's concepts ranks ahead of repeating one generic word", async () => {
  await save("coverage-reader", "a-generic", "Expert advice advice advice advice advice", ["Advice advice advice advice advice advice advice advice."]);
  await save("coverage-reader", "z-career", "Career advice", ["Choose roles with scope for mentorship and growth."]);
  const result = await searchEvidence(await connectedOwner("coverage-reader"), { query: "career advice", semantic: false }, undefined, "discovery");
  assert.equal(result.results[0]?.itemId, "z-career");
});

test("a matching post promotes its linked article even when a weak semantic match is already ranked", async () => {
  const original = globalThis.fetch;
  process.env.GOOGLE_API_KEY = "fixture-google";
  for (let index = 0; index < 4; index++)
    await save("linked-reader", `distractor-${index}`, "Other reading", [`Unrelated distant passage ${index}.`]);
  globalThis.fetch = async (_url, init) => {
    const text = JSON.parse(String(init?.body)).content.parts[0].text as string;
    const vector = text.includes("Control catalogue") ? [0, 1]
      : text.includes("Unrelated distant") ? [0.9, 0.1] : [1, 0];
    return Response.json({ embedding: { values: [...vector, ...Array(766).fill(0)] }, usageMetadata: { promptTokenCount: 20 } });
  };
  try {
    await processLibrary(await connectedOwner("linked-reader"), { limit: 12 });
    const found = await searchEvidence(await connectedOwner("linked-reader"), { query: "Expo", limit: 3 }, undefined, "discovery");
    assert.equal(found.mode, "hybrid");
    assert.ok(found.results.some(source => source.itemId === "linked-controls"));
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_API_KEY;
  }
});

test("quoted wording search does not expand into linked text without the requested phrase", async () => {
  const found = await searchEvidence(await connectedOwner("linked-reader"), { query: '"Expo iOS"', semantic: false }, undefined, "discovery");
  assert.ok(found.results.length > 0);
  assert.ok(found.results.every(source => source.excerpt.includes("Expo iOS") || source.title.includes("Expo iOS")));
});
