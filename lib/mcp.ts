/**
 * The Sakamoto MCP server: a reader's agent saves articles (by link, or as text it
 * has read itself) to their library and looks through it. Streamable HTTP, stateless: every request is one JSON-RPC
 * message answered with JSON, no session and no event stream.
 *
 * Auth is a personal token from the library ("Connect an agent"), sent as
 * `Authorization: Bearer gls_...`, or as the last part of the URL
 * (your-site/mcp/gls_...) for clients that only take a URL.
 */

import { bookmarkWorkflow } from "./bookmark-workflow";
import { bookmarkDeliveryStatus, DELIVERY_SCHEMA } from "./bookmark-deliveries";
import { supplyLinkedText } from "./linked-text";
import { processLibrary, processingStatus } from "./processing";
import { searchEvidence,searchOptions,scheduleSearchRebuild } from "./retrieval";
import { hashToken, looksLikeToken } from "./agent";
import { importBookmarks, restoreBookmarks, xPostIdentity } from "./bookmarks";
import { normalizeUrl } from "./links";
import { SITE_URL } from "./brand";
import { blockText, contentTypeOf, isContentType, textToArticle, wordCount, type Article } from "./article";
import { shelfOf, shelveForUser, tokenUser, type ShelfRow } from "./db";
import { arxivFullText, fetchArticle, notAnArticle } from "./fetch-article";
import { TOPIC, TOPICS, isTopic, yearOf, type TopicKey } from "./library";

import { allow } from "./ratelimit";
import { scheduleClassification } from "./classification";

import type { LibraryItem } from "./store";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PER_CALL = 25;
/** About 60,000 words: a long essay or a two-hour transcript, well short of a book. */
const MAX_TEXT = 400_000;
const PER_DAY = 1000;
const SITE = SITE_URL;

const INSTRUCTIONS = `Sakamoto is the reader's private library. Save full X bookmarked posts with save_bookmarks: one post ID, original URL, full text and author per source. Preserve individual parent/quote identities in optional contextPosts. Completeness is an agent-reported claim, never independent X verification. Intake makes no paid model call; classification and indexing may remain pending. Use bounded batches of at most 25 posts and 2 MB, keep every receipt and resume with the next batch. Up to 60 MCP requests/minute; after a rate-limit response, wait a minute and replay the unacknowledged batch. A receipt confirms only that delivery, never the complete bookmark history. Removed posts stay removed until restore_bookmarks is explicitly requested by the reader. Absence or unbookmarking never removes a Sakamoto item.
Call bookmark_workflow for exact source, sample, backfill and routine instructions; bookmark_delivery_status gives durable receipts and verified counts, separate from agent-reported source totals. Optional save_bookmarks delivery identifies a resumable run/batch. report_bookmark_run records no-data or blocked checks. Direct links in accepted posts are processed automatically; do not separately call save_articles for those discoveries. Use save_articles for separately requested web articles. Legacy save_text remains available for text, transcripts and sources you read yourself.`;

const POST_SCHEMA = {
  type: "object",
  properties: {
    postId: { type: "string", pattern: "^[1-9][0-9]{0,23}$", description: "Stable numeric X post ID, unaffected by author handle changes." },
    url: { type: "string", maxLength: 4096, description: "Original X/twitter post URL matching postId." },
    text: { type: "string", minLength: 1, maxLength: MAX_TEXT, description: "Exact full source text, not a summary." },
    title: { type: "string", maxLength: 500 },
    author: { type: "object", properties: { name: { type: "string", maxLength: 200 }, handle: { type: "string", pattern: "^[A-Za-z0-9_]{1,15}$" }, id: { type: "string", pattern: "^[1-9][0-9]{0,23}$" } }, required: ["name", "handle"], additionalProperties: false },
    publishedAt: { type: "string", format: "date-time" },
    observedAt: { type: "string", format: "date-time", description: "When the agent observed this source, with timezone." },
    replyToPostId: { type: "string", pattern: "^[1-9][0-9]{0,23}$" },
    quotedPostId: { type: "string", pattern: "^[1-9][0-9]{0,23}$" },
    conversationId: { type: "string", pattern: "^[1-9][0-9]{0,23}$" },
    links: { type: "array", items: { type: "string", maxLength: 4096 }, maxItems: 50, description: "Only URLs directly linked from this source." },
    completeness: { type: "object", properties: { status: { type: "string", enum: ["complete", "partial", "unknown"] }, reason: { type: "string", maxLength: 2000 } }, required: ["status"], additionalProperties: false },
  },
  required: ["postId", "url", "text", "author", "observedAt"],
  additionalProperties: false,
};

const TOOLS = [
  {name:"bookmark_workflow",title:"Prepare the Grok bookmark workflow",description:"Read exact-schema sample, bounded backfill and daily routine instructions. Preparation does not connect Grok or enable a routine. Requires a reachable public HTTPS origin and the owner’s authenticated X access.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:"bookmark_delivery_status",title:"Bookmark delivery and backfill progress",description:"Verified saved-source and receipt counts, last delivery/contact, bounded delivery history and current processing totals. Source coverage stays agent-reported. Optional runId/batchId retrieves compact per-item receipts for a lost response.",inputSchema:{type:"object",properties:{runId:{type:"string",maxLength:100},batchId:{type:"string",maxLength:100},after:{type:"string"},limit:{type:"integer",minimum:1,maximum:25}},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:"report_bookmark_run",title:"Report a source-side pause or empty check",description:"Record an agent-reported blocked, no-data or exhausted check without inventing saved content. This does not verify complete upstream coverage or schedule Grok.",inputSchema:DELIVERY_SCHEMA,annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false}},
  {name:"supply_link_text",title:"Supply extracted text for a failed linked source",description:"Deliberately recover a retained unsupported linked PDF using its processing job ID. Saves reader-supplied text and discovery links without claiming verified PDF pages. Existing saved text is never replaced.",inputSchema:{type:"object",properties:{jobId:{type:"string",pattern:"^[0-9]+$"},text:{type:"string",minLength:1,maxLength:1000000},title:{type:"string",maxLength:500}},required:["jobId","text"],additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false}},
 {name:"classify_item",title:"Categorize a saved source",description:"Schedule categorization of any saved article, document or post. reclassify:true deliberately repeats a prior decision using the same durable budget. Manual topics and tags are preserved.",inputSchema:{type:"object",properties:{itemId:{type:"string"},reclassify:{type:"boolean"}},required:["itemId"],additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:false,openWorldHint:false}},
 {name:"process_library",title:"Process received material now",description:"Process a bounded batch of already received linked sources. Optionally retry a failed job deliberately (at most eight attempts). Does not ask Grok for new bookmarks.",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:4},retryJobId:{type:"string"}},additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:true}},
  { name: "processing_status", title: "Received material processing status", description: "Show durable linked-source outcomes, attempts and retry times for material already received. Does not fetch new bookmarks from Grok.", inputSchema: { type: "object", properties: {limit: {type:"integer",minimum:1,maximum:100},after:{type:"string"},sourceId:{type:"string"}}, additionalProperties: false }, annotations: {readOnlyHint:true,openWorldHint:false} },
  {name:"reindex_library",title:"Schedule a resumable search rebuild",description:"Schedule existing active saved sources for the current embedding contract, at most 25 per page. Pass next as after until it is null. Does not dispatch paid work; process_library resumes the same durable jobs and reuses compatible vectors.",inputSchema:{type:"object",properties:{after:{type:"string"},limit:{type:"integer",minimum:1,maximum:25}},additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:true,openWorldHint:false}},
  {
    name: "search_saved_passages", title: "Search saved source evidence",
    description: "Find passages by meaning or exact wording, with current source revision, original URL and exact block/page/post addresses. Uses a guarded paid query embedding when available; lexical search remains available while semantic work is paused. Legacy search_library continues to search metadata.",
    inputSchema: {type:"object",properties:{query:{type:"string",maxLength:1000},contentType:{type:"string",enum:["article","document","post"]},topic:{type:"string",enum:TOPICS.map(t=>t.key)},tags:{type:"array",items:{type:"string"},maxItems:20},semantic:{type:"boolean",default:true},limit:{type:"integer",minimum:1,maximum:50}},required:["query"],additionalProperties:false},
    annotations:{readOnlyHint:true,openWorldHint:false},
  },
  {
    name: "save_bookmarks", title: "Save full bookmarked X posts",
    description: "Save 1–25 full posts per batch (2 MB total), without paid enrichment. Returns an ordered stable receipt for every item: saved, incomplete, duplicate, removed or rejected. Parent/quote context gets separate receipts and identities. Retry safely; repeated source text is not silently replaced. Each delivery is only a batch, not a complete bookmark-history claim.",
    inputSchema: { type: "object", properties: { delivery: DELIVERY_SCHEMA, posts: { type: "array", minItems: 1, maxItems: 25, items: { ...POST_SCHEMA, properties: { ...POST_SCHEMA.properties, contextPosts: { type: "array", maxItems: 8, items: POST_SCHEMA, description: "Necessary supplied parent/quote context only; no crawl or unrelated replies." }, threadPosts: {type:"array",maxItems:8,items:POST_SCHEMA,description:"Connected same-author descendants, retained as context rather than individually bookmarked. Bounded batches may resume through saved same-author ancestry."} } } } }, required: ["posts"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "restore_bookmarks", title: "Deliberately restore removed posts",
    description: "Only on the reader's explicit request, restore retained removed X posts by post ID. Restores saved text and metadata with annotations; never fetches or replaces a source.",
    inputSchema: { type: "object", properties: { postIds: { type: "array", minItems: 1, maxItems: 25, items: { type: "string", pattern: "^[1-9][0-9]{0,23}$" } } }, required: ["postIds"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_articles",
    title: "Save articles to the library",
    description: `Save web articles, essays, blog posts or papers to the reader's Sakamoto library. Sakamoto fetches each page, keeps its full text and sorts it onto a topic. Up to ${PER_CALL} URLs per call. Send the article's own URL, not a link to a post on X or another social site. Links already in the library are skipped. Returns what happened to each URL.`,
    inputSchema: {
      type: "object",
      properties: { urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: PER_CALL, description: "Article URLs to save." } },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "save_text",
    title: "Save a text to the library",
    description: "Save a text you have read yourself to the reader's Sakamoto library, for what Sakamoto can't fetch from a link: an X Article, a long post or a thread on X, a video's transcript, a page behind a login. Send the whole text as Markdown (blank lines between paragraphs, # for headings), word for word, not a summary. Give the original URL so the reader can open the source and the text isn't saved twice. One text per call.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: MAX_TEXT, description: "The full text, as Markdown." },
        title: { type: "string", description: "Its title. For a post with none, a short title in the author's words." },
        author: { type: "string", description: "Who wrote or said it." },
        url: { type: "string", description: "Where it came from: the post, article or video URL." },
        source: { type: "string", description: "The publication or site, like \"X\" or a YouTube channel. Defaults to the URL's site." },
        published: { type: "string", description: "When it was published, as a date." },
        contentType: { type: "string", enum: ["article", "document", "post"], description: "Optional source type. Otherwise inferred from its URL or pasted text." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_library",
    title: "Search the library",
    description: "Find texts in the reader's Sakamoto library by words in the title, author, source or tags, by topic, or by reading status. With no arguments, lists the most recently added.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for." },
        topic: { type: "string", enum: TOPICS.map((t) => t.key), description: "A topic key, from list_topics." },
        status: { type: "string", enum: ["unread", "reading", "finished"] },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_topics",
    title: "List topics",
    description: "The library's topics, with how many texts are on each.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const fail = (id: Rpc["id"], code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

export function notAllowed() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export async function handle(req: Request, pathToken?: string): Promise<Response> {
  let body: unknown;
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 2_100_000) { await reader.cancel(); return fail(null, -32600, "MCP body exceeds 2.1 MB. Send smaller resumable batches.", 413); }
        chunks.push(next.value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally { reader.releaseLock(); }
  } catch {
    return fail(null, -32700, "Parse error: the body must be JSON-RPC.", 400);
  }
  // Clients on the 2025-03-26 protocol may send a batch: an array of messages, answered with an array.
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Rpc[];
  if (!msgs.length || msgs.length > 25 || msgs.some((m) => typeof m !== "object" || !m)) return fail(null, -32600, "Send a JSON-RPC message, or an array of them.", 400);
  const first = msgs[0];
  console.info("mcp:", msgs.map((m) => m.method).join(", "), first.method === "initialize" ? JSON.stringify({ v: first.params?.protocolVersion, client: first.params?.clientInfo }) : "");

  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = looksLikeToken(header) ? header : looksLikeToken(pathToken) ? pathToken : null;
  if (!process.env.DATABASE_URL) return fail(first.id, -32000, "The Sakamoto library is not available on this server.", 503);
  let who: { userId: string; label: string } | null = null;
  try {
    who = token ? await tokenUser(hashToken(token)) : null;
  } catch {
    return fail(first.id, -32000, "The Sakamoto library is not reachable right now. Try again in a minute.", 503);
  }
  if (!who) return fail(first.id, -32001, `Missing or revoked Sakamoto token. Make one in your library at ${SITE}/library, under Connect an agent.`, 401);
  const { userId, label } = who;
  if (!allow(`mcp:${userId}`, 60, 60_000)) return fail(first.id, -32002, "Too many requests. Wait a minute, then try again.", 429);

  // Notifications get no answer; with nothing to answer, the reply is an empty 202.
  const answers = (await Promise.all(msgs.map((m) => answer(m, userId, label)))).filter((a) => a !== null);
  if (!answers.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? answers : answers[0]);
}

async function answer(msg: Rpc, userId: string, label: string): Promise<object | null> {
  if (msg.id === undefined || msg.method?.startsWith("notifications/")) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sakamoto", title: "Sakamoto library", version: "1.0.0", websiteUrl: SITE },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        if (name === "supply_link_text") { const result = await supplyLinkedText(userId,args); return ok(result ? toolResult("Saved reader-supplied linked text.",result) : toolError("This source is unavailable, changed or not awaiting text recovery.")); }
        if (name === "classify_item") return ok(toolResult("Category processing scheduled.", await scheduleClassification(userId,args)));
        if (name === "process_library") return ok(toolResult("Processed received material.", await processLibrary(userId, args)));
        if (name === "processing_status") return ok(toolResult("Received material processing status.", await processingStatus(userId, args)));
        if (name === "restore_bookmarks") { const result = await restoreBookmarks(userId, args); return ok(toolResult("Explicit bookmark restore receipts.", result)); }
        if (name === "bookmark_workflow") { if (Object.keys(args).length) return ok(toolError("No workflow options are accepted.")); return ok(toolResult("Prepared Grok workflow; live connection and routine are unverified.",bookmarkWorkflow(SITE))); }
        if (name === "bookmark_delivery_status") return ok(toolResult("Bookmark delivery progress.", await bookmarkDeliveryStatus(userId,args)));
        if (name === "report_bookmark_run") { if (args.status === "more") return ok(toolError("A more report must deliver its posts through save_bookmarks.")); return ok(toolResult("Agent-reported source check recorded.",await importBookmarks(userId,{posts:[],delivery:args},label))); }
        if (name === "save_bookmarks") { const result = await importBookmarks(userId, args, label); return ok(toolResult("Bookmark batch accepted; classification and indexing are pending.", result)); }
        if (name === "save_articles") return ok(await saveArticles(userId, args, label));
        if (name === "save_text") return ok(await saveText(userId, args, label));
        if (name === "reindex_library") return ok(toolResult("Search rebuild scheduling.",await scheduleSearchRebuild(userId,args)));
        if (name === "search_saved_passages") { const result=await searchEvidence(userId,searchOptions(args)); return ok(toolResult("Saved source evidence.",result)); }
        if (name === "search_library") return ok(await searchLibrary(userId, args));
        if (name === "list_topics") return ok(await listTopics(userId));
        return err(-32602, `Unknown tool: ${name}`);
      } catch (e) {
        return ok(toolError(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });
const toolResult = (text: string, structured: Record<string, unknown>) => ({ content: [{ type: "text", text }], structuredContent: structured });

/* ---------- save_articles ---------- */

type Saved = { url: string; status: "saved" | "already_saved" | "failed"; title?: string; topic?: string; reason?: string };


async function saveArticles(userId: string, args: Record<string, unknown>, via: string) {
  const raw = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
  if (!raw.length) return toolError("Send at least one URL in `urls`.");
  if (raw.length > PER_CALL) return toolError(`At most ${PER_CALL} URLs per call. Send the rest in another call.`);

  const shelf = await shelfOf(userId);
  const have = new Map<string, ShelfRow>();
  for (const r of shelf) if (typeof r.data.sourceUrl === "string") have.set(normalizeUrl(r.data.sourceUrl), r);
  let budget = savesLeft(shelf);

  const seen = new Set<string>();
  const queue = raw.map((url) => ({ url, key: normalizeUrl(url) })).filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  const results: Saved[] = [];

  const one = async ({ url, key }: { url: string; key: string }): Promise<Saved> => {
    const kind = notAnArticle(url);
    if (kind === "social") return { url, status: "failed", reason: "This is a social post, not an article. Send the link the post points to, or, if the post is the piece, read it and send the full post with save_bookmarks (or legacy save_text)." };
    if (kind === "video") return { url, status: "failed", reason: "This is a video, not an article. Sakamoto reads text: send its transcript with save_text." };
    const known = have.get(key);
    if (known) return { url, status: "already_saved", title: String(known.data.title ?? ""), topic: TOPIC[isTopic(known.data.topic) ? known.data.topic : "unsorted"].name };
    if (budget <= 0) return { url, status: "failed", reason: `The daily limit of ${PER_DAY} saves is reached. Try again tomorrow.` };
    budget--;

    // An arXiv abstract page holds only the abstract, and an agent can't save the PDF: arXiv's HTML rendering is the whole paper.
    const html = arxivFullText(url, "html");
    let r = html ? await fetchArticle(html) : null;
    if (!r?.ok) r = await fetchArticle(url, { pdf: true });
    if (!r.ok) return { url, status: "failed", reason: r.error };
    if ("pdf" in r) return { url, status: "failed", reason: "This link is a PDF. Agents can't save PDFs yet; open it in Sakamoto to read it." };
    const a = r.article;
    if (have.has(normalizeUrl(a.sourceUrl ?? ""))) {
      const k = have.get(normalizeUrl(a.sourceUrl ?? ""))!;
      return { url, status: "already_saved", title: String(k.data.title ?? "") };
    }

    const item = shelfItem(a, { via });
    await shelveForUser(userId, item, a);
    have.set(key, { id: a.id, data: item as unknown as Record<string, unknown>, pct: 0 });
    return { url, status: "saved", title: a.title, topic: TOPIC.unsorted.name };
  };

  // A few at a time: pages are slow, and one bad link never holds up the rest.
  const next = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) results.push(await one(x).catch((e) => ({ url: x.url, status: "failed" as const, reason: String(e) })));
  };
  await Promise.all([next(), next(), next(), next()]);
  const order = new Map(raw.map((u, i) => [u, i]));
  results.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));

  const count = (s: Saved["status"]) => results.filter((r) => r.status === s).length;
  const lines = results.map((r) =>
    r.status === "saved" ? `Saved: ${r.title} (${r.topic})` : r.status === "already_saved" ? `Already in the library: ${r.title || r.url}` : `Not saved: ${r.url}. ${r.reason}`
  );
  const head = `${count("saved")} saved, ${count("already_saved")} already in the library, ${count("failed")} not saved.`;
  return toolResult(`${head}\n${lines.join("\n")}\n\nThey'll be on the shelves at ${SITE}/library.`, { saved: count("saved"), alreadySaved: count("already_saved"), failed: count("failed"), results });
}

/** Saves an agent may still make today: PER_DAY across both save tools. */
function savesLeft(shelf: ShelfRow[]) {
  const dayAgo = Date.now() - 86_400_000;
  return PER_DAY - shelf.filter((r) => r.data.addedBy === "agent" && Number(r.data.addedAt) > dayAgo).length;
}

/* ---------- save_text ---------- */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function saveText(userId: string, args: Record<string, unknown>, via: string) {
  const text = str(args.text);
  if (!text) return toolError("Send the text in `text`.");
  if (text.length > MAX_TEXT) return toolError(`That text is too long: at most ${MAX_TEXT.toLocaleString("en-US")} characters.`);
  let url: string | undefined;
  if (str(args.url)) {
    try {
      const u = new URL(str(args.url)!);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      url = u.toString();
    } catch {
      return toolError("`url` must be a web address, starting with https://.");
    }
  }

  const identity = url ? xPostIdentity(url) : null;
  if (identity) {
    const published = str(args.published);
    const result = await importBookmarks(userId, { posts: [{ postId: identity.postId, url, text: args.text, title: str(args.title), author: { name: str(args.author) ?? identity.handle, handle: identity.handle }, observedAt: new Date().toISOString(), ...(published && Number.isFinite(Date.parse(published)) ? { publishedAt: new Date(published).toISOString() } : {}), completeness: { status: "unknown", reason: "Legacy save_text did not report completeness." } }] }, via);
    const r = result.results[0];
    if (r.status === "rejected") return toolError(r.reason ?? "Unable to save this text.");
    return toolResult(r.status === "removed" ? "This post was removed in Sakamoto. Restore it deliberately with restore_bookmarks." : r.status === "duplicate" ? "Already in the library." : "Saved to the library; classification and indexing are pending.", {
      status: r.status === "duplicate" ? "already_saved" : r.status === "removed" ? "removed" : "saved", title: r.title ?? str(args.title) ?? text.trim().slice(0, 100), topic: "Unsorted", words: r.words ?? text.split(/\s+/).filter(Boolean).length, itemId: r.itemId, receiptId: r.receiptId, readInSakamoto: `${SITE}/read/${r.itemId}`, readInGloss: `${SITE}/read/${r.itemId}`,
    });
  }
  const shelf = await shelfOf(userId);
  if (url) {
    const known = shelf.find((r) => typeof r.data.sourceUrl === "string" && normalizeUrl(r.data.sourceUrl) === normalizeUrl(url));
    if (known) return toolResult(`Already in the library: ${String(known.data.title ?? url)}`, { status: "already_saved", title: String(known.data.title ?? "") });
  }
  if (savesLeft(shelf) <= 0) return toolError(`The daily limit of ${PER_DAY} saves is reached. Try again tomorrow.`);

  const title = str(args.title);
  const a = textToArticle(text, { title, origin: "paste" });
  // A text that opens with its own title as a heading shouldn't show it twice.
  if (title && a.blocks[0]?.type.startsWith("h") && blockText(a.blocks[0]).trim().toLowerCase() === title.toLowerCase()) a.blocks.shift();
  if (!a.blocks.length) return toolError("There was no readable text in that.");
  a.author = str(args.author);
  a.source = str(args.source) ?? (url ? new URL(url).hostname.replace(/^www\./, "") : undefined);
  a.sourceUrl = url;
  a.contentType = contentTypeOf({ sourceUrl: url, origin: a.origin, contentType: isContentType(args.contentType) ? args.contentType : undefined });
  a.published = str(args.published);
  for (const k of ["author", "source", "sourceUrl", "published"] as const) if (a[k] === undefined) delete a[k];

  const item = shelfItem(a, { via });
  await shelveForUser(userId, item, a);
  const topic = TOPIC[isTopic(item.topic) ? item.topic : "unsorted"].name;
  return toolResult(`Saved: ${a.title} (${topic}, ${item.words.toLocaleString("en-US")} words)\n\nIt'll be on the shelves at ${SITE}/library.`, {
    status: "saved",
    title: a.title,
    topic,
    words: item.words,
    readInSakamoto: `${SITE}/read/${a.id}`,
    readInGloss: `${SITE}/read/${a.id}`,
  });
}

function shelfItem(a: Article, s: { via?: string }): LibraryItem {
  const item: LibraryItem = {
    id: a.id,
    title: a.title,
    author: a.author,
    source: a.source,
    words: wordCount(a),
    origin: a.origin ?? "url",
    contentType: contentTypeOf(a),
    addedAt: Date.now(),
    dek: a.dek,
    year: yearOf(a.published),
    sourceUrl: a.sourceUrl,
    image: a.image,
    processing: { classification: "pending", indexing: "pending" },
    addedBy: "agent",
    // The connection's name, as the reader chose it ("Grok Bot", "Claude"), so the library can say who shelved it.
    addedVia: s.via || undefined,
  };
  for (const k of Object.keys(item) as (keyof LibraryItem)[]) if (item[k] === undefined) delete item[k];
  return item;
}

/* ---------- search_library, list_topics ---------- */

function describe(r: ShelfRow) {
  const d = r.data;
  const topic = isTopic(d.topic) ? d.topic : "unsorted";
  return {
    itemId: r.id,
    processing: d.processing,
    postId: d.postId,
    title: String(d.title ?? ""),
    author: typeof d.author === "string" ? d.author : undefined,
    url: typeof d.sourceUrl === "string" ? d.sourceUrl : undefined,
    topic: TOPIC[topic].name,
    contentType: contentTypeOf(d as LibraryItem),
    tags: Array.isArray(d.tags) ? d.tags : [],
    minutes: Math.max(1, Math.round(Number(d.words ?? 0) / 230)),
    status: r.pct >= 1 ? "finished" : r.pct > 0 ? "reading" : "unread",
    addedAt: new Date(Number(d.addedAt ?? 0)).toISOString().slice(0, 10),
    readInSakamoto: `${SITE}/read/${r.id}`,
    readInGloss: `${SITE}/read/${r.id}`,
  };
}

async function searchLibrary(userId: string, args: Record<string, unknown>) {
  const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const topic = isTopic(args.topic) ? args.topic : null;
  const status = typeof args.status === "string" ? args.status : null;
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  const shelf = (await shelfOf(userId)).filter((r) => r.data.origin !== "sample");
  const found = shelf
    .map(describe)
    .filter((b) => (!topic || b.topic === TOPIC[topic].name) && (!status || b.status === status))
    .filter((b) => words.every((w) => `${b.title} ${b.author ?? ""} ${b.url ?? ""} ${b.topic} ${b.tags.join(" ")}`.toLowerCase().includes(w)))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const shown = found.slice(0, limit);
  const text = shown.length
    ? `${found.length} found${found.length > shown.length ? `, showing ${shown.length}` : ""}:\n${shown.map((b) => `- ${b.title}${b.author ? `, ${b.author}` : ""} (${b.topic}, ${b.minutes} min, ${b.status})${b.url ? ` ${b.url}` : ""}`).join("\n")}`
    : "Nothing in the library matches.";
  return toolResult(text, { total: found.length, results: shown });
}

async function listTopics(userId: string) {
  const shelf = (await shelfOf(userId)).filter((r) => r.data.origin !== "sample");
  const counts = new Map<string, number>();
  for (const r of shelf) {
    const k = isTopic(r.data.topic) ? r.data.topic : "unsorted";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const topics = TOPICS.map((t) => ({ key: t.key, name: t.name, count: counts.get(t.key) ?? 0 }));
  return toolResult(topics.filter((t) => t.count).map((t) => `${t.name} (${t.key}): ${t.count}`).join("\n") || "The library is empty.", { topics });
}
