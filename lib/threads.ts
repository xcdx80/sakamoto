/** An owner-scoped reading view over individually addressable posts, never a replacement source. */
import type { PostSource } from './bookmarks';
import { revisionUrl } from './source-revision';

import { threadSource, threadSourceSummaries, threadSourceTexts, threadReplyNeighbors, threadOutgoingRelations, THREAD_POST_LIMIT, THREAD_RELATION_LIMIT, type ThreadEdge } from './thread-storage';

export type ThreadPost = { postId: string; itemId: string; role: 'bookmark' | 'context'; sourceRevision: number; savedUrl: string; post: PostSource; relationships: { fromPostId: string; kind: 'reply' | 'quote' }[] };
export type ThreadGap = { kind: 'missing' | 'deleted' | 'unavailable' | 'ambiguous' | 'cyclic' | 'limit' | 'partial' | 'unknown'; postId?: string; fromPostId?: string; relationship?: 'reply' | 'quote'; reason: string };
export type AuthorThread = { posts: ThreadPost[]; context: ThreadPost[]; gaps: ThreadGap[]; ordering: 'reply' | 'uncertain'; conversationComplete: false };
const sameAuthor = (a: PostSource['author'], b: PostSource['author']) => a.id && b.id ? a.id === b.id : a.handle.toLowerCase() === b.handle.toLowerCase();
const compare = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/** At most 100 saved posts/context posts and 100 graph rounds; the limit is explicit in the view. */
export async function readAuthorThread(owner: string, itemId: string, options: { limit?: number } = {}): Promise<AuthorThread | null> {
  const limit = Math.max(1, Math.min(THREAD_POST_LIMIT, Math.floor(options.limit ?? THREAD_POST_LIMIT) || THREAD_POST_LIMIT));
  const start = await threadSource(owner,itemId);
  if (!start) return null;
  if (!start.doc?.post) return { posts: [], context: [], gaps: [{ kind: 'unavailable', postId: start.post_id, reason: 'Structured source text is unavailable. Open the individually saved source to read retained text.' }], ordering: 'uncertain', conversationComplete: false };
  const gaps: ThreadGap[] = [], sources = new Map([[start.post_id, start]]), main = new Set([start.post_id]);
  const edges = new Map<string, ThreadEdge>();
  let frontier = [start.post_id];
  while (frontier.length) {
    const rows = await threadReplyNeighbors(owner,frontier);
    if (rows.length > THREAD_RELATION_LIMIT) gaps.push({ kind: 'limit', reason: 'More reply relationships exist than this reading view can include.' });
    const ids = [...new Set(rows.slice(0,THREAD_RELATION_LIMIT).flatMap((r) => [r.post_id,r.target_post_id]))].filter((id) => !sources.has(id));
    const candidates = (await threadSourceSummaries(owner,ids)).filter((s) => !s.deleted && s.structured && s.author && start.doc?.post && sameAuthor(start.doc.post.author,s.author));
    const available = Math.max(0,limit-sources.size);
    if (candidates.length > available) gaps.push({ kind: 'limit', reason: 'Additional saved posts are outside this bounded reading view.' });
    const added = await threadSourceTexts(owner,candidates.slice(0,available).map((s)=>s.post_id));
    frontier = [];
    for (const s of added) {
      if (!s.doc?.post) continue;
      sources.set(s.post_id,s); main.add(s.post_id); frontier.push(s.post_id);
    }
  }
  // Context follows necessary parent/quote edges only; incoming replies by others never join the view.
  frontier = [...main];
  const visited = new Set<string>();
  while (frontier.length) {
    const batch = frontier.filter((id) => !visited.has(id));
    if (!batch.length) break;
    batch.forEach((id) => visited.add(id));
    const rows = await threadOutgoingRelations(owner,batch);
    if (rows.length > THREAD_RELATION_LIMIT) gaps.push({ kind: 'limit', reason: 'Additional context relationships are outside this bounded view.' });
    rows.slice(0,THREAD_RELATION_LIMIT).forEach((r) => edges.set(`${r.post_id}:${r.kind}:${r.target_post_id}`,r));
    const ids = [...new Set(rows.slice(0,THREAD_RELATION_LIMIT).map((r) => r.target_post_id))].filter((id) => !sources.has(id));
    const candidates = await threadSourceSummaries(owner,ids);
    const found = new Map(candidates.map((s) => [s.post_id,s]));
    const toRead: string[] = [];
    for (const id of ids) {
      const s = found.get(id);
      const relations = rows.filter((r) => r.target_post_id === id);
      if (!s || s.deleted || !s.structured) {
        for (const r of relations) gaps.push({ kind: !s ? 'missing' : s.deleted ? 'deleted' : 'unavailable', postId: id, fromPostId: r.post_id, relationship: r.kind, reason: !s ? 'Referenced post was not supplied to this library.' : s.deleted ? 'Referenced post was removed from this library.' : 'Structured source text is unavailable.' });
      } else if (sources.size + toRead.length >= limit) gaps.push({ kind: 'limit', postId: id, reason: 'Additional context is outside this bounded reading view.' });
      else toRead.push(id);
    }
    frontier = [];
    for (const s of await threadSourceTexts(owner,toRead)) { sources.set(s.post_id,s); frontier.push(s.post_id); }
  }
  const allEdges = [...edges.values()];
  for (const id of sources.keys()) for (const kind of ['reply','quote'] as const) {
    if (allEdges.filter((edge)=>edge.post_id===id && edge.kind===kind).length > 1) gaps.push({kind:'ambiguous',postId:id,relationship:kind,reason:`Conflicting ${kind} observations; supplied relationships are uncertain.`});
  }
  const contextVisiting = new Set<string>(), contextDone = new Set<string>();
  function checkContextCycle(id: string) {
    if (contextDone.has(id)) return;
    if (contextVisiting.has(id)) {
      gaps.push({ kind: 'cyclic', postId: id, reason: 'Supplied context relationships contain a cycle; ordering is uncertain.' });
      return;
    }
    contextVisiting.add(id);
    allEdges.filter((e) => e.post_id === id && sources.has(e.target_post_id)).forEach((e) => checkContextCycle(e.target_post_id));
    contextVisiting.delete(id);
    contextDone.add(id);
  }
  [...sources.keys()].forEach(checkContextCycle);
  const ordered: string[] = [], visiting = new Set<string>(), done = new Set<string>();
  function visit(id: string) {
    if (done.has(id)) return;
    if (visiting.has(id)) { gaps.push({kind:'cyclic',postId:id,reason:'Reply relationships contain a cycle; ordering is uncertain.'}); return; }
    visiting.add(id);
    const parents = allEdges.filter((e) => e.post_id===id && e.kind==='reply');
    parents.filter((e) => main.has(e.target_post_id)).sort((a,b)=>compare(a.target_post_id,b.target_post_id)).forEach((e)=>visit(e.target_post_id));
    visiting.delete(id); done.add(id); ordered.push(id);
  }
  [...main].sort(compare).forEach(visit);
  for (const id of main) {
    const children = allEdges.filter((e) => e.kind==='reply' && e.target_post_id===id && main.has(e.post_id));
    if (children.length > 1) gaps.push({kind:'ambiguous',postId:id,reason:'Replies branch here; sibling order is uncertain.'});
  }
  for (const s of sources.values()) {
    const status = s.doc?.post?.completeness;
    if (!status || status.status !== 'complete') gaps.push({kind:status?.status==='partial'?'partial':'unknown',postId:s.post_id,reason:status?.reason ?? 'Agent did not report full source text.'});
  }
  const present = (id: string): ThreadPost | null => {
    const s = sources.get(id)!;
    return s.doc?.post ? {postId:id,itemId:s.article_id,role:s.role,sourceRevision:s.source_revision,savedUrl:revisionUrl(s.article_id,s.source_revision),post:s.doc.post,relationships:allEdges.filter((e)=>e.target_post_id===id).map((e)=>({fromPostId:e.post_id,kind:e.kind}))} : null;
  };
  return { posts: ordered.map(present).filter((p):p is ThreadPost=>p!==null), context:[...sources.keys()].filter((id)=>!main.has(id)).sort(compare).map(present).filter((p):p is ThreadPost=>p!==null),gaps,ordering:gaps.some((g)=>['ambiguous','cyclic','limit'].includes(g.kind))?'uncertain':'reply',conversationComplete:false };
}
