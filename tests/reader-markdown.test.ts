import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { Block, type Mark } from "../components/reader/Block";
import type { Block as BlockData } from "../lib/article";
import { readerMarkdownBlocks } from "../lib/reader-markdown";

function read(input: BlockData | BlockData[], marks: Mark[] = []) {
  const blocks = Array.isArray(input) ? input : [input];
  const markdown = readerMarkdownBlocks(blocks);
  const html = renderToStaticMarkup(createElement("div", { className: "prose-read" }, blocks.map((block, i) => createElement(Block, {
    key: block.id, block, markdown: markdown.get(block.id), n: i + 1, marks, activeGloss: null, hoverGloss: null, activeHighlight: null, fresh: null, cursor: false, hasAt: false, onAsk() {},
  }))));
  return parseHTML(html).document;
}

function raw(text: string): BlockData {
  return { id: "saved-source", type: "p", runs: [{ text }] };
}

function visibleText(element: Element) {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
  return clone.textContent;
}

test("saved Markdown renders headings, nested emphasis and links while retaining source addresses and offsets", () => {
  const text = "## A useful heading\nRead **bold and *emphasized*** with [the source](https://example.com).";
  const document = read(raw(text));
  const source = document.querySelector('[data-block="saved-source"] .blk-text')!;
  assert.equal(visibleText(source.querySelector("h2")!), "A useful heading");
  assert.equal(visibleText(source.querySelector("strong")!), "bold and emphasized");
  assert.equal(visibleText(source.querySelector("strong em")!), "emphasized");
  assert.equal(source.querySelector("a")?.getAttribute("href"), "https://example.com");
  assert.equal(visibleText(source.querySelector("a")!), "the source");
  assert.equal(source.textContent, text);
  assert.equal(document.querySelectorAll('[data-block="saved-source"]').length, 1);
});

test("Markdown lists, quotes, fenced code and tables retain their readable structure", () => {
  const text = "3. First item\n4. Second item\n\n> Quoted **source**\n> on two lines\n\n```js\nconst value = '**literal**';\n\nconsole.log(value);\n```\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |";
  const document = read(raw(text));
  const source = document.querySelector(".blk-text")!;
  assert.equal(source.querySelector("ol")?.getAttribute("start"), "3");
  assert.equal(source.querySelectorAll("ol li").length, 2);
  assert.equal(visibleText(source.querySelector("blockquote")!), "Quoted source\non two lines");
  assert.equal(visibleText(source.querySelector("pre code")!), "const value = '**literal**';\n\nconsole.log(value);");
  assert.equal(source.querySelector("pre strong"), null);
  assert.equal(source.querySelectorAll('[role="columnheader"]').length, 2);
  assert.equal(source.querySelectorAll('[role="cell"]').length, 2);
  assert.equal(source.textContent, text);
});

test("plain text and already formatted source keep their characters and formatting", () => {
  const plain = "Contact first_last_name.\nBudget $5 and $10.\n2 * 3 = 6.\n<script>alert('literal')</script>";
  const source = read(raw(plain)).querySelector(".blk-text")!;
  assert.equal(source.textContent, plain);
  assert.equal(source.querySelector("em, script, ol"), null);
  const formatted = read({ id: "html-source", type: "p", runs: [{ text: "**literal stars**", strong: true }, { text: " and ordinary text." }] }).querySelector(".blk-text")!;
  assert.equal(formatted.querySelector("strong")?.textContent, "**literal stars**");
  assert.equal(formatted.querySelector(".reader-md-syntax"), null);
});

test("Markdown cannot activate HTML or unsafe links and highlights still address exact source characters", () => {
  const text = "Read **highlighted words** with [unsafe](javascript:alert%281%29) and <img src=x onerror=alert(1)> plus [safe](https://example.com).";
  const from = text.indexOf("highlighted");
  const source = read(raw(text), [{ from, to: from + "highlighted words".length, kind: "hl", id: "saved-highlight" }]).querySelector(".blk-text")!;
  assert.equal(source.querySelector('[data-h="saved-highlight"]')?.textContent, "highlighted words");
  assert.equal(source.querySelector('a[href^="javascript:"]'), null);
  assert.equal(source.querySelector("img, script"), null);
  assert.equal(source.querySelector('a[href="https://example.com"]')?.getAttribute("rel"), "noopener noreferrer");
  assert.equal(source.textContent, text);
});


test("Markdown code fences and reference links span saved paragraphs without changing their identities", () => {
  const blocks = [raw("```js\nconst value = '**literal**';"), { ...raw("console.log(value);\n```\nRead [the reference][source]."), id: "second" }, { ...raw("[source]: https://example.com"), id: "third" }];
  const document = read(blocks);
  for (const block of blocks) assert.equal(document.querySelector(`[data-block="${block.id}"] .blk-text`)!.textContent, block.runs[0].text);
  const second = document.querySelector('[data-block="second"] .blk-text')!;
  assert.equal(visibleText(second.querySelector("pre code")!), "console.log(value);");
  assert.equal(visibleText(second.querySelector("a")!), "the reference");
  assert.equal(second.querySelector("a")!.getAttribute("href"), "https://example.com");
});

test("pasted Markdown retains enough source to render nested formatting and unspaced block structure", async () => {
  const { textToArticle } = await import("../lib/article");
  const article = textToArticle("# Test\n\nRead **bold and *emphasis*** plus ~~deleted~~.\n## Another heading\n- One\n- Two", { origin: "paste" });
  const document = read(article.blocks);
  assert.equal(article.title, "Test");
  assert.equal(visibleText(document.querySelector("strong em")!), "emphasis");
  assert.equal(visibleText(document.querySelector("del")!), "deleted");
  assert.equal(visibleText(document.querySelector(".blk-text h2")!), "Another heading");
  assert.equal(document.querySelectorAll(".blk-text li").length, 2);
});

test("Markdown decodes entities and escaped punctuation without losing the source range", () => {
  const text = "**A &amp; B, &copy; and \\*literal stars\\***";
  const source = read(raw(text)).querySelector(".blk-text")!;
  assert.equal(visibleText(source.querySelector("strong")!), "A & B, © and *literal stars*");
  const original = source.cloneNode(true) as Element;
  original.querySelectorAll("[data-md-replacement]").forEach(node => node.remove());
  assert.equal(original.textContent, text);
});

test("Markdown hard line breaks remain inline inside their paragraph", () => {
  const document = read(raw("first  \nsecond"));
  assert.ok(document.querySelector(".blk-text p br"));
  assert.equal(document.querySelector(".blk-text p div"), null);
});

test("reading imported Markdown aloud skips code and speaks link labels without syntax", async () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const stub = (name: string, value: unknown) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const requests: string[] = [];
  stub("localStorage", { getItem: (key: string) => key === "together:api-key" ? "fixture-key" : null });
  stub("navigator", {});
  stub("Audio", class { src = ""; play() { return Promise.resolve(); } pause() {} removeAttribute() {} });
  stub("fetch", async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body)).text); return new Response(JSON.stringify({ error: "Fixture stops before audio playback" }), { status: 503 }); });
  const { startListening, stopListening } = await import("../components/reader/Listen");
  try {
    const { textToArticle } = await import("../lib/article");
    const { indexArticle } = await import("../lib/doc");
    const article = textToArticle("# Narration\n\n```js\nconsole.log('do not narrate code');\n```\n\nRead [the guide](https://example.com) &amp; **learn**.", { origin: "paste" });
    startListening(indexArticle(article), null);
    assert.deepEqual(requests, ["Read the guide & learn."]);
  } finally {
    stopListening();
    await new Promise(resolve => setImmediate(resolve));
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});
