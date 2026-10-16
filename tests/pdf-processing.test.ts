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
  const token = makeToken(); await createToken('pdf-' + crypto.randomUUID(), token.id, token.hash, 'PDF fixture');
  process.env.DATABASE_URL = 'test-adapter-only';
  const request = (path: string, body?: unknown) => new Request('http://localhost' + path, { headers: {authorization: 'Bearer ' + token.token, 'content-type': 'application/json'}, ...(body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)}) });
  const call = async (name: string, args: unknown = {}) => {
    const response = await handle(request('/mcp', {jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}));
    const result = (await response.json()).result; assert.equal(result.isError, undefined, JSON.stringify(result)); return result.structuredContent;
  };
  const save = async (postId: string, links: string[]) => call('save_bookmarks', {posts:[{postId,url:`https://x.com/a/status/${postId}`,text:'Saved knowledge with directly linked material.',author:{name:'A',handle:'a'},observedAt:'2026-10-16T10:00:00Z',links}]});
  const read = async (id: string) => { const {GET} = await import('../app/api/articles/[id]/route'); const r = await GET(request('/api/articles/'+id), {params:Promise.resolve({id})}); assert.equal(r.status,200); return (await r.json()).doc; };
  return {call,save,read,request};
}
test('unattended linked PDF becomes durable page-addressed text and shared discoveries reuse its identity', async () => {
  const bytes = textPdf(['First page text is retained for citations.', 'Second page has its own physical address.']);
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async()=>new Response(bytes,{headers:{'content-type':'application/pdf'}})});
  const a = await account(); await a.save('701',['https://public.example/paper.pdf']); await a.save('702',['https://public.example/paper.pdf?utm_source=x']);
  const result = await a.call('process_library');
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
  assert.equal((await a.call('process_library')).processed,0);
  configureArticleFetch({});
});

test('scanned and encrypted links remain honest failures while other links and bookmarked text survive', async () => {
  const {scanPdf} = await import('./pdf-fixtures');
  const {readFile} = await import('node:fs/promises');
  const encrypted = await readFile(new URL('./fixtures/password.pdf', import.meta.url));
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>new Response(url.pathname==='/scan.pdf'?scanPdf():url.pathname==='/password.pdf'?encrypted:textPdf(['Readable document alongside unsupported sources.']),{headers:{'content-type':'application/pdf'}})});
  const a = await account(); await a.save('703',['https://public.example/scan.pdf','https://public.example/password.pdf','https://public.example/good.pdf']);
  const result = await a.call('process_library');
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
  const job=(await a.call('process_library')).jobs[0]; assert.equal(job.state,'terminal');
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
  const result=await a.call('process_library');
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
  const started=Date.now(), failed=(await a.call('process_library')).jobs[0];
  delete process.env.PDF_EXTRACTION_TIMEOUT_MS;
  assert.equal(failed.state,'retryable'); assert.match(failed.error,/timed out/); assert.ok(Date.now()-started<2000);
  const retried=(await a.call('process_library',{retryJobId:failed.id})).jobs[0]; assert.equal(retried.state,'complete');
  assert.match((await a.read(retried.resultItemId)).blocks[0].runs[0].text,/source retried/);
  configureArticleFetch({});
});

test('PDF signature detection accepts bounded octet-stream downloads and stops oversized streams before extraction', async () => {
  const bytes=Buffer.concat([textPdf(['Octet stream PDF with valid source text.']),Buffer.alloc(6_100_000,32)]);
  let cancelled=false;
  configureArticleFetch({lookup:async()=>[{address:'93.184.216.34',family:4}],request:async(url)=>url.pathname==='/octet'?new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':String(bytes.length)}}):new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/pdf'}})});
  const a=await account(); await a.save('707',['https://public.example/octet','https://public.example/oversized.pdf']);
  const result=await a.call('process_library');
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
  await a.call('process_library');
  const jobs=(await (await status(a.request('/api/processing?sourceId='+first.itemId))).json()).jobs;
  assert.equal(jobs.length,1); assert.equal(jobs[0].sourceId,first.itemId);
  const supplied=await recover(a.request('/api/processing/recover',{jobId:jobs[0].id,text:'Extracted source provided directly in the reader.'})); assert.equal(supplied.status,200);
  const result=await supplied.json(); assert.match((await a.read(result.itemId)).blocks[0].runs[0].text,/provided directly/);
  const row=(await (await pull(a.request('/api/sync'))).json()).changes.articles.find((r:any)=>r.id===result.itemId);
  await push(a.request('/api/sync',{changes:{articles:[{id:row.id,articleId:row.id,revision:row.revision,data:row.data,deleted:true}]}}));
  assert.equal((await recover(a.request('/api/processing/recover',{jobId:jobs[0].id,text:'Do not resurrect the removed identity.'}))).status,409);
  configureArticleFetch({});
});
