import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {pool,setupPostgres} from './postgres';
import {createToken} from '../lib/db';
import {makeToken} from '../lib/agent';
import {importBookmarks} from '../lib/bookmarks';
import {configureProcessing} from '../lib/processing';
import {POST,GET} from '../app/api/processing/route';
before(setupPostgres);after(()=>pool.end());
async function fixture(links:string[]){const owner='throughput-'+crypto.randomUUID(),token=makeToken();await createToken(owner,token.id,token.hash,'Fixture');await importBookmarks(owner,{posts:[{postId:String(BigInt('9000000000000000000')+BigInt(Math.floor(Math.random()*10000000))),url:'',text:'A source for throughput verification.',author:{name:'Author',handle:'author'},observedAt:'2026-10-17T01:00:00Z',links}].map(p=>({...p,url:'https://x.com/author/status/'+p.postId}))},'Fixture');return {owner,headers:{authorization:'Bearer '+token.token,'Content-Type':'application/json'}};}
const request=(headers:Record<string,string>,body:unknown)=>new Request('http://localhost/api/processing',{method:'POST',headers,body:JSON.stringify(body)});
test('a processing request fetches independent linked articles concurrently and publishes each once',async()=>{
 const a=await fixture(['https://one.example/a','https://two.example/b','https://three.example/c','https://four.example/d']);let active=0,peak=0;
 configureProcessing({fetchArticle:async url=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,80));active--;return {ok:true,article:{id:crypto.randomUUID(),title:'Readable fixture',sourceUrl:url,origin:'url',blocks:[{id:'b1',type:'p',runs:[{text:'Saved linked article text.'}]}]}};}});
 const started=performance.now(),response=await POST(request(a.headers,{limit:4}));assert.equal(response.status,200);const result=await response.json();
 console.log(JSON.stringify({fixtureJobs:4,elapsedMs:Math.round(performance.now()-started),peakFetches:peak}));
 assert.equal(peak,4);assert.equal(result.processed,4);assert.equal(result.jobs.filter((j:any)=>j.kind==='link'&&j.state==='complete').length,4);
 configureProcessing({});
});

test('large batches and simultaneous callers share the link and per-host concurrency limits',async()=>{
 const a=await fixture(Array.from({length:16},(_,i)=>`https://${i<8?'shared':i}.example/article-${i}`));
 let active=0,peak=0,shared=0,sharedPeak=0;const fetched:string[]=[];
 configureProcessing({fetchArticle:async url=>{active++;peak=Math.max(peak,active);if(new URL(url).hostname==='shared.example'){shared++;sharedPeak=Math.max(sharedPeak,shared);}fetched.push(url);await new Promise(r=>setTimeout(r,60));active--;if(new URL(url).hostname==='shared.example')shared--;return {ok:true,article:{id:crypto.randomUUID(),title:'Bounded parallel fixture',sourceUrl:url,origin:'url',blocks:[{id:'b1',type:'p',runs:[{text:'Readable fixture text.'}]}]}};}});
 const responses=await Promise.all([POST(request(a.headers,{limit:48})),POST(request(a.headers,{limit:48}))]);for(const response of responses)assert.equal(response.status,200);
 const status=await(await GET(new Request('http://localhost/api/processing',{headers:a.headers}))).json();
 assert.ok(peak>1);assert.ok(peak<=4);assert.ok(sharedPeak<=2);assert.equal(fetched.length,16);assert.equal(new Set(fetched).size,16);assert.equal(status.jobs.filter((j:any)=>j.kind==='link'&&j.state==='complete').length,16);
 configureProcessing({});
});

test('one scheduled run advances both active owners and ignores an owner with only deleted sources',async()=>{
 const {shelveForUser,pushRows}=await import('../lib/db');
 const {enqueueProcessing,registerProcessingHandler}=await import('../lib/processing');
 const {GET:cron}=await import('../app/api/cron/processing/route');
 const owners=['deleted','first','second'].map(label=>label+'-'+crypto.randomUUID());
 const seen=new Set<string>();
 registerProcessingHandler('scheduler-fixture',async({owner})=>{seen.add(owner);return {state:'complete'};});
 for(const owner of owners){
  await shelveForUser(owner,{id:'scheduled',title:'Scheduled fixture'},{id:'scheduled',blocks:[]});
  await enqueueProcessing(owner,'scheduled',1,'scheduler-fixture');
 }
 await pushRows(owners[0],{articles:[{id:'scheduled',article_id:'scheduled',data:{},deleted:true,revision:1}]});
 process.env.CRON_SECRET='scheduler-fixture-secret';
 const response=await cron(new Request('http://localhost/api/cron/processing',{headers:{authorization:'Bearer scheduler-fixture-secret'}}));
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.processed,2);
 assert.deepEqual([...seen].sort(),owners.slice(1).sort());
});
