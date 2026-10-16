import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, setupPostgres } from './postgres';
import { createToken } from '../lib/db';
import { makeToken } from '../lib/agent';
import { handle } from '../lib/mcp';
import { configureArticleFetch } from '../lib/fetch-article';
import { textPdf } from './pdf-fixtures';
before(setupPostgres);
after(() => pool.end());
async function account() {
  const owner='pdf-'+crypto.randomUUID(),token = makeToken(); await createToken(owner, token.id, token.hash, 'PDF fixture');
  process.env.DATABASE_URL = 'test-adapter-only';
  const request = (path: string, body?: unknown) => new Request('http://localhost' + path, { headers: {authorization: 'Bearer ' + token.token, 'content-type': 'application/json'}, ...(body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)}) });
  const call = async (name: string, args: unknown = {}) => {
    const response = await handle(request('/mcp', {jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}));
    const result = (await response.json()).result; assert.equal(result.isError, undefined, JSON.stringify(result)); return result.structuredContent;
  };
  const save = async (postId: string, links: string[]) => call('save_bookmarks', {posts:[{postId,url:`https://x.com/a/status/${postId}`,text:'Saved knowledge with directly linked material.',author:{name:'A',handle:'a'},observedAt:'2026-10-16T10:00:00Z',links}]});
  const read = async (id: string) => { const {GET} = await import('../app/api/articles/[id]/route'); const r = await GET(request('/api/articles/'+id), {params:Promise.resolve({id})}); assert.equal(r.status,200); return (await r.json()).doc; };
  const processLinks = async (args: unknown = {}) => { const result = await call("process_library",args); return {...result,jobs:result.jobs.filter((job:any)=>job.kind==="link")}; };
  return {owner,call,save,read,request,processLinks};
}
test('unattended linked PDF becomes durable page-addressed text and shared discoveries reuse its identity', async () => {
  const bytes = textPdf(['First page text is retained for citations.', 'Second page has its own physical address.']);
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(bytes,{headers:{'content-type':'application/pdf'}})});
  const a = await account(); await a.save('701',['https://public.example/paper.pdf']); await a.save('702',['https://public.example/paper.pdf?utm_source=x']);
  const result = await a.processLinks();
  assert.deepEqual(result.jobs.map((j:any)=>j.state),['complete','complete']);
  assert.equal(new Set(result.jobs.map((j:any)=>j.resultItemId)).size,1);
  const id = result.jobs[0].resultItemId, doc = await a.read(id);
  assert.equal(doc.contentType,'document'); assert.deepEqual(doc.blocks.filter((b:any)=>b.type!=='note').map((b:any)=>b.page),[1,2]);
  assert.match(doc.blocks.find((b:any)=>b.page===2).runs[0].text,/Second page/);
  assert.equal(doc.pdfSource.status,'complete'); assert.equal(doc.pdfSource.totalPages,2);
  const {GET} = await import('../app/api/articles/[id]/discoveries/route');
  assert.equal((await (await GET(a.request('/api/articles/'+id+'/discoveries'), {params:Promise.resolve({id})})).json()).sources.length,2);
  configureArticleFetch({request:async()=>{throw new Error('Original source now inaccessible');}});
  assert.match((await a.read(id)).blocks[0].runs[0].text,/First page/);
  assert.equal((await a.processLinks()).processed,0);
  configureArticleFetch({});
});

test('scanned and encrypted links remain honest failures while other links and bookmarked text survive', async () => {
  const {scanPdf} = await import('./pdf-fixtures');
  const {readFile} = await import('node:fs/promises');
  const encrypted = await readFile(new URL('./fixtures/password.pdf', import.meta.url));
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>new Response(url.pathname==='/scan.pdf'?scanPdf():url.pathname==='/password.pdf'?encrypted:textPdf(['Readable document alongside unsupported sources.']),{headers:{'content-type':'application/pdf'}})});
  const a = await account(); await a.save('703',['https://public.example/scan.pdf','https://public.example/password.pdf','https://public.example/good.pdf']);
  const result = await a.processLinks();
  const scan = result.jobs.find((j:any)=>j.target.endsWith('/scan.pdf')), locked = result.jobs.find((j:any)=>j.target.endsWith('/password.pdf'));
  assert.equal(scan.state,'terminal'); assert.match(scan.error,/no readable text layer/);
  assert.equal(locked.state,'terminal'); assert.match(locked.error,/encrypted|password/);
  assert.equal(result.jobs.find((j:any)=>j.target.endsWith('/good.pdf')).state,'complete');
  const shelf=(await a.call('search_library')).results; assert.equal(shelf.length,2);
  assert.match((await a.read(shelf.find((s:any)=>s.contentType==='post').itemId)).post.fullText,/Saved knowledge/);
  configureArticleFetch({});
});

test('reader-supplied text recovers an unsupported linked PDF with its existing discovery and cannot overwrite it on replay', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(scanPdf(),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('704',['https://public.example/recover.pdf']);
  const job=(await a.processLinks()).jobs[0]; assert.equal(job.state,'terminal');
  const supplied=await a.call('supply_link_text',{jobId:job.id,title:'Recovered source',text:'This is manually extracted source text, with no invented page numbers.'});
  assert.ok(supplied.itemId); const doc=await a.read(supplied.itemId);
  assert.equal(doc.sourceUrl,'https://public.example/recover.pdf'); assert.equal(doc.contentType,'document'); assert.equal(doc.pdfSource.extractor,'reader-supplied-text');
  assert.equal(doc.blocks[0].page,undefined); assert.match(doc.blocks[0].runs[0].text,/manually extracted/);
  const again=await a.call('supply_link_text',{jobId:job.id,text:'Different replacement must not overwrite the saved source.'});
  assert.equal(again.itemId,supplied.itemId); assert.match((await a.read(again.itemId)).blocks[0].runs[0].text,/manually extracted/);
  const {GET}=await import('../app/api/articles/[id]/discoveries/route');
  assert.equal((await (await GET(a.request('/api/articles/'+supplied.itemId+'/discoveries'),{params:Promise.resolve({id:supplied.itemId})})).json()).sources.length,1);
  const other=await account();
  const {POST}=await import('../app/api/processing/recover/route');
  assert.equal((await POST(other.request('/api/processing/recover',{jobId:job.id,text:'This owner cannot recover another person source.'}))).status,409);
  configureArticleFetch({});
});

test('long and mixed scanned PDFs expose partial page coverage without fabricating missing page text', async () => {
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>new Response(url.pathname==='/long.pdf'?textPdf(Array.from({length:81},(_,i)=>`Physical page ${i+1} source text.`)):textPdf(['Readable first page.', '']),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('705',['https://public.example/long.pdf','https://public.example/mixed.pdf']);
  const result=await a.processLinks();
  const long=await a.read(result.jobs.find((j:any)=>j.target.endsWith('/long.pdf')).resultItemId);
  assert.equal(long.pdfSource.totalPages,81); assert.equal(long.pdfSource.status,'partial'); assert.equal(long.pdfSource.parsedPages.length,80);
  assert.equal(long.blocks.some((b:any)=>b.page===81),false); assert.match(long.blocks[0].runs[0].text,/80 of 81/);
  const mixed=await a.read(result.jobs.find((j:any)=>j.target.endsWith('/mixed.pdf')).resultItemId);
  assert.equal(mixed.pdfSource.status,'partial'); assert.deepEqual(mixed.pdfSource.missingPages,[2]); assert.match(mixed.blocks[0].runs[0].text,/Unreadable pages: 2/);
  configureArticleFetch({});
});

test('a configured shorter PDF deadline terminates extraction, keeps the link retryable and permits a successful explicit retry', async () => {
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(textPdf(['A source retried after a bounded worker interruption.']),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('706',['https://public.example/timeout.pdf']);
  process.env.PDF_EXTRACTION_TIMEOUT_MS='1';
  const started=Date.now(), failed=(await a.processLinks()).jobs[0];
  delete process.env.PDF_EXTRACTION_TIMEOUT_MS;
  assert.equal(failed.state,'retryable'); assert.match(failed.error,/timed out/); assert.ok(Date.now()-started<2000);
  const retried=(await a.processLinks({retryJobId:failed.id})).jobs[0]; assert.equal(retried.state,'complete');
  assert.match((await a.read(retried.resultItemId)).blocks[0].runs[0].text,/source retried/);
  configureArticleFetch({});
});

test('PDF signature detection accepts bounded octet-stream downloads and stops oversized streams before extraction', async () => {
  const bytes=Buffer.concat([textPdf(['Octet stream PDF with valid source text.']),Buffer.alloc(6_100_000,32)]);
  let cancelled=false;
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>url.pathname==='/octet'?new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':String(bytes.length)}}):new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('707',['https://public.example/octet','https://public.example/oversized.pdf']);
  const result=await a.processLinks();
  assert.equal(result.jobs.find((j:any)=>j.target.endsWith('/octet')).state,'complete');
  const oversized=result.jobs.find((j:any)=>j.target.endsWith('/oversized.pdf')); assert.equal(oversized.state,'terminal');assert.match(oversized.error,/byte limit/);assert.equal(cancelled,true);
  configureArticleFetch({});
});

test('HTTP source-filtered status and supplied-text recovery remain owner bound and removed PDFs stay removed', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  const {GET:status}=await import('../app/api/processing/route');
  const {POST:recover}=await import('../app/api/processing/recover/route');
  const {GET:pull,POST:push}=await import('../app/api/sync/route');
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(scanPdf(),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); const first=(await a.save('708',['https://public.example/manual.pdf'])).results[0]; await a.save('709',['https://public.example/other.pdf']);
  await a.processLinks();
  const jobs=(await (await status(a.request('/api/processing?sourceId='+first.itemId))).json()).jobs;
  const links=jobs.filter((j:any)=>j.kind==='link');
  assert.equal(links.length,1); assert.ok(jobs.every((j:any)=>j.sourceId===first.itemId));
  const supplied=await recover(a.request('/api/processing/recover',{jobId:links[0].id,text:'Extracted source provided directly in the reader.'})); assert.equal(supplied.status,200);
  const result=await supplied.json(); assert.match((await a.read(result.itemId)).blocks[0].runs[0].text,/provided directly/);
  const row=(await (await pull(a.request('/api/sync'))).json()).changes.articles.find((r:any)=>r.id===result.itemId);
  await push(a.request('/api/sync',{changes:{articles:[{id:row.id,articleId:row.id,revision:row.revision,data:row.data,deleted:true}]}}));
  assert.equal((await recover(a.request('/api/processing/recover',{jobId:links[0].id,text:'Do not resurrect the removed identity.'}))).status,409);
  configureArticleFetch({});
});

test('HTTP text recovery preserves a short source body when the reader supplies no title', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  const {POST:recover}=await import('../app/api/processing/recover/route');
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(scanPdf(),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('710',['https://public.example/caption.pdf']);
  const job=(await a.processLinks()).jobs[0];
  const response=await recover(a.request('/api/processing/recover',{jobId:job.id,text:'Important extracted insight'}));
  assert.equal(response.status,200);
  const doc=await a.read((await response.json()).itemId);
  assert.equal(doc.title,'Recovered linked document');
  assert.equal(doc.blocks.map((b:any)=>b.runs.map((r:any)=>r.text).join('')).join(''),'Important extracted insight');
  configureArticleFetch({});
});

test('MCP recovery keeps literal Markdown-looking identifiers and punctuation in the body independently of its title', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(scanPdf(),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('711',['https://public.example/literal.pdf']);
  const job=(await a.processLinks()).jobs[0];
  const text='# Source heading\n\nThe variable x_y_z must be preserved — exactly.\n\n**literal** [notation](https://example.com) and $a_b$\n';
  const receipt=await a.call('supply_link_text',{jobId:job.id,title:'Separate reader title',text});
  const doc=await a.read(receipt.itemId);
  assert.equal(doc.title,'Separate reader title');
  assert.equal(doc.blocks.map((b:any)=>b.runs.map((r:any)=>r.text).join('')).join(''),text);
  assert.ok(doc.blocks.every((b:any)=>b.type==='p'&&b.runs.every((r:any)=>!r.em&&!r.strong&&!r.href&&!r.code)));
  configureArticleFetch({});
});

async function seedMetadataOnly(a:Awaited<ReturnType<typeof account>>,id:string,url:string) {
  const {POST:push}=await import('../app/api/sync/route');
  const response=await push(a.request('/api/sync',{changes:{articles:[{id,articleId:id,revision:0,doc:null,data:{id,title:'My retained title',sourceUrl:url,contentType:'article',topic:'business',tags:['retained'],favorite:true,cover:'saved-cover'},manualFields:['title','topic','tags','favorite','cover']}],highlights:[{id:id+'-annotation',articleId:id,revision:0,data:{note:'Keep this source annotation',sourceRevision:1}}]}}));
  assert.equal(response.status,200); assert.equal((await response.json()).ok,true);
}
async function assertMaterialized(a:Awaited<ReturnType<typeof account>>,id:string,text:string) {
  const doc=await a.read(id); assert.equal(doc.id,id); assert.equal(doc.sourceRevision,1); assert.equal(doc.contentType,'document');
  assert.match(doc.blocks.map((b:any)=>b.runs.map((r:any)=>r.text).join('')).join(''),new RegExp(text));
  const item=(await a.call('search_library')).results.find((s:any)=>s.itemId===id);
  assert.equal(item.title,'My retained title'); assert.equal(item.contentType,'document'); assert.equal(item.topic,'Business'); assert.deepEqual(item.tags,['retained']);
  const {GET:pull}=await import('../app/api/sync/route'); const changes=(await (await pull(a.request('/api/sync'))).json()).changes;
  const row=changes.articles.filter((r:any)=>r.id===id).at(-1); assert.equal(row.data.words,4); assert.equal(row.data.contentType,'document'); assert.equal(row.data.favorite,true); assert.equal(row.data.cover,'saved-cover');
  assert.equal(changes.highlights.find((r:any)=>r.articleId===id).data.note,'Keep this source annotation');
  const jobs=(await a.call('processing_status')).jobs;
  assert.deepEqual(jobs.filter((j:any)=>j.sourceId===id&&['classification','indexing'].includes(j.kind)).map((j:any)=>[j.kind,j.state]).sort(),[['classification','pending'],['indexing','pending']]);
  const search=await a.call('search_saved_passages',{query:text,contentType:'document',semantic:false});
  assert.ok(search.results.some((r:any)=>r.itemId===id));
}
test('automatic PDF processing materializes a canonical metadata-only source without replacing reader metadata or annotations', async () => {
  const a=await account(),url='https://public.example/metadata-auto',id='legacy-auto';
  await seedMetadataOnly(a,id,url);
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(textPdf(['Materialized automatic source evidence.']),{headers:{'content-type':'application/pdf'}})});
  try {
    await a.save('713',[url+'?utm_source=x']);
    const job=(await a.processLinks()).jobs[0]; assert.equal(job.state,'complete');assert.equal(job.resultItemId,id);
    await assertMaterialized(a,id,'Materialized automatic source evidence');
  } finally {configureArticleFetch({});}
});
test('supplied PDF text materializes a canonical metadata-only source and complete replay preserves the saved source', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  const a=await account(),url='https://public.example/metadata-manual',id='legacy-manual';
  await seedMetadataOnly(a,id,url);
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(scanPdf(),{headers:{'content-type':'application/pdf'}})});
  try {
    await a.save('714',[url]);const job=(await a.processLinks()).jobs[0];assert.equal(job.state,'terminal');
    const receipt=await a.call('supply_link_text',{jobId:job.id,text:'Materialized manual source evidence'});assert.equal(receipt.itemId,id);
    await assertMaterialized(a,id,'Materialized manual source evidence');
    const replay=await a.call('supply_link_text',{jobId:job.id,text:'Replacement must not overwrite the saved document'});assert.equal(replay.itemId,id);
    assert.equal((await a.read(id)).blocks[0].runs[0].text,'Materialized manual source evidence');
  } finally {configureArticleFetch({});}
});

test('expiry while waiting to materialize a canonical source rolls back completion and permits a fresh lease retry', async () => {
  const {configureProcessing}=await import('../lib/processing');
  const {POST:process}=await import('../app/api/processing/route');
  const {GET:read}=await import('../app/api/articles/[id]/route');
  const a=await account(),id='legacy-lock',url='https://public.example/metadata-lock';
  await seedMetadataOnly(a,id,url); await a.save('715',[url]);
  let started!:()=>void, release!:(value:any)=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const source={ok:true as const,article:{id:'discard-generated-id',title:'Fetched PDF text',sourceUrl:url,origin:'url' as const,contentType:'document' as const,blocks:[{id:'p1-text',type:'p' as const,page:1,runs:[{text:'Fresh source under a renewed lease.'}]}]}};
  configureProcessing({fetchArticle:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
  const pending=process(a.request('/api/processing',{limit:1})); await ready;
  const job=(await a.call('processing_status')).jobs.find((j:any)=>j.kind==='link');
  const locker=await pool.connect(); let locked=true;
  try {
    await locker.query('begin');
    await locker.query('select id from articles where user_id=$1 and id=$2 for no key update',[a.owner,id]);
    const lockPid=Number((await locker.query('select pg_backend_pid() as pid')).rows[0].pid);
    await pool.query("update processing_jobs set lease_expires_at=clock_timestamp()+interval '1500 milliseconds' where user_id=$1 and id=$2::bigint",[a.owner,job.id]);
    release(source);
    let blocked=false;
    for(let i=0;i<50;i++){
      blocked=Boolean((await pool.query('select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid))) as blocked',[lockPid])).rows[0].blocked);
      if(blocked)break; await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(blocked,true,'Publication must reach the target-row materialization lock');
    await new Promise(resolve=>setTimeout(resolve,1600));
    await locker.query('commit');locked=false;
    assert.equal((await pending).status,400);
    const retained=(await a.call('processing_status')).jobs.find((j:any)=>j.id===job.id);
    assert.equal(retained.state,'running');assert.equal(retained.resultItemId,null);
    assert.equal((await read(a.request('/api/articles/'+id),{params:Promise.resolve({id})})).status,404);
    configureProcessing({fetchArticle:async()=>source});
    const retry=(await a.processLinks({limit:1})).jobs.find((j:any)=>j.id===job.id);
    assert.equal(retry.state,'complete');assert.equal(retry.attempts,2);assert.equal(retry.resultItemId,id);
    assert.equal((await a.read(id)).blocks[0].runs[0].text,'Fresh source under a renewed lease.');
  } finally {if(locked)await locker.query('rollback');locker.release();configureProcessing({});}
});

test('automatic and recovered PDF sources share real classification/indexing scheduling and page-addressed retrieval', async () => {
  const {scanPdf}=await import('./pdf-fixtures');
  const {TOPICS}=await import('../lib/library');
  const original=globalThis.fetch;
  process.env.TYPESAFE_API_KEY='fixture-typesafe'; process.env.GOOGLE_API_KEY='fixture-google';
  globalThis.fetch=async url=> {
    if(String(url).startsWith('https://api.typesafe.ai/')) return Response.json({model:'jev-1.13.0',answers:{category:{type:'choice',choice:'ai-engineering',confidence:0.96,probabilities:Object.fromEntries(TOPICS.map(t=>[t.key,t.key==='ai-engineering'?0.96:0.04/(TOPICS.length-1)]))}},usage:{input_tokens:500,output_tokens:20}});
    assert.match(String(url),/gemini-embedding-2:embedContent$/);
    return Response.json({embedding:{values:[1,...Array(767).fill(0)]},usageMetadata:{promptTokenCount:30}});
  };
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async url=>new Response(url.pathname==='/scan.pdf'?scanPdf():textPdf(['Physical page one supports AI engineering.','Physical page two contains distinct saved evidence.']),{headers:{'content-type':'application/pdf'}})});
  try {
    const a=await account(); await a.save('712',['https://public.example/integration.pdf','https://public.example/scan.pdf']);
    let jobs:any[]=[];
    for(let i=0;i<4;i++){const r=await a.call('process_library'); jobs=r.jobs; if(jobs.some(j=>j.kind==='link'&&j.target.endsWith('/scan.pdf')&&j.state==='terminal')&&jobs.some(j=>j.kind==='link'&&j.state==='complete'))break;}
    const automatic=jobs.find(j=>j.kind==='link'&&j.state==='complete').resultItemId;
    const scan=jobs.find(j=>j.kind==='link'&&j.target.endsWith('/scan.pdf'));
    const recovered=await a.call('supply_link_text',{jobId:scan.id,text:'Manual source text also enters the saved knowledge pipeline.'});
    for(let i=0;i<4;i++)await a.call('process_library');
    jobs=(await a.call('processing_status')).jobs;
    for(const id of [automatic,recovered.itemId]){
      assert.deepEqual(jobs.filter(j=>j.sourceId===id&&['classification','indexing'].includes(j.kind)).map(j=>[j.kind,j.state]).sort(),[['classification','complete'],['indexing','complete']]);
      const item=(await a.call('search_library',{topic:'ai-engineering'})).results.find((s:any)=>s.itemId===id);
      assert.ok(item); assert.equal(item.processing.indexing,'complete');
    }
    const found=await a.call('search_saved_passages',{query:'"distinct saved evidence"',contentType:'document',semantic:false});
    const passage=found.results.find((p:any)=>p.itemId===automatic&&p.address.page===2);
    assert.equal(passage.address.blockId,'p2-text'); assert.equal(passage.sourceRevision,1); assert.match(passage.excerpt,/distinct saved evidence/);
    assert.equal((await a.read(recovered.itemId)).blocks[0].runs[0].text,'Manual source text also enters the saved knowledge pipeline.');
  } finally {globalThis.fetch=original;delete process.env.TYPESAFE_API_KEY;delete process.env.GOOGLE_API_KEY;configureArticleFetch({});}
});
