import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { configureDatabase } from "../lib/db";
import { loadCatalog, summarizeCatalog } from "../lib/post-production/catalog";
import { defaultProfile, normalizeDraftContent } from "../lib/post-production/profile";
import { configurePostProviders, POST_PROMPT_VERSION, reviewPost, writePost, type PostProviderContext } from "../lib/post-production/providers";
import type { DraftContent, DraftReview } from "../lib/post-production/types";

afterEach(() => configurePostProviders({}));

const catalog = loadCatalog();
const entry = summarizeCatalog(catalog).frameworks.find(item => item.id === "single-paragraph-insight")!;
const context: PostProviderContext = {
  owner: "review-limits", operationId: "post:review-limits", attemptId: "isolated-fixture", profile: defaultProfile(),
  brief: { idea: "A proposed engineering inspection", notes: "", audience: "Engineers", goal: "trust", pillar: "engineering", platforms: ["x"], delivery: "long", sourceIds: [] },
  evidence: [],
  framework: { frameworkId: entry.id, name: entry.name, family: entry.family, score: 1, reasons: [], outline: entry.outline, hookPatternIds: entry.hookPatternIds, warnings: [] },
};

function draft(text: string): DraftContent {
  return { variants: [{ platform: "x", delivery: "long", posts: [text] }], hooks: [], claimSources: [] };
}

function proposalReview(): DraftReview {
  return {
    status: "passed", issues: [], writerModel: "author", reviewerModel: "gpt-6-sol", hookFactualAssessment: [], nonfactualSupport: [],
    factualAssessment: [{ platform: "x", hasFactualClaims: false, rationale: "The complete saved draft proposes an engineering inspection without asserting a reported event or demonstrated result.", factualClaims: [] }],
    criteria: [...catalog.shared.criteria, ...catalog.frameworks.find(item => item.id === entry.id)!.rubric.criteria].map(criterion => ({
      id: criterion.id, score: 5, reason: "The complete saved wording is an explicit proposed inspection, with no factual assertion requiring invented source evidence.", evidenceIds: [], support: [],
    })),
  };
}

test("a saved author X long post beyond the writer output limit reaches independent review unchanged", async () => {
  for (const length of [15001, 25000]) {
    const content = normalizeDraftContent(draft("I would inspect the release decision. ".repeat(700).slice(0, length - 1) + "."));
    const expected = structuredClone(content);
    configurePostProviders({ reviewPost: async (_context, saved, writerModel) => {
      assert.equal(writerModel, "author");
      assert.deepEqual(saved, expected);
      return proposalReview();
    } });
    assert.equal(content.variants[0].posts[0].length, length);
    assert.equal((await reviewPost(context, content, "author")).status, "passed");
    assert.deepEqual(content, expected);
  }
});

test("writer output retains its 15000-character limit without truncating a rejected draft", async () => {
  for (const length of [15000, 15001]) {
    const content = draft("a".repeat(length));
    configurePostProviders({ writePost: async () => ({ content, model: "gpt-6-luna", promptVersion: POST_PROMPT_VERSION }) });
    if (length === 15000) assert.deepEqual((await writePost(context, context.framework!)).content, content);
    else await assert.rejects(writePost(context, context.framework!), { code: "invalid_response" });
    assert.equal(content.variants[0].posts[0].length, length);
  }
});

test("saved drafts exceeding their platform limits are rejected before independent review", async () => {
  configurePostProviders({ reviewPost: async () => assert.fail("An oversized draft must not reach the review provider.") });
  for (const [platform, delivery, length] of [["x", "long", 25001], ["x", "single", 281], ["linkedin", "long", 3001]] as const) {
    const content = normalizeDraftContent({ variants: [{ platform, delivery, posts: ["a".repeat(length)] }], hooks: [], claimSources: [] });
    const ctx = { ...context, brief: { ...context.brief, platforms: [platform], delivery } };
    await assert.rejects(reviewPost(ctx, content, "author"), { code: "invalid_response" });
    assert.equal(content.variants[0].posts[0].length, length);
  }
});

test("a character-valid saved draft still obeys the bounded provider input before any paid dispatch", async () => {
  const content = normalizeDraftContent(draft("界".repeat(25000)));
  const originalFetch = globalThis.fetch;
  const fixtureEnv = { OPENAI_API_KEY: "review-limit-fixture", TYPESAFE_API_KEY: "review-limit-fixture", SAKAMOTO_POST_WRITER_MODEL: "gpt-6-luna", SAKAMOTO_POST_REVIEWER_MODEL: "gpt-6-sol", TYPESAFE_MODEL: "jev-latest" };
  const prior = Object.fromEntries(Object.keys(fixtureEnv).map(name => [name, process.env[name]]));
  Object.assign(process.env, fixtureEnv);
  configureDatabase({ query: async () => assert.fail("Oversized review input must be rejected before paid accounting.") });
  globalThis.fetch = async () => assert.fail("Oversized review input must be rejected before provider dispatch.");
  try {
    await assert.rejects(reviewPost(context, content, "author"), { code: "input_too_large" });
    assert.equal(content.variants[0].posts[0].length, 25000);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
