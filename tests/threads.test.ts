import { pool, setupPostgres } from './postgres';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createToken } from '../lib/db';
import { makeToken } from '../lib/agent';
import { handle } from '../lib/mcp';

before(setupPostgres);
after(() => pool.end());
const post = (postId: string, extra: Record<string, unknown> = {}) => ({ postId, url: `https://x.com/alice/status/${postId}`, text: `Original post ${postId}.`, author: { name: 'Alice', handle: 'alice', id: '42' }, observedAt: '2026-10-16T10:00:00Z', completeness: { status: 'complete' }, ...extra });
async function account() {
  const owner = 'threads-' + crypto.randomUUID(), token = makeToken();
  await createToken(owner, token.id, token.hash, 'Thread fixture');
  process.env.DATABASE_URL = 'test-configured-adapter-only';
  const req = (path: string, body?: unknown) => new Request('http://localhost' + path, { headers: { authorization: 'Bearer ' + token.token, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  return {
    req,
    async save(posts: unknown[]) {
      const response = await handle(req('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_bookmarks', arguments: { posts } } }));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.ok(!body.result.isError, JSON.stringify(body));
      return body.result.structuredContent.results;
    },
    async read(id: string, limit = 100) {
      const { GET } = await import('../app/api/articles/[id]/thread/route');
      return GET(req(`/api/articles/${id}/thread?limit=${limit}`), { params: Promise.resolve({ id }) });
    },
  };
}

test('reader orders available same-author replies, labels attributed quote context and a missing parent', async () => {
  const a = await account();
  const [third, second] = await a.save([
    post('103', { replyToPostId: '102', quotedPostId: '200', contextPosts: [post('200', { author: { name: 'Bob', handle: 'bob', id: '77' } }), post('999')] }),
    post('102', { replyToPostId: '101' }),
  ]);
  const response = await a.read(third.itemId);
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.deepEqual(view.posts.map((p: any) => p.postId), ['102', '103']);
  assert.deepEqual(view.posts.map((p: any) => p.role), ['bookmark', 'bookmark']);
  assert.equal(view.posts[0].itemId, second.itemId);
  assert.equal(view.posts[0].savedUrl, `/read/${second.itemId}?revision=1`);
  assert.equal(view.context[0].post.author.name, 'Bob');
  assert.equal(view.context[0].role, 'context');
  assert.deepEqual(view.context[0].relationships, [{ fromPostId: '103', kind: 'quote' }]);
  assert.ok(view.gaps.some((g: any) => g.kind === 'missing' && g.postId === '101'));
  assert.equal(view.conversationComplete, false);
  assert.equal(view.posts.some((p: any) => p.postId === '999'), false);
});

test('reader explicitly marks cycles in attributed context instead of suggesting a complete order', async () => {
  const a = await account();
  const bob = { name: 'Bob', handle: 'bob', id: '77' };
  const [saved] = await a.save([post('301', { quotedPostId: '302', contextPosts: [post('302', { author: bob, replyToPostId: '303' }), post('303', { author: bob, replyToPostId: '302' })] })]);
  const view = await (await a.read(saved.itemId)).json();
  assert.deepEqual(view.posts.map((p: any) => p.postId), ['301']);
  assert.deepEqual(view.context.map((p: any) => p.postId), ['302', '303']);
  assert.ok(view.gaps.some((g: any) => g.kind === 'cyclic'));
  assert.equal(view.ordering, 'uncertain');
});

test('later overlap and supplied parents extend reply relationships without rewriting source or annotations', async () => {
  const a = await account();
  const [saved] = await a.save([post('403')]);
  const { GET: pull, POST: push } = await import('../app/api/sync/route');
  const first = (await (await pull(a.req('/api/sync'))).json()).changes.articles.at(-1);
  const anchor = { start: { b: 'b1', o: 0 }, end: { b: 'b1', o: 18 }, quote: 'Original post 403.' };
  const changes = {
    articles: [{ id: saved.itemId, articleId: saved.itemId, revision: first.revision, data: { ...first.data, title: 'My thread title', tags: ['saved'], topic: 'science' }, changedFields: ['title', 'tags', 'topic'] }],
    highlights: [{ id: 'highlight', articleId: saved.itemId, data: { anchor, note: 'Keep my note', sourceRevision: 1 } }],
    glosses: [{ id: 'note', articleId: saved.itemId, data: { anchor, turns: [{ content: 'My question' }], sourceRevision: 1 } }],
  };
  assert.equal((await (await push(a.req('/api/sync', { changes }))).json()).ok, true);
  await a.save([post('403', { text: 'A retry must not replace source text.', replyToPostId: '402' })]);
  const partial = await (await a.read(saved.itemId)).json();
  assert.ok(partial.gaps.some((g: any) => g.kind === 'missing' && g.postId === '402'));
  await a.save([post('403', { replyToPostId: '402', contextPosts: [post('402', { replyToPostId: '401' }), post('401')] })]);
  await a.save([post('402', { replyToPostId: '401' }), post('403', { replyToPostId: '402' })]);
  const complete = await (await a.read(saved.itemId)).json();
  assert.deepEqual(complete.posts.map((p: any) => p.postId), ['401', '402', '403']);
  assert.equal(complete.posts.at(-1).post.fullText, 'Original post 403.');
  assert.equal(complete.posts.at(-1).sourceRevision, 1);
  assert.deepEqual(complete.gaps, []);
  assert.deepEqual(complete.posts.map((p: any) => p.role), ['context', 'bookmark', 'bookmark']);
  const after = (await (await pull(a.req('/api/sync'))).json()).changes;
  assert.equal(after.articles.filter((row: any) => row.id === saved.itemId).at(-1).data.title, 'My thread title');
  assert.equal(after.highlights.at(-1).data.note, 'Keep my note');
  assert.equal(after.glosses.at(-1).data.turns[0].content, 'My question');
  const other = await account();
  assert.equal((await other.read(saved.itemId)).status, 404);
});

test('bounded views report omitted saved relationships as limits rather than fabricated missing sources', async () => {
  const a = await account();
  const [saved] = await a.save([post('500'), post('501'), post('502'), post('503')]);
  for (const parent of ['501', '502', '503']) await a.save([post('500', { replyToPostId: parent })]);
  const view = await (await a.read(saved.itemId, 1)).json();
  assert.equal(view.posts.length + view.context.length, 1);
  assert.ok(view.gaps.some((g: any) => g.kind === 'limit'));
  assert.equal(view.gaps.some((g: any) => g.kind === 'missing'), false);
  assert.ok(view.gaps.some((g: any) => g.kind === 'ambiguous'));
  assert.equal(view.ordering, 'uncertain');
});

test('reply branches and conflicting observations stay explicit while unrelated authors and conversation IDs do not join', async () => {
  const a = await account();
  const [saved] = await a.save([
    post('601', { conversationId: '601' }),
    post('602', { replyToPostId: '601', conversationId: '601' }),
    post('603', { replyToPostId: '601', conversationId: '601' }),
    post('604', { replyToPostId: '601', author: { name: 'Other', handle: 'other', id: '77' } }),
    post('605', { conversationId: '601' }),
  ]);
  const branched = await (await a.read(saved.itemId)).json();
  assert.deepEqual(branched.posts.map((p: any) => p.postId), ['601','602','603']);
  assert.ok(branched.gaps.some((g: any) => g.kind === 'ambiguous' && g.postId === '601'));
  await a.save([post('601', { replyToPostId: '603' })]);
  const cycle = await (await a.read(saved.itemId)).json();
  assert.equal(cycle.ordering, 'uncertain');
  assert.ok(cycle.gaps.some((g: any) => g.kind === 'cyclic'));
  assert.equal(new Set(cycle.posts.map((p: any)=>p.postId)).size,3);
});

test('removed and unavailable context have honest gaps and never expose removed text', async () => {
  const a = await account();
  const [saved, parent] = await a.save([post('703',{replyToPostId:'702'}),post('702')]);
  const { GET: pull, POST: push } = await import('../app/api/sync/route');
  const rows = (await (await pull(a.req('/api/sync'))).json()).changes.articles;
  const current = rows.find((row: any)=>row.id===parent.itemId);
  assert.equal((await (await push(a.req('/api/sync',{changes:{articles:[{id:parent.itemId,articleId:parent.itemId,revision:current.revision,deleted:true,data:{}}]}}))).json()).ok,true);
  const removed = await (await a.read(saved.itemId)).json();
  assert.ok(removed.gaps.some((g: any)=>g.kind==='deleted'&&g.postId==='702'));
  assert.equal(removed.posts.some((p: any)=>p.postId==='702'),false);
  assert.equal((await a.read(parent.itemId)).status,404);
  const legacyId = crypto.randomUUID();
  await push(a.req('/api/sync',{changes:{articles:[{id:legacyId,articleId:legacyId,data:{id:legacyId,title:'Legacy',sourceUrl:'https://x.com/old/status/701'},doc:{id:legacyId,title:'Legacy',origin:'paste',sourceUrl:'https://x.com/old/status/701',blocks:[{id:'b1',type:'p',runs:[{text:'Legacy text remains separate.'}]}]}}]}}));
  await a.save([post('701'),post('703',{quotedPostId:'701',completeness:{status:'partial',reason:'Source unavailable'}})]);
  const unavailable = await (await a.read(saved.itemId)).json();
  assert.ok(unavailable.gaps.some((g: any)=>g.kind==='unavailable'&&g.postId==='701'));
  const legacy = await (await a.read(legacyId)).json();
  assert.ok(legacy.gaps.some((g: any)=>g.kind==='unavailable'&&g.postId==='701'));
});

test('contradictory quote observations remain attributed and explicitly uncertain', async () => {
  const a = await account();
  const [saved] = await a.save([post('801', { quotedPostId: '802', contextPosts: [post('802', { author: { name: 'Bob', handle: 'bob', id: '77' } })] })]);
  await a.save([post('801', { quotedPostId: '803', contextPosts: [post('803', { author: { name: 'Carol', handle: 'carol', id: '88' } })] })]);
  const view = await (await a.read(saved.itemId)).json();
  assert.deepEqual(view.context.map((p: any)=>p.post.author.name), ['Bob','Carol']);
  assert.ok(view.gaps.some((g: any)=>g.kind==='ambiguous'&&g.postId==='801'&&g.relationship==='quote'));
  assert.equal(view.ordering,'uncertain');
});

test('authenticated thread reads keep equal provider IDs private and reject an invalid or mismatched identity', async () => {
  const a = await account(), b = await account();
  const [saved] = await a.save([post('901', { replyToPostId: '902', completeness: { status: 'partial', reason: 'Only the supplied portion is available.' } })]);
  await b.save([post('902')]);
  const view = await (await a.read(saved.itemId)).json();
  assert.deepEqual(view.posts.map((p: any)=>p.postId),['901']);
  assert.ok(view.gaps.some((g: any)=>g.kind==='missing'&&g.postId==='902'));
  assert.ok(view.gaps.some((g: any)=>g.kind==='partial'&&g.reason==='Only the supplied portion is available.'));
  const { GET } = await import('../app/api/articles/[id]/thread/route');
  assert.equal((await GET(new Request('http://localhost/api/articles/'+saved.itemId+'/thread',{headers:{authorization:'Bearer invalid'}}),{params:Promise.resolve({id:saved.itemId})})).status,401);
  const mismatched = a.req('/api/articles/'+saved.itemId+'/thread');
  mismatched.headers.set('x-sakamoto-owner','some-other-account');
  assert.equal((await GET(mismatched,{params:Promise.resolve({id:saved.itemId})})).status,401);
});
