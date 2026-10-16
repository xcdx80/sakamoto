import { pool, setupPostgres } from './postgres';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createToken } from '../lib/db';
import { makeToken } from '../lib/agent';
import { handle } from '../lib/mcp';
before(setupPostgres);
before(()=>{process.env.DATABASE_URL='isolated-test-adapter-only'; globalThis.fetch=async()=>{throw new Error('Intake must not dispatch a paid provider');};});
after(()=>pool.end());
async function account() {
 const owner='delivery-'+crypto.randomUUID(),token=makeToken();
 await createToken(owner,token.id,token.hash,'Fixture Grok');
 const request=(path:string,body?:unknown)=>new Request('http://localhost'+path,{headers:{authorization:'Bearer '+token.token,'content-type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 const call=async(name:string,args:unknown={})=>{const r=await handle(request('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}));assert.equal(r.status,200);return (await r.json()).result;};
 return {owner,call,request};
}
const post=(postId:string)=>({postId,url:`https://x.com/author/status/${postId}`,text:'Exact original post '+postId,author:{name:'Author',handle:'author'},observedAt:'2026-10-16T12:00:00Z',completeness:{status:'complete'}});
test('an owner resumes acknowledged batches after restart without inflating verified delivery counts or trusting source totals',async()=>{
 const a=await account(),delivery={runId:'initial-archive',batchId:'page-1',checkpoint:'cursor:next-page',status:'more',sourceTotal:1800};
 const first=await a.call('save_bookmarks',{posts:[post('11001'),{...post('11002'),completeness:{status:'partial',reason:'Parent unavailable'}},{...post('11003'),text:''}],delivery});
 assert.equal(first.isError,undefined,JSON.stringify(first));
 assert.deepEqual(first.structuredContent.delivery.counts,{saved:1,incomplete:1,duplicate:0,removed:0,rejected:1});
 assert.equal(first.structuredContent.delivery.safeToAdvance,false);
 const replay=await a.call('save_bookmarks',{posts:[post('11001'),{...post('11002'),completeness:{status:'partial',reason:'Parent unavailable'}},{...post('11003'),text:''}],delivery});
 assert.deepEqual(replay.structuredContent,first.structuredContent);
 const next=await a.call('save_bookmarks',{posts:[post('11001'),post('11004')],delivery:{...delivery,batchId:'page-2',checkpoint:'cursor:page-3'}});
 assert.equal(next.structuredContent.delivery.counts.duplicate,1);
 const checked=await a.call('bookmark_delivery_status'); assert.equal(checked.isError,undefined,JSON.stringify(checked)); const progress=checked.structuredContent;
 assert.equal(progress.verified.batches,2);
 assert.deepEqual(progress.verified.receipts,{saved:2,incomplete:1,duplicate:1,removed:0,rejected:1});
 assert.equal(progress.verified.activeBookmarks,3);
 assert.equal(progress.verified.incompletePosts,1);
 assert.equal(progress.latest.agentReported.sourceTotal,1800);
 assert.equal(progress.latest.agentReported.verification,'agent_reported');
 assert.equal(progress.archiveComplete,false);
 assert.ok(progress.lastDeliveryAt);
 const b=await account();
 assert.equal((await b.call('bookmark_delivery_status')).structuredContent.verified.batches,0);
});

test('empty and blocked source checks remain distinct from real delivery, and conflicting checkpoints cannot overwrite receipts',async()=>{
 const a=await account();
 const empty=await a.call('report_bookmark_run',{runId:'daily-check',batchId:'check-1',status:'no_data',sourceTotal:0});
 assert.equal(empty.isError,undefined,JSON.stringify(empty));
 const status=(await a.call('bookmark_delivery_status')).structuredContent;
 assert.equal(status.lastDeliveryAt,null);
 assert.ok(status.lastContactAt);
 assert.equal(status.verified.activeBookmarks,0);
 const conflict=await a.call('report_bookmark_run',{runId:'daily-check',batchId:'check-1',status:'source_exhausted',sourceTotal:1800});
 assert.equal(conflict.isError,true);
 const bad=await a.call('report_bookmark_run',{runId:'daily-check',batchId:'check-2',status:'blocked'});
 assert.equal(bad.isError,true);
 const blocked=await a.call('report_bookmark_run',{runId:'daily-check',batchId:'check-2',status:'blocked',reason:'X login expired. Owner must reconnect.',checkpoint:'last-acknowledged-post:11004'});
 assert.equal(blocked.isError,undefined);
 const read=await a.call('bookmark_delivery_status',{runId:'daily-check',batchId:'check-1'});
 assert.deepEqual(read.structuredContent.latest.results,[]);
 assert.equal(read.structuredContent.latest.agentReported.status,'no_data');
 const {GET}=await import('../app/api/bookmark-deliveries/route');
 const web=await GET(a.request('/api/bookmark-deliveries'));
 assert.equal(web.status,200);
 assert.equal(web.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await web.json(),(await a.call('bookmark_delivery_status')).structuredContent);
 const wrong=new Request('http://localhost/api/bookmark-deliveries',{headers:{authorization:a.request('/').headers.get('authorization')!,'X-Sakamoto-Owner':'somebody-else'}});
 assert.equal((await GET(wrong)).status,401);
});

test('prepared workflow advertises real bounded schemas, blocks local cloud setup and keeps routines explicitly unexecuted',async()=>{
 const a=await account();
 const {GET}=await import('../app/api/bookmark-workflow/route');
 const local=await GET(a.request('/api/bookmark-workflow'));
 assert.equal(local.status,200);
 const prepared=await local.json();
 assert.equal(prepared.endpoint,null);
 assert.equal(prepared.remoteReady,false);
 assert.match(prepared.workflow,/save_bookmarks/);
 assert.match(prepared.workflow,/report_bookmark_run/);
 assert.match(prepared.workflow,/bookmark_delivery_status/);
 assert.match(prepared.workflow,/word for word, not a summary/);
 assert.match(prepared.workflow,/four delivery batches/);
 assert.match(prepared.routine,/Europe\/Lisbon/);
 assert.match(prepared.routine,/not yet configured or tested/);
 assert.doesNotMatch(prepared.workflow+prepared.routine,/reader approves the sample|Stop for the reader to inspect|explicitly approves enabling/);
 assert.match(prepared.workflow,/already reader-authorized/);
 const remote=await GET(new Request('https://library.example.org/api/bookmark-workflow',{headers:{authorization:a.request('/').headers.get('authorization')!}}));
 assert.equal((await remote.json()).endpoint,'https://library.example.org/mcp');
 const instructions=await a.call('bookmark_workflow');
 assert.equal(instructions.isError,undefined);
 assert.match(instructions.structuredContent.connectionNotice,/publicly reachable HTTPS/);
 const listed=await handle(a.request('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'}));
 const tools=(await listed.json()).result.tools;
 const save=tools.find((t:any)=>t.name==='save_bookmarks');
 assert.equal(save.inputSchema.properties.posts.maxItems,25);
 assert.equal(save.inputSchema.properties.delivery.properties.sourceTotal.description,'Agent-reported upstream count, not a verified recovered total.');
 assert.ok(tools.some((t:any)=>t.name==='report_bookmark_run'));
});

test('concurrent replay and reordered JSON keys cannot inflate a stable batch acknowledgement',async()=>{
 const a=await account(),p=post('11201'),delivery={runId:'overlap',batchId:'one',status:'more'};
 const args={posts:[p],delivery};
 const attempts=await Promise.all(Array.from({length:4},()=>a.call('save_bookmarks',args)));
 const success=attempts.find(r=>!r.isError);assert.ok(success);
 const reordered=await a.call('save_bookmarks',{delivery:{status:'more',batchId:'one',runId:'overlap'},posts:[{author:p.author,text:p.text,url:p.url,postId:p.postId,completeness:p.completeness,observedAt:p.observedAt}]});
 assert.equal(reordered.isError,undefined,JSON.stringify(reordered));
 assert.deepEqual(reordered.structuredContent,success.structuredContent);
 const progress=(await a.call('bookmark_delivery_status')).structuredContent;
 assert.equal(progress.verified.batches,1);
 assert.equal(progress.verified.receipts.saved,1);
 assert.equal(progress.verified.activeBookmarks,1);
});

test('a ten-post mixed delivery survives link failures and advances bounded processing independently of Grok discovery',async()=>{
 const {configureArticleFetch}=await import('../lib/fetch-article');
 const {textPdf}=await import('./pdf-fixtures');
 configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>url.pathname==='/broken'?new Response('Temporarily unavailable',{status:503}):url.pathname==='/paper.pdf'?new Response(textPdf(['Mixed sample physical page one.','Mixed sample page two.']),{headers:{'content-type':'application/pdf'}}):new Response('<html><head><title>Sample linked article</title></head><body><article><h1>Sample linked article</h1><p>'+('Directly linked readable original article text. '.repeat(60))+'</p></article></body></html>',{headers:{'content-type':'text/html'}})});
 try{
  const a=await account();
  const posts=Array.from({length:10},(_,i)=>({...post(String(11300+i)),links:[`https://public.example/${i===0?'paper.pdf':i===1?'broken':'article-'+i}`]}));
  posts[2].text='Long expanded post. '+ 'Full source line. '.repeat(3000);
  const args={posts,delivery:{runId:'mixed-sample',batchId:'sample-1',status:'more',checkpoint:'after:11309',sourceTotal:1800}};
  const saved=(await a.call('save_bookmarks',args)).structuredContent;
  assert.equal(saved.delivery.counts.saved,10);
  const {GET}=await import('../app/api/articles/[id]/route');
  for(let i=0;i<posts.length;i++){
   const id=saved.results[i].itemId;
   const read=await GET(a.request('/api/articles/'+id),{params:Promise.resolve({id})});
   const doc=(await read.json()).doc;
   assert.equal(doc.post.postId,posts[i].postId);assert.equal(doc.post.fullText,posts[i].text);
  }
  const duplicate=await a.call('save_bookmarks',{posts,delivery:{...args.delivery,batchId:'sample-repeat'}});
  assert.equal(duplicate.structuredContent.delivery.counts.duplicate,10);
  assert.deepEqual(duplicate.structuredContent.results.map((r:any)=>r.itemId),saved.results.map((r:any)=>r.itemId));
  const first=(await a.call('process_library',{limit:4})).structuredContent;
  assert.ok(first.processed<=4);
  let progress=(await a.call('bookmark_delivery_status')).structuredContent;
  assert.ok(progress.verified.processing.pending>0);
  assert.equal(progress.verified.activeBookmarks,10);
  for(let i=0;i<3;i++){const r=(await a.call('process_library',{limit:4})).structuredContent;assert.ok(r.processed<=4);}
  const jobs=(await a.call('processing_status')).structuredContent.jobs;
  const pdf=jobs.find((j:any)=>j.target.endsWith('/paper.pdf'));
  assert.equal(pdf.state,'complete');
  const pdfRead=await GET(a.request('/api/articles/'+pdf.resultItemId),{params:Promise.resolve({id:pdf.resultItemId})});
  assert.deepEqual((await pdfRead.json()).doc.blocks.filter((b:any)=>b.type!=='note').map((b:any)=>b.page),[1,2]);
  assert.equal(jobs.find((j:any)=>j.target.endsWith('/broken')).state,'retryable');
  progress=(await a.call('bookmark_delivery_status')).structuredContent;
  assert.equal(progress.verified.activeBookmarks,10);
  assert.equal(progress.verified.receipts.duplicate,10);
  assert.equal(progress.archiveComplete,false);
 }finally{configureArticleFetch({});}
});

test('bookmarked thread roots accept only connected same-author descendants as context and resume beyond one bounded batch',async()=>{
 const a=await account(),root=post('11400');
 const child={...post('11401'),replyToPostId:'11400',quotedPostId:'11499'};
 const grandchild={...post('11402'),replyToPostId:'11401'};
 const wrongAuthor={...post('11403'),replyToPostId:'11400',author:{name:'Other',handle:'other'}};
 const disconnected={...post('11404'),replyToPostId:'999999'};
 const result=(await a.call('save_bookmarks',{posts:[{...root,threadPosts:[grandchild,wrongAuthor,child,disconnected]}]})).structuredContent;
 assert.equal(result.results[0].status,'saved');
 assert.deepEqual(result.results[0].threadResults.map((r:any)=>r.status),['saved','rejected','saved','rejected']);
 assert.equal(result.delivery.contextCounts.saved,2);
 assert.equal(result.delivery.contextCounts.rejected,2);
 assert.equal(result.delivery.safeToAdvance,false);
 const {GET}=await import('../app/api/articles/[id]/thread/route');
 const id=result.results[0].itemId;
 const read=await GET(a.request('/api/articles/'+id+'/thread'),{params:Promise.resolve({id})});
 const view=await read.json();
 assert.deepEqual(view.posts.map((r:any)=>r.postId),['11400','11401','11402']);
 assert.deepEqual(view.posts.map((r:any)=>r.role),['bookmark','context','context']);
 assert.ok(view.gaps.some((g:any)=>g.kind==='missing'&&g.postId==='11499'));
 const resumed=(await a.call('save_bookmarks',{posts:[{...root,threadPosts:[{...post('11405'),replyToPostId:'11402'}]}]})).structuredContent;
 assert.equal(resumed.results[0].status,'duplicate');
 assert.equal(resumed.results[0].threadResults[0].status,'saved');
 const progress=(await a.call('bookmark_delivery_status')).structuredContent;
 assert.equal(progress.verified.activeBookmarks,1);
 assert.equal(progress.verified.activeContextPosts,3);
 const b=await account();
 assert.equal((await GET(b.request('/api/articles/'+id+'/thread'),{params:Promise.resolve({id})})).status,404);
 const malformed=await a.call('save_bookmarks',{posts:[{...post('11420'),threadPosts:Array.from({length:9},()=>child)}]});
 assert.equal(malformed.structuredContent.results[0].status,'rejected');
});

test('known source attribution cannot be rewritten to smuggle another author into an imported thread',async()=>{
 const a=await account();
 const stranger={...post('11501'),author:{name:'Other author',handle:'other'}};
 await a.call('save_bookmarks',{posts:[stranger]});
 const result=(await a.call('save_bookmarks',{posts:[{...post('11500'),threadPosts:[{...post('11501'),replyToPostId:'11500'},{...post('11502'),replyToPostId:'11501'}]}]})).structuredContent;
 assert.deepEqual(result.results[0].threadResults.map((r:any)=>r.status),['rejected','rejected']);
 assert.equal((await a.call('bookmark_delivery_status')).structuredContent.verified.activeContextPosts,0);
});

test('MCP compares full saved posts without revealing connector credentials or substituting excerpts',async()=>{
 const a=await account(),text='  # Literal source 🐈\n\n'+('日本語の原文と exact lines. '.repeat(12000))+'\n  Final source spaces.  ';
 const input={...post('11601'),text,quotedPostId:'11699',completeness:{status:'partial',reason:'Quoted source unavailable'}};
 const receipt=(await a.call('save_bookmarks',{posts:[input]})).structuredContent.results[0];
 const first=await a.call('read_saved_source',{itemId:receipt.itemId});
 assert.equal(first.isError,undefined,JSON.stringify(first));
 assert.equal(first.structuredContent.status,'found');
 assert.equal(first.structuredContent.itemId,receipt.itemId);
 assert.equal(first.structuredContent.sourceRevision,receipt.sourceRevision);
 assert.equal(first.structuredContent.post.fullText,text);
 assert.equal(first.structuredContent.post.postId,'11601');
 assert.equal(first.structuredContent.post.author.handle,'author');
 assert.equal(first.structuredContent.post.completeness.status,'partial');
 assert.equal(first.structuredContent.post.completeness.verification,'agent_reported');
 assert.ok(Buffer.byteLength(JSON.stringify(first),'utf8')<2000000);
 const pinned=await a.call('read_saved_source',{itemId:receipt.itemId,revision:receipt.sourceRevision});
 assert.deepEqual(pinned.structuredContent,first.structuredContent);
 const b=await account();
 assert.equal((await b.call('read_saved_source',{itemId:receipt.itemId})).structuredContent.status,'not_found');
 assert.equal((await a.call('read_saved_source',{itemId:'missing'})).structuredContent.status,'not_found');
 assert.equal((await a.call('read_saved_source',{itemId:receipt.itemId,revision:999999})).structuredContent.status,'not_found');
 for(const args of [{itemId:receipt.itemId,revision:0},{itemId:'x'.repeat(201)},{itemId:receipt.itemId,owner:b.owner},{itemId:receipt.itemId,offset:2}])assert.equal((await a.call('read_saved_source',args)).isError,true);
 const {GET:pull,POST:push}=await import('../app/api/sync/route');
 const rows=await (await pull(a.request('/api/sync'))).json();
 const row=rows.changes.articles.find((r:any)=>r.id===receipt.itemId);
 assert.equal((await push(a.request('/api/sync',{changes:{articles:[{id:receipt.itemId,articleId:receipt.itemId,revision:row.revision,data:row.data,deleted:true}]}}))).status,200);
 assert.equal((await a.call('read_saved_source',{itemId:receipt.itemId,revision:receipt.sourceRevision})).structuredContent.status,'not_found');
 const workflow=(await a.call('bookmark_workflow')).structuredContent.workflow;
 assert.match(workflow,/read_saved_source/);
 assert.doesNotMatch(workflow,/GET \/api\/articles/);
});

test('MCP bearer credentials cannot list, mint or revoke browser connection credentials',async()=>{
 const a=await account();
 const {GET,POST,DELETE}=await import('../app/api/agent-tokens/route');
 for(const response of [await GET(a.request('/api/agent-tokens')),await POST(a.request('/api/agent-tokens',{label:'Not authorized'})),await DELETE(a.request('/api/agent-tokens?id=anything'))])assert.equal(response.status,401);
 const stillAuthenticated=await a.call('bookmark_delivery_status');
 assert.equal(stillAuthenticated.isError,undefined);
});

test('source comparison explicitly bounds legacy records and pins historical text only while its item is active',async()=>{
 const a=await account();
 const {GET:pull,POST:push}=await import('../app/api/sync/route');
 const id='legacy-source-read';
 const source={postId:'11701',url:'https://x.com/author/status/11701',fullText:'大'.repeat(700000),author:{name:'Author',handle:'author'},observedAt:'2026-10-16T12:00:00Z',links:[],completeness:{status:'unknown',verification:'agent_reported'},provenance:{via:'Legacy browser',receivedAt:'2026-10-16T12:00:00Z'}};
 const doc={id,title:'Legacy source',origin:'paste',contentType:'post',post:source,blocks:[]};
 const data={id,title:'Legacy source',origin:'paste',contentType:'post',words:1};
 const saved=await push(a.request('/api/sync',{changes:{articles:[{id,articleId:id,revision:0,data,doc}]}}));
 assert.equal(saved.status,200);assert.equal((await saved.json()).ok,true);
 const bounded=(await a.call('read_saved_source',{itemId:id})).structuredContent;
 assert.equal(bounded.status,'too_large');
 assert.equal(bounded.post,undefined);
 assert.ok(Buffer.byteLength(JSON.stringify(bounded),'utf8')<1000);
 const row=(await (await pull(a.request('/api/sync'))).json()).changes.articles.find((r:any)=>r.id===id);
 const changed=await push(a.request('/api/sync',{changes:{articles:[{id,articleId:id,revision:row.revision,sourceRevision:1,data:row.data,doc:{...doc,post:{...source,fullText:'Exact revised text.'}}}]}}));
 assert.equal((await changed.json()).ok,true);
 const current=(await a.call('read_saved_source',{itemId:id})).structuredContent;
 assert.equal(current.status,'found');assert.equal(current.sourceRevision,2);assert.equal(current.post.fullText,'Exact revised text.');
 assert.equal((await a.call('read_saved_source',{itemId:id,revision:1})).structuredContent.status,'too_large');
 const active=(await (await pull(a.request('/api/sync'))).json()).changes.articles.filter((r:any)=>r.id===id).at(-1);
 await push(a.request('/api/sync',{changes:{articles:[{id,articleId:id,revision:active.revision,data:active.data,deleted:true}]}}));
 assert.equal((await a.call('read_saved_source',{itemId:id,revision:1})).structuredContent.status,'not_found');
 const article='nonpost-source';
 await push(a.request('/api/sync',{changes:{articles:[{id:article,articleId:article,data:{id:article,title:'Article',origin:'paste',contentType:'article'},doc:{id:article,title:'Article',origin:'paste',blocks:[]}}]}}));
 assert.equal((await a.call('read_saved_source',{itemId:article})).structuredContent.status,'unsupported');
});

test('source comparison is one bounded MCP response rather than an unbounded JSON-RPC fanout',async()=>{
 const a=await account();
 const messages=Array.from({length:2},(_,i)=>({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name:'read_saved_source',arguments:{itemId:'missing'}}}));
 const response=await handle(a.request('/mcp',messages));
 assert.equal(response.status,400);
 assert.match((await response.json()).error.message,/one saved source per MCP request/);
});
