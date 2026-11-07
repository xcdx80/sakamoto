import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getPublishingCapability, submitApprovedProduction } from "../lib/post-production/publishing";
import type { DraftContent } from "../lib/post-production/types";

const originalFetch = globalThis.fetch;
const keys = ["POSTIZ_API_KEY", "POSTIZ_OWNER_ID", "POSTIZ_BASE_URL", "POSTIZ_X_INTEGRATION_ID", "POSTIZ_LINKEDIN_INTEGRATION_ID"] as const;
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function configure() {
  for (const key of keys) delete process.env[key];
  process.env.POSTIZ_API_KEY = "fixture-private-key";
  process.env.POSTIZ_OWNER_ID = "publishing-owner";
  process.env.POSTIZ_X_INTEGRATION_ID = "x-integration";
}
const content: DraftContent = {
  variants: [{ platform: "x", delivery: "thread", posts: ["First exact approved post.", "Second exact approved post."] }],
  hooks: [], claimSources: [],
};

test("publishing is unavailable without owner-bound configuration and never exposes connector credentials", async () => {
  configure();
  const capability = getPublishingCapability("other-owner");
  assert.equal(capability.ready, false);
  assert.deepEqual(capability.platforms, []);
  assert.ok(!JSON.stringify(capability).includes("fixture-private-key"));
  globalThis.fetch = async () => { throw new Error("Unconfigured publishing must not perform I/O"); };
  await assert.rejects(submitApprovedProduction("other-owner", { revisionId: "approved-1", content }), { code: "connection_required" });
  delete process.env.POSTIZ_OWNER_ID;
  assert.equal(getPublishingCapability("publishing-owner").ready, false);
});

test("an approved X thread and LinkedIn adaptation submit exact wording once to their verified channels", async () => {
  configure();
  process.env.POSTIZ_LINKEDIN_INTEGRATION_ID = "linkedin-integration";
  const adapted: DraftContent = { ...content, variants: [...content.variants, { platform: "linkedin", delivery: "long", posts: ["The exact LinkedIn adaptation.\n\nWith its approved spacing."] }] };
  const requests: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "fixture-private-key");
    assert.equal(init?.redirect, "error");
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method !== "POST") return Response.json([
      { id: "x-integration", identifier: "x", disabled: false },
      { id: "linkedin-integration", identifier: "linkedin", disabled: false },
    ]);
    return Response.json([{ postId: "x-post", integration: "x-integration" }, { postId: "linkedin-post", integration: "linkedin-integration" }]);
  };
  assert.deepEqual(getPublishingCapability("publishing-owner"), { provider: "postiz", ready: true, platforms: ["x", "linkedin"], notice: null });
  const result = await submitApprovedProduction("publishing-owner", { revisionId: "approved-1", content: adapted });
  assert.deepEqual(result, { provider: "postiz", status: "submitted", posts: [
    { platform: "x", postId: "x-post", integrationId: "x-integration" },
    { platform: "linkedin", postId: "linkedin-post", integrationId: "linkedin-integration" },
  ] });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], { url: "https://api.postiz.com/public/v1/integrations", method: "GET", body: null });
  const body = requests[1].body as Record<string, unknown>;
  assert.equal(requests[1].url, "https://api.postiz.com/public/v1/posts");
  assert.equal(requests[1].method, "POST");
  assert.equal(body.type, "now");
  assert.ok(!Number.isNaN(Date.parse(String(body.date))));
  assert.deepEqual(body.posts, [
    { integration: { id: "x-integration" }, value: [{ content: "First exact approved post.", image: [] }, { content: "Second exact approved post.", image: [] }], settings: { __type: "x", who_can_reply_post: "everyone" } },
    { integration: { id: "linkedin-integration" }, value: [{ content: "The exact LinkedIn adaptation.\n\nWith its approved spacing.", image: [] }], settings: { __type: "linkedin" } },
  ]);
});

test("publishing refuses an invalid LinkedIn thread before contacting a provider", async () => {
  configure();
  process.env.POSTIZ_LINKEDIN_INTEGRATION_ID = "linkedin-integration";
  globalThis.fetch = async () => { throw new Error("Invalid draft must not perform I/O"); };
  const invalid: DraftContent = { ...content, variants: [{ platform: "linkedin", delivery: "thread", posts: ["Main post", "Unapproved first comment"] }] };
  await assert.rejects(submitApprovedProduction("publishing-owner", { revisionId: "approved-1", content: invalid }), { code: "invalid_request" });
});

test("disabled, missing and mismatched Postiz channels never receive a post", async () => {
  configure();
  for (const channels of [[], [{ id: "x-integration", identifier: "x", disabled: true }], [{ id: "x-integration", identifier: "linkedin", disabled: false }]]) {
    let posts = 0;
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") posts++;
      return Response.json(channels);
    };
    await assert.rejects(submitApprovedProduction("publishing-owner", { revisionId: "approved-1", content }), { code: "connection_required" });
    assert.equal(posts, 0);
  }
});

test("interrupted, rejected and incomplete submissions stay uncertain and are never automatically retried", async () => {
  configure();
  const outcomes = [
    async () => { throw new Error("socket interrupted with fixture-private-key in its message"); },
    async () => Response.json({ error: "fixture-private-key" }, { status: 500 }),
    async () => Response.json([]),
    async () => Response.json([{ postId: "unknown-post", integration: "someone-else" }]),
    async () => new Response("x".repeat(65 * 1024)),
  ];
  for (const outcome of outcomes) {
    let posts = 0;
    globalThis.fetch = async (_url, init) => {
      if (init?.method !== "POST") return Response.json([{ id: "x-integration", identifier: "x", disabled: false }]);
      posts++;
      return outcome();
    };
    await assert.rejects(submitApprovedProduction("publishing-owner", { revisionId: "approved-1", content }), error => {
      assert.equal((error as { code: string }).code, "submission_uncertain");
      assert.ok(!String(error).includes("fixture-private-key"));
      return true;
    });
    assert.equal(posts, 1);
  }
});

test("invalid or insecure custom Postiz URLs disable publishing before credentials leave the server", async () => {
  configure();
  for (const base of ["http://postiz.example/public/v1", "https://user:password@postiz.example/public/v1", "https://postiz.example/public/v1?key=unsafe", "not a URL"]) {
    process.env.POSTIZ_BASE_URL = base;
    assert.equal(getPublishingCapability("publishing-owner").ready, false);
  }
});
