/** Structured source intake. The authenticated caller supplies the owner, never the payload. */
import { createHash } from "node:crypto";
import { textToArticle, wordCount, type Article } from "./article";
import { db } from "./db";

export type PostSource = {
  postId: string;
  url: string;
  fullText: string;
  title?: string;
  author: { name: string; handle: string; id?: string };
  publishedAt?: string;
  observedAt: string;
  replyToPostId?: string;
  quotedPostId?: string;
  conversationId?: string;
  links: string[];
  completeness: { status: "complete" | "partial" | "unknown"; reason?: string; verification: "agent_reported" };
  provenance: { via: string; receivedAt: string };
};
export type ProcessingState = { classification: "pending" | "complete" | "failed"; indexing: "pending" | "complete" | "failed" };

const MAX_POSTS = 25;
const MAX_BATCH_BYTES = 2_000_000;
const fields = ["title", "postId", "url", "text", "author", "publishedAt", "observedAt", "replyToPostId", "quotedPostId", "conversationId", "links", "completeness"];
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected an object.");
  return v as Record<string, unknown>;
}
function only(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some((k) => !allowed.includes(k))) throw new Error("Unsupported metadata field; ownership is derived from the authenticated token.");
}
function string(v: unknown, name: string, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || v.includes("\u0000")) throw new Error(`${name} must be nonempty text of at most ${max} characters without null bytes.`);
  return v;
}
function postId(v: unknown): string {
  const id = string(v, "postId", 24);
  if (!/^[1-9]\d*$/.test(id)) throw new Error("Post identities must be decimal X post IDs.");
  return id;
}
function date(v: unknown, name: string): string {
  const value = string(v, name, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp with timezone.`);
  return value;
}
function webUrl(v: unknown): string {
  const raw = string(v, "url", 4096);
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Expected an HTTP(S) URL."); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error("Expected an HTTP(S) URL without credentials.");
  return raw;
}
function sourceOf(raw: unknown, via: string, context = false): PostSource {
  const p = object(raw);
  only(p, context ? [...fields, "contextPosts"] : fields);
  if (p.contextPosts !== undefined && (!Array.isArray(p.contextPosts) || p.contextPosts.length > 8)) throw new Error("Send at most 8 parent or quote context posts with a bookmark.");
  const id = postId(p.postId), url = webUrl(p.url), u = new URL(url);
  const match = u.pathname.match(/^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status)\/([1-9]\d*)\/?$/);
  if (!["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.x.com", "mobile.twitter.com"].includes(u.hostname.toLowerCase()) || u.port || match?.[1] !== id) throw new Error("Post URL must identify the supplied X post ID.");
  const author = object(p.author);
  only(author, ["name", "handle", "id"]);
  const name = string(author.name, "author.name", 200), handle = string(author.handle, "author.handle", 15);
  if (!/^[A-Za-z0-9_]+$/.test(handle)) throw new Error("Expected an X author handle without @.");
  const claim = p.completeness === undefined ? { status: "unknown" } : object(p.completeness);
  only(claim, ["status", "reason"]);
  if (!["complete", "partial", "unknown"].includes(String(claim.status))) throw new Error("Completeness must be complete, partial or unknown; it remains agent-reported.");
  const links = p.links === undefined ? [] : p.links;
  if (!Array.isArray(links) || links.length > 50) throw new Error("Send at most 50 directly linked URLs per post.");
  return {
    postId: id, url, fullText: string(p.text, "text", 400_000), ...(p.title === undefined ? {} : { title: string(p.title, "title", 500) }), author: { name, handle, ...(author.id === undefined ? {} : { id: postId(author.id) }) },
    observedAt: date(p.observedAt, "observedAt"), ...(p.publishedAt === undefined ? {} : { publishedAt: date(p.publishedAt, "publishedAt") }),
    ...(p.replyToPostId === undefined ? {} : { replyToPostId: postId(p.replyToPostId) }),
    ...(p.quotedPostId === undefined ? {} : { quotedPostId: postId(p.quotedPostId) }),
    ...(p.conversationId === undefined ? {} : { conversationId: postId(p.conversationId) }),
    links: links.map(webUrl), completeness: { status: claim.status as PostSource["completeness"]["status"], ...(claim.reason === undefined ? {} : { reason: string(claim.reason, "completeness.reason", 2000) }), verification: "agent_reported" },
    provenance: { via, receivedAt: new Date().toISOString() },
  };
}

export type BookmarkReceipt = { title?: string; words?: number; completeness?: PostSource["completeness"]; receiptId: string; postId?: string; itemId?: string; sourceRevision?: number; status: "saved" | "incomplete" | "duplicate" | "removed" | "rejected"; reason?: string; processing?: ProcessingState; contextResults?: BookmarkReceipt[] };
const rejected = (raw: unknown, error: unknown): BookmarkReceipt => ({ receiptId: "input:" + createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 24), status: "rejected", reason: error instanceof Error ? error.message : "Unable to save this post; retry it separately." });

async function persistSource(owner: string, source: PostSource, role: "bookmark" | "context"): Promise<BookmarkReceipt> {
  const a: Article = { ...textToArticle(source.fullText, { origin: "paste" }), id: crypto.randomUUID(), title: source.title ?? source.fullText.trim().slice(0, 100), author: source.author.name, source: "X", sourceUrl: source.url, published: source.publishedAt, contentType: "post", post: source };
  const processing: ProcessingState = { classification: "pending", indexing: "pending" };
  const item = { id: a.id, title: a.title, author: a.author, source: "X", sourceUrl: a.sourceUrl, origin: "paste", contentType: "post", words: wordCount(a), addedAt: Date.now(), addedBy: "agent", addedVia: source.provenance.via, processing, postId: source.postId };
  const rows = await db().query("select intake_bookmark($1,$2,$3,$4::jsonb,$5::jsonb,$6) as receipt", [owner, source.postId, source.url, JSON.stringify(item), JSON.stringify(a), role]);
  return { receiptId: "x:" + source.postId, postId: source.postId, ...rows[0].receipt };
}

export async function importBookmarks(owner: string, args: Record<string, unknown>, via: string) {
  only(args, ["posts"]);
  if (!Array.isArray(args.posts) || !args.posts.length || args.posts.length > MAX_POSTS) throw new Error("Send 1 to 25 posts per batch. Resume with the next batch after receiving receipts.");
  if (Buffer.byteLength(JSON.stringify(args), "utf8") > MAX_BATCH_BYTES) throw new Error("Batch exceeds 2 MB; send smaller batches and resume after the returned receipts.");
  const results: BookmarkReceipt[] = [];
  for (const raw of args.posts) {
    try {
      const source = sourceOf(raw, via, true);
      const receipt = await persistSource(owner, source, "bookmark");
      const contexts = object(raw).contextPosts as unknown[] | undefined;
      if (contexts?.length) {
        const reachable = new Set([source.replyToPostId, source.quotedPostId].filter(Boolean));
        const parsed = contexts.map((c) => { try { return sourceOf(c, via); } catch { return null; } });
        // Only supplied necessary ancestors/quotes are preserved, never unrelated replies or a crawl.
        let changed = true;
        while (changed) {
          changed = false;
          for (const p of parsed) if (p && reachable.has(p.postId)) {
            for (const id of [p.replyToPostId, p.quotedPostId]) if (id && !reachable.has(id)) { reachable.add(id); changed = true; }
          }
        }
        receipt.contextResults = [];
        for (let i = 0; i < contexts.length; i++) {
          try {
            const p = sourceOf(contexts[i], via);
            if (!reachable.has(p.postId) || receipt.status === "removed") throw new Error("Context must be a necessary parent or quote of an active saved bookmark.");
            receipt.contextResults.push(await persistSource(owner, p, "context"));
          } catch (error) { receipt.contextResults.push(rejected(contexts[i], error)); }
        }
      }
      results.push(receipt);
    } catch (error) { results.push(rejected(raw, error)); }
  }
  return { results, deliveryComplete: false, resume: "Keep each receipt, retry rejected transient failures, and send the next bounded batch. This receipt confirms only the supplied posts, not your complete X bookmark history." };
}

/** Owner-scoped saved sources for thread/read modules. Context keeps its own item and citation identity. */
export async function readPosts(owner: string, ids: string[]): Promise<{ postId: string; itemId: string; role: "bookmark" | "context"; sourceRevision: number; article: Article }[]> {
  if (ids.length > 100) throw new Error("Read at most 100 post identities at a time.");
  const rows = await db().query(`select p.post_id,p.article_id,p.role,a.source_revision,a.doc from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id where p.user_id=$1 and p.post_id=any($2::text[]) and not a.deleted`, [owner, ids]);
  return rows.map((r) => ({ postId: r.post_id, itemId: r.article_id, role: r.role, sourceRevision: r.source_revision, article: r.doc }));
}

/** Bounded direct-link handoff for durable processing; tuple cursor resumes without scanning source JSON. */
export async function postLinks(owner: string, after: { postId: string; sourceRevision: number; url: string } = { postId: "", sourceRevision: 0, url: "" }, limit = 100): Promise<{ postId: string; itemId: string; sourceRevision: number; url: string; role: "bookmark" | "context" }[]> {
  const rows = await db().query(`select l.*,p.article_id,p.role from post_links l join post_sources p using(user_id,post_id) join articles a on a.user_id=p.user_id and a.id=p.article_id where l.user_id=$1 and not a.deleted and (l.post_id,l.source_revision,l.url)>($2,$3,$4) order by l.post_id,l.source_revision,l.url limit $5`, [owner, after.postId, after.sourceRevision, after.url, Math.max(1, Math.min(100, limit))]);
  return rows.map((r) => ({ postId: r.post_id, itemId: r.article_id, sourceRevision: r.source_revision, url: r.url, role: r.role }));
}

/** Deliberate restore is separate from source delivery; it never replaces retained source text or annotations. */
export async function restoreBookmarks(owner: string, args: Record<string, unknown>) {
  only(args, ["postIds"]);
  if (!Array.isArray(args.postIds) || !args.postIds.length || args.postIds.length > MAX_POSTS) throw new Error("Send 1 to 25 post IDs to restore.");
  const results = [];
  for (const raw of args.postIds) {
    try {
      const id = postId(raw);
      const rows = await db().query(`update articles a set deleted=false from post_sources p where p.user_id=$1 and p.post_id=$2 and a.user_id=p.user_id and a.id=p.article_id returning a.id,a.source_revision`, [owner, id]);
      results.push({ postId: id, receiptId: "x:" + id, status: rows.length ? "restored" : "not_found", ...(rows.length ? { itemId: rows[0].id, sourceRevision: rows[0].source_revision } : {}) });
    } catch (error) {
      results.push(rejected(raw, error));
    }
  }
  return { results };
}

/** Compatibility adapter for legacy save_text; numeric source identity survives handle aliases. */
export function xPostIdentity(raw: string): { postId: string; handle: string } | null {
  try {
    const u = new URL(raw), match = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/([1-9]\d*)\/?$/) ?? u.pathname.match(/^\/i\/web\/status\/([1-9]\d*)\/?$/);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port || !["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.x.com", "mobile.twitter.com"].includes(u.hostname.toLowerCase()) || !match) return null;
    return match.length === 3 ? { postId: match[2], handle: match[1] } : { postId: match[1], handle: "unknown" };
  } catch { return null; }
}
