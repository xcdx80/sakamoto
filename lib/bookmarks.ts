/** Structured source intake. The authenticated caller supplies the owner, never the payload. */
import { threadCoverageOf } from "./thread-coverage";
import { createHash } from "node:crypto";
import { wordCount, type Article } from "./article";
import { db } from "./db";
import { threadSourceSummaries } from "./thread-storage";
import { beginDelivery, finishDelivery } from "./bookmark-deliveries";

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
export type ProcessingState = { classification: "pending" | "complete" | "failed" | "paused" | "uncertain"; classificationMessage?: string; classifier?: Record<string, unknown>; indexing: "pending" | "complete" | "failed" };

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
  only(p, context ? [...fields, "contextPosts", "threadPosts", "threadCoverage"] : fields);
  if (p.contextPosts !== undefined && (!Array.isArray(p.contextPosts) || p.contextPosts.length > 8)) throw new Error("Send at most 8 parent or quote context posts with a bookmark.");
  if (p.threadPosts !== undefined && (!Array.isArray(p.threadPosts) || p.threadPosts.length > 8)) throw new Error("Send at most 8 connected author-thread descendants with a bookmark.");
  if (context) threadCoverageOf(p.threadCoverage);
  const id = postId(p.postId), url = webUrl(p.url);
  if (xPostIdentity(url)?.postId !== id) throw new Error("Post URL must identify the supplied X post ID.");
  const author = object(p.author);
  only(author, ["name", "handle", "id"]);
  const name = string(author.name, "author.name", 200), handle = string(author.handle, "author.handle", 15);
  if (!/^[A-Za-z0-9_]+$/.test(handle)) throw new Error("Expected an X author handle without @.");
  const claim = p.completeness === undefined ? { status: "unknown" } : object(p.completeness);
  only(claim, ["status", "reason"]);
  if (typeof claim.status !== "string" || !["complete", "partial", "unknown"].includes(claim.status)) throw new Error("Completeness must be complete, partial or unknown; it remains agent-reported.");
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

export type BookmarkReceipt = { title?: string; words?: number; completeness?: PostSource["completeness"]; receiptId: string; postId?: string; itemId?: string; sourceRevision?: number; status: "saved" | "incomplete" | "duplicate" | "removed" | "rejected"; reason?: string; processing?: ProcessingState; contextResults?: BookmarkReceipt[]; threadResults?: BookmarkReceipt[] };
const rejected = (raw: unknown, error: unknown): BookmarkReceipt => ({ receiptId: "input:" + createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 24), status: "rejected", reason: error instanceof Error ? error.message : "Unable to save this post; retry it separately." });

async function persistSource(owner: string, source: PostSource, role: "bookmark" | "context"): Promise<BookmarkReceipt> {
  // A post has no inferred document title: every supplied character belongs to its body.
  const blocks: Article["blocks"] = source.fullText.split(/\n\s*\n/).filter((text) => text.trim()).map((text, i) => ({ id: `b${i + 1}`, type: "p", runs: [{ text }] }));
  const a: Article = { origin: "paste", blocks, id: crypto.randomUUID(), title: source.title ?? Array.from(source.fullText.trim()).slice(0, 100).join(""), author: source.author.name, source: "X", sourceUrl: source.url, published: source.publishedAt, contentType: "post", post: source };
  const processing: ProcessingState = { classification: "pending", indexing: "pending" };
  const item = { id: a.id, title: a.title, author: a.author, source: "X", sourceUrl: a.sourceUrl, origin: "paste", contentType: "post", words: wordCount(a), addedAt: Date.now(), addedBy: "agent", addedVia: source.provenance.via, processing, postId: source.postId };
  const rows = await db().query("select intake_bookmark($1,$2,$3,$4::jsonb,$5::jsonb,$6) as receipt", [owner, source.postId, source.url, JSON.stringify(item), JSON.stringify(a), role]);
  return { receiptId: "x:" + source.postId, postId: source.postId, ...rows[0].receipt };
}

/** Only context-role descendants connected to the actual saved bookmark author are admitted.
 * Saved ancestry is bounded by the reader's 100-post depth and 1000 relationship observations.
 */
async function saveThreadPosts(owner:string, root:PostSource, raw:unknown[], via:string, removed:boolean) {
  const parsed=raw.map(value=>{try{return sourceOf(value,via);}catch{return null;}});
  const stored=new Map((await threadSourceSummaries(owner,[root.postId,...parsed.flatMap(p=>p?[p.postId]:[])])).map(p=>[p.post_id,p]));
  const author=stored.get(root.postId)?.author;
  const parents=parsed.flatMap(p=>p?.replyToPostId?[p.replyToPostId]:[]);
  const known=author?await db().query(`with recursive walk(origin,post_id,depth,path) as (
    select p.post_id,p.post_id,0,array[p.post_id] from post_sources p join articles a on a.user_id=p.user_id and a.id=p.article_id
    where p.user_id=$1 and p.post_id=any($2::text[]) and not a.deleted
      and case when a.doc#>>'{post,author,id}' is not null and $3::text is not null then a.doc#>>'{post,author,id}'=$3 else lower(a.doc#>>'{post,author,handle}')=lower($4) end
    union all
    select w.origin,p.post_id,w.depth+1,w.path||p.post_id from walk w join post_relationships r on r.user_id=$1 and r.post_id=w.post_id and r.kind='reply'
    join post_sources p on p.user_id=$1 and p.post_id=r.target_post_id join articles a on a.user_id=p.user_id and a.id=p.article_id
    where w.depth<100 and not p.post_id=any(w.path) and not a.deleted
      and case when a.doc#>>'{post,author,id}' is not null and $3::text is not null then a.doc#>>'{post,author,id}'=$3 else lower(a.doc#>>'{post,author,handle}')=lower($4) end
  ) select origin,post_id from walk limit 1000`,[owner,parents,author.id??null,author.handle]):[];
  const connected=new Set([root.postId,...known.filter(r=>r.post_id===root.postId).map(r=>r.origin)]);
  const same=(p:PostSource)=>{
    const existing=stored.get(p.postId),candidate=existing?.author??p.author;
    return author&&!existing?.deleted&&(!existing||existing.structured)&&candidate&&(author.id&&candidate.id?author.id===candidate.id:author.handle.toLowerCase()===candidate.handle.toLowerCase())&&(author.id&&p.author.id?author.id===p.author.id:author.handle.toLowerCase()===p.author.handle.toLowerCase());
  };
  let changed=true;
  while(changed){changed=false;for(const p of parsed)if(p&&p.postId!==root.postId&&same(p)&&p.replyToPostId&&connected.has(p.replyToPostId)&&!connected.has(p.postId)){connected.add(p.postId);changed=true;}}
  const receipts:BookmarkReceipt[]=[],sources:PostSource[]=[];
  for(let i=0;i<raw.length;i++)try{
    const p=sourceOf(raw[i],via);
    if(removed||p.postId===root.postId||!same(p)||!connected.has(p.postId))throw new Error('Thread context must be a connected same-author descendant of the active saved bookmark. Missing, disconnected, cyclic or over-limit ancestry stays unsaved; report the gap.');
    const r=await persistSource(owner,p,'context');receipts.push(r);
    if(r.status!=='removed')sources.push(p);
  }catch(error){receipts.push(rejected(raw[i],error));}
  return {receipts,sources};
}

export async function importBookmarks(owner: string, args: Record<string, unknown>, via: string) {
  only(args, ["posts", "delivery"]);
  if (!Array.isArray(args.posts) || (!args.posts.length && args.delivery === undefined) || args.posts.length > MAX_POSTS) throw new Error("Send 1 to 25 posts per batch. Resume with the next batch after receiving receipts.");
  if (Buffer.byteLength(JSON.stringify(args), "utf8") > MAX_BATCH_BYTES) throw new Error("Batch exceeds 2 MB; send smaller batches and resume after the returned receipts.");
  const delivery = await beginDelivery(owner, args.posts, via, args.delivery);
  if ("replay" in delivery) return delivery.replay;
  const results: BookmarkReceipt[] = [];
  for (const raw of args.posts) {
    try {
      const source = sourceOf(raw, via, true);
      const receipt = await persistSource(owner, source, "bookmark");
      const threadInputs = object(raw).threadPosts as unknown[] | undefined;
      const coverage = threadCoverageOf(object(raw).threadCoverage);
      if (coverage && receipt.status !== 'removed') await db().query(`update post_sources set thread_coverage=$3::jsonb
        where user_id=$1 and post_id=$2 and (thread_coverage is null or (thread_coverage->>'observedAt')::timestamptz < $4::timestamptz)`,[owner,source.postId,JSON.stringify(coverage),coverage.observedAt]);
      const thread = threadInputs?.length ? await saveThreadPosts(owner,source,threadInputs,via,receipt.status === "removed") : null;
      if (thread) receipt.threadResults = thread.receipts;
      const contexts = object(raw).contextPosts as unknown[] | undefined;
      if (contexts?.length) {
        const reachable = new Set([source.replyToPostId, source.quotedPostId, ...(thread?.sources.flatMap(p=>[p.replyToPostId,p.quotedPostId]) ?? [])].filter(Boolean));
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
  return finishDelivery(owner, delivery, { results, deliveryComplete: false, resume: "Keep each receipt, retry rejected transient failures, and send the next bounded batch. This receipt confirms only the supplied posts, not your complete X bookmark history." });
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
