/**
 * Reading a web page into an Article, on the server: the link import, and
 * anything an agent saves. Every redirect hop is checked against private,
 * loopback and link-local addresses before it is fetched.
 */

import { fetchWebSource } from "./web-source";
export { configureArticleFetch } from "./web-source";
import { parseHTML } from "linkedom";
import { imageStem, leadImage, prepareImages } from "@/lib/images";
import { Readability } from "@mozilla/readability";
import { htmlToBlocks } from "@/lib/html-to-blocks";
import { slugify, tidyTitle, undash, type Article, type Block } from "@/lib/article";

/** Fewer words than this usually means the article never reached the HTML. */
const MIN_WORDS = 80;

/** Readability's excerpt is often just the first paragraph; only keep it when it adds something. */
function dekFrom(excerpt: string | null | undefined, blocks: Block[]): string | undefined {
  const dek = undash((excerpt ?? "").trim());
  if (dek.length < 20) return undefined;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const first = norm(blocks.find((b) => b.type === "p")?.runs.map((r) => r.text).join("") ?? "");
  if (first.startsWith(norm(dek).slice(0, 60))) return undefined;
  return dek.length > 280 ? `${dek.slice(0, 277).replace(/\s+\S*$/, "")}...` : dek;
}

/**
 * React streaming (Next.js App Router, Suspense) sends a skeleton first:
 * `<!--$?--><template id="B:6"></template>...fallback...<!--/$-->`, and the real
 * content later in `<div hidden id="S:6">`, which a script ($RC) moves into
 * place. Readability drops hidden nodes, so the article went with it. This does
 * the script's work: the content replaces its placeholder and the fallback goes.
 * A segment for `<template id="P:9">` ($RS) replaces that template.
 */
function revealStreamed(doc: Document) {
  for (const seg of Array.from(doc.querySelectorAll("div[hidden]"))) {
    const m = /^S:(\d+)$/.exec(seg.id);
    if (!m) continue;
    const boundary = doc.getElementById(`B:${m[1]}`);
    const slot = boundary ?? doc.getElementById(`P:${m[1]}`);
    if (!slot?.parentNode) {
      seg.removeAttribute("hidden");
      continue;
    }
    if (boundary) {
      // The fallback runs from the template to the comment that closes its boundary.
      let depth = 0;
      for (let n = boundary.nextSibling; n; ) {
        const next = n.nextSibling;
        if (n.nodeType === 8) {
          const data = (n as Comment).data;
          if (data === "/$") {
            if (depth === 0) break;
            depth--;
          } else if (data === "$" || data === "$?" || data === "$!") depth++;
        }
        n.parentNode?.removeChild(n);
        n = next;
      }
    }
    while (seg.firstChild) slot.parentNode.insertBefore(seg.firstChild, slot);
    slot.parentNode.removeChild(slot);
    seg.parentNode?.removeChild(seg);
  }
}

/** Exact hosts only: lookalike domains are still ordinary web sources. */
export function notAnArticle(raw: string): "social" | "video" | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "");
    if (["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com", "threads.net", "bsky.app", "instagram.com", "facebook.com"].includes(host) || (host === "linkedin.com" && u.pathname.startsWith("/posts"))) return "social";
    return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "vimeo.com", "tiktok.com"].includes(host) ? "video" : null;
  } catch {
    return null;
  }
}

/** arXiv ids: new style (2610.07469v2) and old style (cs/9605103, math.GT/0309136). */
const ARXIV = /^(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/;

/**
 * The full text of an arXiv paper, for a link to its abstract page: that page
 * holds only the abstract, so a reader that can take a PDF gets the PDF, and
 * one that can't (an agent) gets arXiv's HTML rendering of the paper.
 */
export function arxivFullText(url: string, as: "pdf" | "html"): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const m = ARXIV.exec(`${u.hostname}${u.pathname}`);
  if (!m) return null;
  if (as === "pdf") return u.pathname.startsWith("/abs/") ? `https://arxiv.org/pdf/${m[1]}` : null;
  return `https://arxiv.org/html/${m[1]}`;
}

export type FetchResult =
  | { ok: true; article: Article }
  | { ok: true; pdf: ArrayBuffer; name: string; resolvedUrl?: string }
  | { ok: false; error: string; status: number; kind?: "pdf"; retryable?: boolean };

/** `pdf`: the caller can read a PDF itself, so a PDF link comes back as the file instead of an error. */
export async function fetchArticle(raw: string, opts: { pdf?: boolean; deadline?: number } = {}): Promise<FetchResult> {
  const result = await fetchWebSource((opts.pdf && arxivFullText(raw, "pdf")) || raw.trim(), opts);
  if (!result.ok) return result;
  const target = new URL(result.url), kind = notAnArticle(result.url);
  if (kind) return { ok: false, error: kind === "social" ? "That link is a social post, not a readable article." : "That link is a video; save its transcript instead.", status: 422 };
  const signature = new TextDecoder().decode(result.bytes.slice(0, 5));
  if (result.type.includes("application/pdf") || signature === "%PDF-") {
    if (!opts.pdf) return { ok: false, error: "PDF text processing is pending.", status: 415, kind: "pdf" };
    if (signature !== "%PDF-") return { ok: false, error: "The source did not contain valid PDF bytes.", status: 415 };
    let name = target.pathname.split("/").pop() || "document.pdf";
    try { name = decodeURIComponent(name); } catch {}
    return { ok: true, pdf: result.bytes.buffer as ArrayBuffer, name: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`, resolvedUrl: result.url };
  }
  if (!result.type.includes("html")) return { ok: false, error: "That link is not a readable web page.", status: 415 };
  const html = new TextDecoder().decode(result.bytes);

  const { document } = parseHTML(html);
  // Readability resolves relative links against the document URL.
  try {
    const base = document.createElement("base");
    base.setAttribute("href", target.toString());
    document.head?.appendChild(base);
  } catch {}

  // Pages streamed by React arrive with their content hidden, to be swapped in by a script.
  try {
    revealStreamed(document as unknown as Document);
  } catch {}

  // Data tables (header cells or a caption) often carry classes like "sticky-header"
  // that Readability reads as page furniture and strips. Their classes go, so they stay.
  for (const t of Array.from(document.querySelectorAll("table"))) {
    const role = t.getAttribute("role");
    if (role === "presentation" || role === "navigation") continue;
    if (t.querySelector("th, thead, caption")) t.removeAttribute("class");
  }

  // Read before Readability, which rewrites the document it is given.
  let lead: string | null = null;
  try {
    lead = leadImage(document as unknown as Document, target.toString());
  } catch {}

  // Pictures resolved to one real URL each and rewrapped as plain figures, so Readability keeps them.
  try {
    prepareImages(document as unknown as Document, target.toString());
  } catch {
    // Pictures are a bonus; never lose the article over them.
  }

  let parsed: ReturnType<Readability["parse"]> = null;
  try {
    parsed = new Readability(document as unknown as Document, { charThreshold: 400 }).parse();
  } catch {
    // Some unusual markup trips Readability up; that reads the same as no article found.
  }
  if (!parsed?.content) {
    return { ok: false, error: "Could not find an article on that page. Try pasting the text instead.", status: 422 };
  }

  const { document: clean } = parseHTML(`<!doctype html><html><body><div id="r">${parsed.content}</div></body></html>`);
  const root = clean.getElementById("r");
  if (!root) return { ok: false, error: "Could not read that article.", status: 422 };
  let blocks = htmlToBlocks(root as never, target.toString());
  const title = tidyTitle(undash((parsed.title || target.hostname).trim()));
  if (blocks[0] && blocks[0].type !== "p" && blocks[0].runs.map((r) => r.text).join("").trim() === title) blocks = blocks.slice(1);
  // The lead picture goes first, unless the article already opens with a picture or shows this one.
  const leadStem = lead ? imageStem(lead) : null;
  const shownAlready = (src?: string) => {
    if (!src || !leadStem) return false;
    try {
      return decodeURIComponent(src).includes(leadStem);
    } catch {
      return src.includes(leadStem);
    }
  };
  if (lead && !blocks.slice(0, 4).some((b) => b.type === "figure") && !blocks.some((b) => b.type === "figure" && shownAlready(b.src))) {
    blocks = [{ id: "b0", type: "figure", runs: [], src: lead }, ...blocks];
  }
  // A page drawn by scripts (a Google Doc, an app shell) leaves only its newsletter box and footer.
  const words = blocks.reduce((n, b) => n + b.runs.map((r) => r.text).join("").split(/\s+/).filter(Boolean).length, 0);
  if (blocks.filter((b) => b.type === "p").length < 2 || words < MIN_WORDS) {
    return { ok: false, error: "That page has too little text to read here.", status: 422 };
  }

  const article: Article = {
    id: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    author: parsed.byline ? undash(parsed.byline.replace(/^by\s+/i, "").trim()).slice(0, 120) : undefined,
    published: parsed.publishedTime ? new Date(parsed.publishedTime).getFullYear().toString() : undefined,
    dek: dekFrom(parsed.excerpt, blocks),
    source: parsed.siteName ?? target.hostname.replace(/^www\./, ""),
    sourceUrl: target.toString(),
    blocks,
    origin: "url",
    contentType: "article",
    image: lead ?? undefined,
    addedAt: Date.now(),
  };
  return { ok: true, article };
}
