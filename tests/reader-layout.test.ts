import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { ThreadPost } from "../lib/threads";

function entry(id: string, role: ThreadPost["role"] = "bookmark"): ThreadPost {
  return { postId: id, itemId: "item-" + id, role, sourceRevision: 1, savedUrl: "/read/item-" + id + "?revision=1", post: {
    postId: id, url: "https://x.com/alice/status/" + id, fullText: "Other original source " + id,
    author: { name: "Alice", handle: "alice" }, observedAt: "2026-10-17T10:00:00Z", links: [],
    completeness: { status: "complete", verification: "agent_reported" }, provenance: { via: "Fixture", receivedAt: "2026-10-17T10:00:00Z" },
  }, relationships: [] };
}

test("the saved text has a named reading region and heading without changing its paragraph address or characters", async () => {
  const { SourceText } = await import("../components/reader/SourceText");
  for (const [contentType, label] of [["post", "Saved post"], ["article", "Article text"], ["document", "Document text"]] as const) {
    const text = '  Exact source 🐈\n"Keep this line."  ';
    const html = renderToStaticMarkup(createElement(SourceText, { contentType, children: createElement("div", { className: "prose-read" }, createElement("p", { "data-block": "original-paragraph" }, text)) }));
    const { document } = parseHTML(html);
    const region = document.querySelector('[aria-labelledby="saved-text-heading"]')!;
    assert.ok(region);
    assert.equal(region.querySelector("h2")!.textContent, label);
    assert.equal(region.querySelector('[data-block="original-paragraph"]')!.textContent, text);
    assert.equal(document.querySelectorAll('[data-block="original-paragraph"]').length, 1);
  }
});

test("loading or unavailable thread context never hides the saved text behind a large status section", async () => {
  const { ThreadContext } = await import("../components/reader/ThreadReading");
  for (const status of ["loading", "unavailable", "signed_out"] as const) {
    const html = renderToStaticMarkup(createElement(ThreadContext, { itemId: "source", thread: null, status, onRefresh() {}, children: createElement("p", { "data-block": "original" }, "Saved text remains readable.") }));
    const { document } = parseHTML(html);
    assert.equal(document.querySelector('[data-block="original"]')!.textContent, "Saved text remains readable.");
    assert.equal(document.querySelectorAll('details').length, 0);
    assert.equal(document.querySelector('[aria-label="About author-thread context"]')!.getAttribute("aria-expanded"), "false");
    assert.equal(document.querySelector('[role="dialog"]'), null);
  }
});

test("the current post is first and appears once while ordered thread context and diagnostics start collapsed", async () => {
  const { ThreadContext } = await import("../components/reader/ThreadReading");
  const thread = { posts: [entry("101"), entry("102")], context: [], gaps: [{ kind: "missing" as const, postId: "100", reason: "Parent not supplied." }], ordering: "reply" as const, conversationComplete: false as const };
  const html = renderToStaticMarkup(createElement(ThreadContext, { itemId: "item-102", thread, status: "ready", onRefresh() {}, children: createElement("p", { "data-block": "selected-source" }, "The exact selected post.") }));
  const { document } = parseHTML(html);
  assert.equal(document.querySelectorAll('[data-block="selected-source"]').length, 1);
  const details = document.querySelector('details[aria-label="Author thread and context"]')!;
  assert.ok(details);
  assert.equal(details.hasAttribute("open"), false);
  assert.ok(html.indexOf("The exact selected post.") < html.indexOf("Other original source 101"));
  assert.equal(document.querySelector('[aria-label="About author-thread context"]')!.getAttribute("aria-expanded"), "false");
  assert.equal(document.querySelectorAll('h2').length, 0);
  assert.match(document.querySelector('[aria-label="Thread gaps"]')!.textContent!, /Parent not supplied/);
  assert.deepEqual(Array.from(details.querySelectorAll("ol > li")).map(li => li.getAttribute("data-post-id")), ["101", "102"]);
});

test("a standalone post retains its bookmarked or context-only identity in the compact pill", async () => {
  const { ThreadContext } = await import("../components/reader/ThreadReading");
  for (const role of ["bookmark", "context"] as const) {
    const thread = { posts: [entry("101", role)], context: [], gaps: [], ordering: "reply" as const, conversationComplete: false as const };
    const html = renderToStaticMarkup(createElement(ThreadContext, { itemId: "item-101", thread, status: "ready", onRefresh() {}, children: createElement("p", null, "Original selected text.") }));
    const { document } = parseHTML(html);
    assert.match(document.querySelector('[aria-label="About author-thread context"]')!.textContent!, role === "bookmark" ? /Bookmarked/ : /Context only/);
    assert.equal(document.querySelector("details"), null);
  }
});
